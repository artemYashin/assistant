import test from "node:test";
import assert from "node:assert/strict";
import { readCodeStream } from "../server/code-progress.js";

function response(parts: string[]) {
  return new Response(new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }));
}
test("repository stream reports safe progress before returning a split final result", async () => {
  const events: unknown[] = [];
  const result = await readCodeStream(response([
    '{"type":"progress","progress":{"stage":"rece',
    'iving","percent":30}}\n',
    '{"type":"progress","progress":{"stage":"receiving","percent":40,"stderr":"secret"}}\n',
    '{"type":"progress","progress":{"stage":"unknown","percent":50}}\n',
    '{"type":"result","data":{"text":"hello',
    ' world"}}\n',
  ]), p => events.push(p));
  assert.deepEqual(events, [{ stage: "receiving", percent: 30 }]);
  assert.deepEqual(result, { text: "hello world" });
});
test("stream failures and interrupted connections are not reported as success", async () => {
  await assert.rejects(readCodeStream(response(['{"type":"error","error":"Fetch failed"}\n']), () => {}), /Fetch failed/);
  await assert.rejects(readCodeStream(response(['{"type":"progress","progress":{"stage":"queued"}}\n']), () => {}), /прервано/);
  await assert.rejects(readCodeStream(response(['{"type":"result","data":{}}']), () => {}), /прервано/);
  await assert.rejects(readCodeStream(response(['{"type":"result","data":{}}\n{"type":"result","data":{}}\n']), () => {}), /завершение/);
});
