// Runtime contract check: no real account, model inference, or external messaging.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CopilotClient } from "@github/copilot-sdk";
import { Store } from "../server/store.js";
import { Approvals } from "../server/approvals.js";
import { sessionConfig } from "../server/agent.js";
const dir = mkdtempSync(join(tmpdir(), "orbit-sdk-check-"));
const store = new Store(dir);
const client = new CopilotClient({
  mode: "empty",
  baseDirectory: join(dir, "copilot"),
  useLoggedInUser: false,
  gitHubToken: "invalid-orbit-test-token",
  logLevel: "error",
});
const timeout = setTimeout(() => {
  console.error("SDK verification timed out");
  process.exit(1);
}, 30000);
try {
  await client.start();
  const session = await client.createSession(
    sessionConfig(
      store,
      new Approvals(store, async () => {
        throw new Error("Sending forbidden in SDK test");
      }),
      { client: "", project: "" },
    ),
  );
  const read = await session.rpc.tools.execute({
    name: "list_memories",
    arguments: {},
  });
  assert.equal(read.resultType, "success");
  const forbidden = await session.rpc.tools.execute({
    name: "bash",
    arguments: { command: "true" },
  });
  assert.equal(forbidden.resultType, "denied");
  const approval = await session.rpc.tools.execute({
    name: "approve_teams_message",
    arguments: { id: "fake" },
  });
  assert.equal(approval.resultType, "denied");
  await session.disconnect();
  console.log(
    "Copilot runtime: custom tool works; shell and approval tools denied. No model request sent.",
  );
} finally {
  await client.stop();
  store.close();
  clearTimeout(timeout);
  rmSync(dir, { recursive: true, force: true });
}
