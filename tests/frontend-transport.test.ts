import test from "node:test";
import assert from "node:assert/strict";
import { api, apiProgress, setCsrf } from "../src/shared/api/http/index.js";
import { apiProgress as chatProgress, followChatRun } from "../src/entities/chat/api/index.js";

test("HTTP transport shares CSRF between JSON, uploads and chat runs", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(String(input).endsWith("/runs") ? { runId: "run/id" } : String(input).includes("/runs/") ? { events: [], cursor: 0, done: true, data: "answer" } : { ok: true });
  };
  try {
    setCsrf("test-csrf");
    await api("/settings", "PUT", { value: 1 });
    const form = new FormData(); form.append("image", new Blob(["fixture"]), "fixture.txt");
    await api("/notes/fixture", "PUT", form);
    assert.equal(await chatProgress("/conversation", { text: "hello" }, () => {}, new AbortController().signal), "answer");
    for (const { init } of calls) {
      assert.equal(new Headers(init?.headers).get("X-CSRF-Token"), "test-csrf");
      assert.equal(init?.credentials, "same-origin");
    }
    assert.equal(calls[0].init?.body, '{"value":1}');
    assert.equal(calls[1].init?.body, form);
    assert.equal(new Headers(calls[1].init?.headers).has("Content-Type"), false);
    assert.equal(calls[2].url, "/api/conversation/runs");
    assert.equal(calls[3].url, "/api/conversation/runs/run%2Fid?after=0");
  } finally { globalThis.fetch = original; setCsrf(""); }
});

test("chat polling preserves cursor, ordered progress and cancellation", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [], progress: number[] = [];
  globalThis.fetch = async input => {
    urls.push(String(input));
    return Response.json(urls.length === 1
      ? { events: Array.from({ length: 250 }, (_, i) => i), cursor: 250, done: false }
      : { events: [250], cursor: 251, done: true, data: "done" });
  };
  try {
    assert.equal(await followChatRun<number>("fixture", n => progress.push(n), new AbortController().signal), "done");
    assert.deepEqual(urls, ["/api/conversation/runs/fixture?after=0", "/api/conversation/runs/fixture?after=250"]);
    assert.deepEqual(progress, Array.from({ length: 251 }, (_, i) => i));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(followChatRun("fixture", () => {}, controller.signal), { name: "AbortError" });
    assert.equal(urls.length, 2);
  } finally { globalThis.fetch = original; }
});

test("NDJSON transport handles split frames and rejects incomplete results", async () => {
  const original = globalThis.fetch;
  const progress: string[] = [];
  const response = (chunks: string[]) => new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  }}), { headers: { "Content-Type": "application/x-ndjson" } });
  globalThis.fetch = async () => response(['{"type":"pro', 'gress","progress":"loading"}\n{"type":"result","data":{"ok":true}}\n']);
  try {
    assert.deepEqual(await apiProgress<string>("/code-browser", {}, p => progress.push(p), new AbortController().signal), { ok: true });
    assert.deepEqual(progress, ["loading"]);
    globalThis.fetch = async () => response(['{"type":"progress","progress":"loading"}\n']);
    await assert.rejects(apiProgress("/code-browser", {}, () => {}, new AbortController().signal), /Соединение прервано/);
    globalThis.fetch = async () => Response.json({ error: "Fixture rejected", fields: ["title"] }, { status: 400 });
    await assert.rejects(api("/notes", "POST", {}), /Fixture rejected: title/);
  } finally { globalThis.fetch = original; }
});
