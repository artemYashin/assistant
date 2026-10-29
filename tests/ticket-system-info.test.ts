import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../services/backend/src/store.js";
import { Connectors } from "../services/backend/src/connectors.js";
import {
  readCachedTicket,
  searchTicketContent,
} from "../services/backend/src/ticket-content-search.js";
import { readTicketLinks } from "../services/backend/src/ticket-links.js";
import { ticketCitationTool } from "../services/backend/src/ticket-citation.js";
import { ticketAnalysisAttachment } from "../services/backend/src/chat-ticket-attachment.js";

const field = "Microsoft.VSTS.TCM.SystemInfo";
test("populated old caches acquire System Info on sync without revision changes or data loss", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-system-info-"));
  let store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/Collection",
    azureProject: "Project",
  });
  const item = {
    id: 42,
    fields: {
      "System.TeamProject": "Project",
      "System.Title": "Saved ticket",
      "System.ChangedDate": "2026-10-01T00:00:00Z",
      "System.Description": "<p>Existing description</p>",
    },
  };
  let connector = new Connectors(store);
  (connector as any).azure = async () => item;
  await connector.trackTicket(42);
  const source = store.source();
  store.db
    .prepare("INSERT INTO ticket_metadata(source,id,notes) VALUES (?,?,?)")
    .run(source, 42, "Keep this note");
  assert.ok(readCachedTicket(store, { id: 42 }).missingSections?.includes("systemInfo"));
  store.close();
  store = new Store(dir);
  connector = new Connectors(store);
  let systemInfo: string | undefined =
    '<p>Environment ZX-991</p><a href="https://example.test/environment">Environment details</a>';
  (connector as any).azure = async (_path: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    assert.ok(request.fields.includes(field));
    return {
      value: [
        { ...item, fields: { ...item.fields, ...(systemInfo ? { [field]: systemInfo } : {}) } },
      ],
    };
  };
  await connector.syncTickets();
  await connector.syncTickets();
  assert.ok(
    readCachedTicket(store, { id: 42 }).content?.includes("systemInfo:\nEnvironment ZX-991"),
  );
  assert.deepEqual(readCachedTicket(store, { id: 42 }).missingSections, []);
  assert.equal(searchTicketContent(store, { search: "ZX-991" }).tickets[0].section, "systemInfo");
  assert.equal(readTicketLinks(store, { id: 42 }).links?.[0].section, "systemInfo");
  assert.equal(
    (
      store.db
        .prepare("SELECT notes FROM ticket_metadata WHERE source=? AND id=42")
        .get(source) as any
    ).notes,
    "Keep this note",
  );
  assert.ok(readCachedTicket(store, { id: 42 }).content?.includes("Existing description"));
  const citation: any = await ticketCitationTool(store, () => {}).handler!(
    { id: 42, section: "systemInfo", quote: "Environment ZX-991" },
    {} as any,
  );
  assert.ok(citation.originalUrl.includes("section=systemInfo"));
  const fallback = (connector as any).cachedTicketDetails(42, store.settings());
  assert.ok(fallback.fields[field].includes("ZX-991"));
  assert.ok(fallback.markdownFields.includes(field));
  const azure = (connector as any).azure;
  (connector as any).azure = async () => {
    throw new Error("Temporary outage");
  };
  await assert.rejects(connector.syncTickets(), /Temporary outage/);
  assert.equal(searchTicketContent(store, { search: "ZX-991" }).tickets.length, 1);
  (connector as any).azure = azure;
  systemInfo = undefined;
  await connector.syncTickets();
  assert.equal(searchTicketContent(store, { search: "ZX-991" }).tickets.length, 0);
  assert.deepEqual(readCachedTicket(store, { id: 42 }).missingSections, []);
});

test("analysis snapshots and review citations expose System Info without requiring it in old evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-system-info-evidence-"));
  const store = new Store(dir);
  try {
    const source = store.source();
    const attachment = ticketAnalysisAttachment(
      { id: 9, source, fields: { [field]: "<p>Browser build 123</p>" } },
      source,
    );
    assert.equal(attachment.systemInfo, "Browser build 123");
    const tool = ticketCitationTool(store, () => {}, {
      source,
      tickets: [
        { id: 9, description: "", criteria: "", repro: "", systemInfo: attachment.systemInfo },
        { id: 10, description: "Old snapshot", criteria: "", repro: "" },
      ],
    });
    const cited: any = await tool.handler!(
      { id: 9, section: "systemInfo", quote: "Browser build 123" },
      {} as any,
    );
    assert.equal(cited.section, "systemInfo");
    await assert.rejects(
      async () =>
        tool.handler!({ id: 10, section: "systemInfo", quote: "Browser build 123" }, {} as any),
      /не найдена/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
