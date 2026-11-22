import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../services/backend/src/agent.js";
import { Store } from "../services/backend/src/store.js";

test(
  "real installed SDK runs an external assistant tool roundtrip without GitHub credentials",
  { timeout: 45000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-provider-sdk-"));
    const store = new Store(dir);
    const requests: { path: string | undefined; body: any; authorization: string | undefined }[] =
      [];
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      requests.push({ path: req.url, body, authorization: req.headers.authorization });
      const needsTool = !body.messages?.some((message: any) => message.role === "tool");
      const tool = {
        id: "call_tags",
        type: "function",
        function: { name: "list_local_tags", arguments: "{}" },
      };
      const base = {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: body.model,
      };
      const finish = needsTool ? "tool_calls" : "stop";
      const message = needsTool
        ? { role: "assistant", content: null, tool_calls: [tool] }
        : { role: "assistant", content: "ORBIT_EXTERNAL_OK" };
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const delta = needsTool
          ? { role: "assistant", tool_calls: [{ index: 0, ...tool }] }
          : message;
        for (const choice of [
          { index: 0, delta, finish_reason: null },
          { index: 0, delta: {}, finish_reason: finish },
        ])
          res.write(
            `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [choice] })}\n\n`,
          );
        res.end("data: [DONE]\n\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ ...base, choices: [{ index: 0, message, finish_reason: finish }] }),
        );
      }
    });
    const agent = new Agent(store);
    t.after(async () => {
      agent.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    store.set("settings", {
      ...store.settings(),
      assistantProvider: "openai",
      openaiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      openaiModel: "synthetic-model",
    });
    store.setSecret("openai.apiKey", "synthetic-api-key");
    assert.equal(store.secret("github.token"), undefined);
    const result = await agent.chat("Please list my local tags.", { client: "", project: "" });
    assert.equal(result.body, "ORBIT_EXTERNAL_OK");
    assert.equal(requests.length, 2);
    assert.ok(
      requests.every(
        (request) =>
          request.path === "/v1/chat/completions" && request.body.model === "synthetic-model",
      ),
    );
    assert.ok(requests.every((request) => request.authorization === "Bearer synthetic-api-key"));
    const toolResult = requests[1].body.messages.find((message: any) => message.role === "tool");
    assert.ok(toolResult);
    assert.match(JSON.stringify(toolResult), /tags/);
    assert.equal(store.settings().reviewProvider, "copilot");
  },
);
