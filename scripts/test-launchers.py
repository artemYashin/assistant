"""Isolated command doubles: never starts Docker or touches real user storage."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class Launchers(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'bin').mkdir()
        for name in ['install.sh', 'update.sh', 'scripts/orbit-launch.sh']:
            shutil.copyfile(ROOT / name, self.root / name)
        self.log = self.root / 'commands'
        for name, body in {
            'docker': '''echo "docker $*" >> "$TEST_LOG"
case "$*" in
  'info --format '*) echo linux;;
  'context inspect '*) echo unix:///var/run/docker.sock;;
  'compose ps -q orbit') echo container;;
  'inspect '*) echo "${TEST_HEALTH:-healthy}";;
  'compose up '*) exit "${TEST_BUILD_EXIT:-0}";;
esac
''',
            'git': '''echo "git $*" >> "$TEST_LOG"
case "$*" in
  'status --porcelain') echo -n "${TEST_DIRTY:-}";;
  'pull --ff-only') exit "${TEST_PULL_EXIT:-0}";;
esac
''',
            'sleep': 'exit 0\n',
        }.items():
            path = self.root / 'bin' / name
            path.write_text('#!/bin/bash\n' + body)
            path.chmod(0o755)
        self.env = dict(os.environ, PATH=str(self.root / 'bin') + ':' + os.environ['PATH'], TEST_LOG=str(self.log))
        self.env.pop('DOCKER_HOST', None)

    def run_script(self, name, **env):
        return subprocess.run(['bash', str(self.root / name)], env=dict(self.env, **env), capture_output=True, text=True)

    def test_repeat_install_preserves_populated_storage(self):
        for folder in ['orbit', 'repositories', 'repo-control', 'whisper']:
            path = self.root / 'docker-data' / folder
            path.mkdir(parents=True)
            (path / 'sentinel').write_text('valuable existing data')
        for _ in range(2):
            result = self.run_script('install.sh')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('http://localhost:43871', result.stdout)
        for path in (self.root / 'docker-data').glob('*/sentinel'):
            self.assertEqual(path.read_text(), 'valuable existing data')

    def test_fresh_install_delegates_to_storage_initializer(self):
        (self.root / 'scripts/first-start.sh').write_text('echo initialized >> "$TEST_LOG"\n')
        result = self.run_script('install.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('initialized', self.log.read_text())

    def test_remote_engine_refused(self):
        result = self.run_script('update.sh', DOCKER_HOST='ssh://remote')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('compose stop', self.log.read_text())

    def test_partial_storage_refused(self):
        (self.root / 'docker-data/orbit').mkdir(parents=True)
        self.assertNotEqual(self.run_script('install.sh').returncode, 0)
        self.assertNotIn('compose up', self.log.read_text())

    def test_update_order(self):
        self.assertEqual(self.run_script('update.sh').returncode, 0)
        commands = self.log.read_text()
        self.assertLess(commands.index('compose stop'), commands.index('git pull'))
        self.assertLess(commands.index('git pull'), commands.index('compose up'))

    def test_dirty_checkout_not_stopped(self):
        self.assertNotEqual(self.run_script('update.sh', TEST_DIRTY=' M file').returncode, 0)
        self.assertNotIn('compose stop', self.log.read_text())

    def test_failed_pull_not_started(self):
        self.assertNotEqual(self.run_script('update.sh', TEST_PULL_EXIT='1').returncode, 0)
        self.assertNotIn('compose up', self.log.read_text())

    def test_failed_build_no_success(self):
        result = self.run_script('update.sh', TEST_BUILD_EXIT='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('successfully started', result.stdout)

    def test_unhealthy_no_success(self):
        result = self.run_script('update.sh', TEST_HEALTH='unhealthy')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('successfully started', result.stdout)


if __name__ == '__main__':
    unittest.main()
