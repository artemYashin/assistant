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

test("Docker startup credentials are optional without modifying config, context or installed helpers", (t) => {
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
        },
      },
    );
  const missing = run("docker-credential-osxkeychain get");
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout.trim(), "credentials not found in native keychain");
  assert.match(missing.stderr, /anonymous/);
  assert.equal(run("docker-credential-osxkeychain store").status, 1);
  writeFileSync(
    join(bin, "docker-credential-osxkeychain"),
    '#!/bin/sh\nprintf "existing-helper"\n',
    { mode: 0o700 },
  );
  assert.equal(run("docker-credential-osxkeychain get").stdout, "existing-helper");
  assert.equal(run('printf "%s" "$DOCKER_CONTEXT"').stdout, "rancher-desktop");
  assert.equal(run("exit 42").status, 42);
  assert.equal(readFileSync(join(config, "config.json"), "utf8"), original);
  assert.deepEqual(readdirSync(temp), [], "Temporary helpers are removed on success and failure");
});
