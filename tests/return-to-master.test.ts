import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

for (const scenario of ["success", "dirty", "divergent", "build-failure"]) {
  test(`return to master: ${scenario}`, () => {
    const root = mkdtempSync(join(tmpdir(), "orbit-return-test-"));
    const repo = join(root, "repo");
    mkdirSync(repo);
    const run = (args: string[]) => {
      const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      run(["init", "-b", "master"]);
      run(["config", "user.email", "test@example.invalid"]);
      run(["config", "user.name", "Test"]);
      writeFileSync(join(repo, ".gitignore"), "docker-data/\n.env\n");
      mkdirSync(join(repo, "scripts"));
      cpSync(resolve("scripts/orbit-launch.sh"), join(repo, "scripts/orbit-launch.sh"));
      run(["add", "."]);
      run(["commit", "-m", "master"]);
      run(["clone", "--bare", repo, join(root, "remote.git")]);
      run(["remote", "add", "origin", join(root, "remote.git")]);
      if (scenario === "divergent") {
        writeFileSync(join(repo, "local.txt"), "unpublished");
        run(["add", "."]);
        run(["commit", "-m", "local master"]);
      }
      run(["switch", "-c", "group-view-test"]);
      cpSync(resolve("scripts/return-to-master.sh"), join(repo, "scripts/return-to-master.sh"));
      run(["add", "."]);
      run(["commit", "-m", "test feature"]);
      const feature = run(["rev-parse", "HEAD"]);
      mkdirSync(join(repo, "docker-data"));
      writeFileSync(join(repo, "docker-data", "populated.db"), "existing tickets, notes and cache");
      writeFileSync(join(repo, ".env"), "KEEP=existing");
      if (scenario === "dirty") writeFileSync(join(repo, "unsaved.txt"), "keep");
      const bin = join(root, "bin");
      mkdirSync(bin);
      const log = join(root, "docker.log");
      writeFileSync(
        join(bin, "docker"),
        `#!/bin/sh\necho "$*" >> "$TEST_DOCKER_LOG"\ncase "$*" in\n 'info --format {{.OSType}}') echo linux;;\n 'context inspect --format {{.Endpoints.docker.Host}}') echo unix:///test;;\n 'compose ps -q orbit') echo test-container;;\n inspect*) echo healthy;;\n 'compose up --build -d') [ "$TEST_BUILD_FAIL" != 1 ] || exit 1;;\nesac\n`,
        { mode: 0o755 },
      );
      const result = spawnSync("bash", ["scripts/return-to-master.sh"], {
        cwd: repo,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          DOCKER_HOST: "unix:///test",
          ORBIT_OPTIONAL_DOCKER_CREDENTIALS: "1",
          TEST_DOCKER_LOG: log,
          TEST_BUILD_FAIL: scenario === "build-failure" ? "1" : "0",
        },
      });
      assert.equal(result.status, scenario === "success" ? 0 : 1, result.stdout + result.stderr);
      assert.equal(
        readFileSync(join(repo, "docker-data/populated.db"), "utf8"),
        "existing tickets, notes and cache",
      );
      assert.equal(readFileSync(join(repo, ".env"), "utf8"), "KEEP=existing");
      assert.equal(run(["rev-parse", "group-view-test"]), feature);
      const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
      if (scenario === "success" || scenario === "build-failure") {
        assert.equal(run(["branch", "--show-current"]), "master");
        assert.equal(existsSync(join(repo, "scripts/return-to-master.sh")), false);
        assert.match(calls, /compose stop\ncompose up --build -d/);
      } else {
        assert.equal(run(["branch", "--show-current"]), "group-view-test");
        assert.doesNotMatch(calls, /compose stop|compose up/);
      }
      if (scenario === "success") assert.match(result.stdout, /http:\/\/localhost:43871/);
      if (scenario === "build-failure") assert.match(result.stderr, /Return failed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
