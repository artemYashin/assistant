import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), "orbit-credentials-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"),
    temp = join(root, "temp"),
    config = join(root, "docker");
  for (const dir of [bin, temp, config]) mkdirSync(dir);
  for (const name of ["bash", "sh", "mktemp", "cat", "chmod", "rm"])
    symlinkSync(spawnSync("which", [name], { encoding: "utf8" }).stdout.trim(), join(bin, name));
  const original = JSON.stringify({
    credsStore: "osxkeychain",
    currentContext: "rancher-desktop",
    auths: { example: { auth: "test-only" } },
  });
  writeFileSync(join(config, "config.json"), original);
  const run = (command: string) =>
    spawnSync(
      join(bin, "bash"),
      ["scripts/with-optional-docker-credentials.sh", "bash", "-c", command],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin,
          TMPDIR: temp,
          DOCKER_CONFIG: config,
          DOCKER_CONTEXT: "rancher-desktop",
          ORBIT_TEST_BIN: bin,
        },
      },
    );
  return { root, bin, temp, config, original, run };
}

test("Docker startup credentials are optional without modifying config, context or installed helpers", (t) => {
  const { bin, temp, config, original, run } = fixture(t);
  const listed = run("docker-credential-osxkeychain list");
  assert.equal(listed.status, 0);
  assert.deepEqual(JSON.parse(listed.stdout), {});
  const missing = run("docker-credential-osxkeychain get");
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.trim(), "credentials not found in native keychain");
  assert.match(missing.stderr, /anonymous/);
  assert.equal(run("docker-credential-osxkeychain store").status, 1);
  assert.equal(run("docker-credential-osxkeychain erase").status, 1);
  writeFileSync(
    join(bin, "docker-credential-osxkeychain"),
    '#!/bin/sh\nprintf "existing-helper"\n',
    { mode: 0o700 },
  );
  assert.equal(run("docker-credential-osxkeychain get").stdout, "existing-helper");
  assert.equal(run("docker-credential-osxkeychain list").stdout, "existing-helper");
  assert.equal(run('printf "%s" "$DOCKER_CONTEXT"').stdout, "rancher-desktop");
  assert.equal(run("exit 42").status, 42);
  assert.equal(readFileSync(join(config, "config.json"), "utf8"), original);
  assert.deepEqual(readdirSync(temp), [], "Temporary helpers are removed on success and failure");
});

test("both Compose entrypoints can enumerate then request optional credentials", (t) => {
  const { bin, temp, config, original, run } = fixture(t);
  const compose = `#!/bin/bash
set -euo pipefail
if [[ "$1" == compose ]]; then shift; fi
[[ "$1" == up && "$2" == --build && "$3" == -d ]]
[[ "$(docker-credential-osxkeychain list)" == '{}' ]]
set +e
credential=$(printf '%s' 'https://index.docker.io/v1/' | docker-credential-osxkeychain get)
status=$?
set -e
[[ "$status" == 1 && "$credential" == 'credentials not found in native keychain' ]]
printf 'public-build-started'
`;
  for (const name of ["docker", "docker-compose"])
    writeFileSync(join(bin, name), compose, { mode: 0o700 });
  for (const command of ["docker compose up --build -d", "docker-compose up --build -d"]) {
    const result = run(command);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "public-build-started");
  }
  assert.equal(readFileSync(join(config, "config.json"), "utf8"), original);
  assert.deepEqual(readdirSync(temp), []);
});

test("a real helper installed after wrapper startup receives the original action and input", (t) => {
  const { temp, config, original, run } = fixture(t);
  const result = run(`cat > "$ORBIT_TEST_BIN/docker-credential-osxkeychain" <<'REAL'
#!/bin/sh
printf '%s:' "$1"
cat
exit 17
REAL
chmod 700 "$ORBIT_TEST_BIN/docker-credential-osxkeychain"
printf 'registry.example' | docker-credential-osxkeychain get`);
  assert.equal(result.status, 17);
  assert.equal(result.stdout, "get:registry.example");
  assert.equal(result.stderr, "");
  assert.equal(readFileSync(join(config, "config.json"), "utf8"), original);
  assert.deepEqual(readdirSync(temp), []);
});
