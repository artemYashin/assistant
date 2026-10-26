import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import { TicketPullRequests, azurePrLinks } from "../services/backend/src/ticket-pull-requests.js";
const projectId = "11111111-1111-4111-8111-111111111111";
const repo = "22222222-2222-4222-8222-222222222222";
const artifact = (number: number) => ({
  rel: "ArtifactLink",
  url: `vstfs:///Git/PullRequestId/${projectId}%2F${repo}%2F${number}`,
});
test("Azure PR artifacts are validated, decoded and deduplicated", () => {
  assert.deepEqual(
    azurePrLinks([
      artifact(42),
      artifact(42),
      { ...artifact(1), url: "https://evil.test/" },
      { ...artifact(1), url: "vstfs:///Git/PullRequestId/%xx" },
      { ...artifact(1), rel: "AttachedFile" },
    ]),
    [{ projectId, repo, number: 42 }],
  );
});
test("ticket PR union is lazy, deduplicated, source guarded and does not alter local data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ticket-pr-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "fixture");
  const card = {
    id: 42,
    source: store.source(),
    fields: { "System.Title": "Ticket" },
    azurePullRequests: [1, 2, 3].map((number) => ({ projectId, repo, number })),
  };
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("card", JSON.stringify(card));
  const locals = [
    { monitor: "monitor", repo, number: 1, title: "Local", author: "Local author" },
    { monitor: "monitor", repo, number: 4, title: "Only local" },
  ];
  const service = new TicketPullRequests(store, new Connectors(store), {
    linkedToTicket: () => locals,
    monitors: () => [],
  } as any);
  let calls = 0;
  let changeSource = false;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, "https://ado.test");
    if (url.pathname.includes("/workitems/"))
      return Response.json({ id: 42, relations: [artifact(2)] });
    const number = Number(url.pathname.split("/").at(-1));
    if (number === 3) return Response.json({ message: "Denied" }, { status: 403 });
    if (changeSource) store.set("settings", { ...store.settings(), azureProject: "Other" });
    return Response.json({
      pullRequestId: number,
      repository: { id: repo, project: { id: projectId, name: "Project" }, name: "Repo" },
      title: `Azure ${number}`,
      description: "Full description",
      status: number === 1 ? "active" : "completed",
      createdBy: { displayName: "Author" },
      reviewers: [],
      closedDate: "2020-01-01T00:00:00Z",
    });
  });
  assert.equal(calls, 0);
  const result = await service.list("card");
  assert.equal(result.items.length, 4);
  assert.equal(result.items.find((i) => i.number === 1).origin, "Azure и Orbit");
  assert.match(result.items.find((i) => i.number === 1).href, /monitor=monitor/);
  assert.match(result.items.find((i) => i.number === 2).href, /tab=completed/);
  assert.match(result.items.find((i) => i.number === 3).error, /Denied|403/);
  const detail = await service.detail("card", { projectId, repo, number: 2 });
  assert.equal(detail.description, "Full description");
  assert.equal(detail.closedAt, "2020-01-01T00:00:00Z");
  const before = calls;
  await assert.rejects(() => service.detail("card", { projectId, repo, number: 99 }), /не найден/);
  assert.equal(calls, before);
  assert.deepEqual(new Connectors(store).ticketCard("card"), card);
  const { azurePullRequests: _, ...legacy } = card;
  store.db.prepare("INSERT INTO ticket_cards VALUES (?,?)").run("legacy", JSON.stringify(legacy));
  assert.equal((await service.list("legacy")).items.length, 3);
  changeSource = true;
  await assert.rejects(
    () => service.detail("card", { projectId, repo, number: 2 }),
    /Подключение Azure изменилось/,
  );
  const last = calls;
  await assert.rejects(() => service.list("card"), /Подключение Azure изменилось/);
  assert.equal(calls, last);
});
