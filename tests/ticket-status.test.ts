import test from "node:test";
import assert from "node:assert/strict";
import {
  changeTicketState,
  resolveState,
  mayChangeState,
} from "../server/ticket-status.js";
import { Store, AppError } from "../server/store.js";
import { Connectors } from "../server/connectors.js";
import { IntegrationsAuth } from "../server/auth.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const item = (state = "Active", rev = 7) => ({
  id: 123456,
  rev,
  fields: {
    "System.TeamProject": "Project",
    "System.WorkItemType": "Bug",
    "System.State": state,
  },
});
test("resolves exact states before aliases and rejects unknown states", () => {
  assert.equal(
    resolveState("RFT", ["Active", "Ready for Testing"]),
    "Ready for Testing",
  );
  assert.equal(resolveState("rft", ["RFT", "Ready for Testing"]), "RFT");
  assert.throws(
    () => resolveState("Done", ["Active", "Closed"]),
    /Доступные статусы/,
  );
  assert.ok(
    mayChangeState("Переведи тикет 123456 в RFT", 123456, "Ready for Testing"),
  );
  assert.ok(!mayChangeState("Покажи тикет 123456 в RFT", 123456, "RFT"));
  assert.ok(!mayChangeState("Не переводи тикет 123456 в RFT", 123456, "RFT"));
  assert.ok(!mayChangeState("Переведи тикет 1234567 в RFT", 123456, "RFT"));
  assert.ok(!mayChangeState("Переведи тикет 123456 в Active", 123456, "RFT"));
});
test("status changes require a separate verification GET; PATCH response is not trusted", async () => {
  let reads = 0,
    patches = 0;
  const result = await changeTicketState(123456, "RFT", "Project", {
    read: async () => item(++reads === 1 ? "Active" : "Ready for Testing"),
    states: async () => ["Ready for Testing"],
    patch: async (rev, state) => {
      patches++;
      assert.equal(rev, 7);
      assert.equal(state, "Ready for Testing");
      return item("Wrong PATCH response");
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.outcome, "changed");
  assert.equal(reads, 2);
  assert.equal(patches, 1);
});
test("mismatch and failed verification cannot report success or retry the write", async () => {
  let patches = 0;
  await assert.rejects(
    changeTicketState(123456, "RFT", "Project", {
      read: async () => item(),
      states: async () => ["RFT"],
      patch: async () => {
        patches++;
        return item("RFT");
      },
    }),
    /ожидался «RFT», получен «Active»/,
  );
  assert.equal(patches, 1);
  let reads = 0;
  await assert.rejects(
    changeTicketState(123456, "RFT", "Project", {
      read: async () => {
        if (++reads === 2) throw new Error("offline");
        return item();
      },
      states: async () => ["RFT"],
      patch: async () => {
        patches++;
      },
    }),
    /не подтверждён/,
  );
  assert.equal(patches, 2);
});
test("ambiguous PATCH is reconciled by reading, and an already-set state is not written", async () => {
  let reads = 0;
  const reconciled = await changeTicketState(123456, "RFT", "Project", {
    read: async () => item(++reads === 1 ? "Active" : "RFT"),
    states: async () => ["RFT"],
    patch: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(reconciled.outcome, "confirmed_after_error");
  const already = await changeTicketState(123456, "RFT", "Project", {
    read: async () => item("RFT"),
    states: async () => ["RFT"],
    patch: async () => {
      assert.fail("must not patch");
    },
  });
  assert.equal(already.outcome, "already");
});
test("invalid project, unknown state and cancelled request never PATCH", async () => {
  let patches = 0;
  const access = {
    read: async () => item(),
    states: async () => ["Active", "RFT"],
    patch: async () => {
      patches++;
    },
  };
  await assert.rejects(
    changeTicketState(123456, "RFT", "Other", access),
    /проект/,
  );
  await assert.rejects(
    changeTicketState(123456, "Closed", "Project", access),
    /не найден/,
  );
  await assert.rejects(
    changeTicketState(123456, "RFT", "Project", {
      ...access,
      beforeWrite: () => {
        throw new AppError(409, "stopped");
      },
    }),
    /stopped/,
  );
  assert.equal(patches, 0);
});
test("connector PATCH uses revision guard, updates tracked state and preserves custom collection URL", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-state-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.set("settings", {
    ...store.settings(),
    azureUrl: "https://ado.test/tfs/Collection",
    azureProject: "Project",
  });
  store.setSecret("azure.pat", "pat");
  let reads = 0;
  const methods: string[] = [];
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      store.source(),
      123456,
      "Bug",
      "Active",
      "",
      "Bug",
      "https://ado.test",
      null,
      new Date().toISOString(),
    );
  t.mock.method(globalThis, "fetch", async (raw: any, init: any) => {
    const url = new URL(String(raw));
    assert.ok(url.pathname.startsWith("/tfs/Collection/Project/_apis/wit/"));
    methods.push(init.method || "GET");
    if (url.pathname.endsWith("/states"))
      return Response.json({ value: [{ name: "RFT" }] });
    if (init.method === "PATCH") {
      assert.equal(init.headers["Content-Type"], "application/json-patch+json");
      assert.deepEqual(JSON.parse(init.body), [
        { op: "test", path: "/rev", value: 7 },
        { op: "add", path: "/fields/System.State", value: "RFT" },
      ]);
      return Response.json(item("RFT", 8));
    }
    return Response.json(
      item(++reads === 1 ? "Active" : "RFT", reads === 1 ? 7 : 8),
    );
  });
  const result = await new Connectors(
    store,
    new IntegrationsAuth(store),
  ).changeTicketStatus(123456, "RFT");
  assert.equal(result.success, true);
  assert.deepEqual(methods, ["GET", "GET", "PATCH", "GET"]);
  assert.equal(
    (store.db.prepare("SELECT state FROM tickets").get() as any).state,
    "RFT",
  );
});
