import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { Store } from "../server/store.js";
import { Calendar } from "../server/calendar.js";
import {
  LocalDevelopers,
  localDeveloperTools,
} from "../server/local-developers.js";
import { setDeveloperVacation } from "../server/developer-vacations.js";
import { sessionConfig } from "../server/agent.js";
import { calendarTools } from "../server/calendar-tools.js";
import { createApp } from "../server/app.js";
import { hasLocalManagement } from "../server/work-mode.js";
import { modeTools } from "../server/work-mode-tools.js";
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";
const context = { client: "", project: "" };
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-mode-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
function change(store: Store, workMode: "lead" | "developer") {
  store.set("settings", { ...store.settings(), workMode });
}
test("populated upgrade defaults to Lead; developer mode and restart preserve assignments, vacations and reminder links", (t) => {
  const store = fixture(t);
  const people = new LocalDevelopers(store);
  const person = people.add(["Alice"], context)[0];
  store.db
    .prepare("INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      store.source(),
      42,
      "Ticket",
      "Active",
      "Azure person",
      "Bug",
      "url",
      "",
      "",
    );
  people.assign(42, [person.id], context);
  setDeveloperVacation(store, person.id, {
    start: "2099-11-01",
    end: "2099-11-10",
  });
  const calendar = new Calendar(store);
  const reminder = calendar.save({
    title: "Linked reminder",
    start: null,
    end: null,
    developerIds: [person.id],
  });
  const vacation = calendar.list().find((i) => i.vacation)!;
  calendar.complete(vacation.id);
  const { workMode: _, ...legacy } = store.settings();
  store.set("settings", legacy);
  assert.equal(hasLocalManagement(store.settings()), true);
  change(store, "developer");
  assert.equal(
    calendar.list().some((i) => i.vacation),
    false,
  );
  assert.deepEqual(calendar.developers(), []);
  assert.deepEqual(
    calendar.list().find((i) => i.id === reminder.id)!.developerIds,
    [],
  );
  calendar.save(
    { title: "Edited without losing people", start: null, end: null },
    reminder.id,
  );
  assert.throws(() => calendar.complete(vacation.id), /недоступны/);
  assert.throws(
    () =>
      calendar.save({
        title: "Bad",
        start: null,
        end: null,
        developerIds: [person.id],
      }),
    /недоступны/,
  );
  const reopened = new Store(store.dir);
  try {
    assert.equal(reopened.settings().workMode, "developer");
    change(reopened, "lead");
    const restored = new Calendar(reopened).list();
    assert.deepEqual(restored.find((i) => i.id === reminder.id)!.developerIds, [
      person.id,
    ]);
    assert.equal(
      restored.find((i) => i.id === reminder.id)!.title,
      "Edited without losing people",
    );
    assert.equal(restored.find((i) => i.id === vacation.id)!.completed, true);
    assert.equal(new LocalDevelopers(reopened).assigned(42)[0].id, person.id);
  } finally {
    reopened.close();
  }
});
test("Developer tool catalog prunes schemas, rejects stale arguments and keeps ordinary tools usable", async (t) => {
  const store = fixture(t);
  change(store, "developer");
  const config = sessionConfig(
    store,
    context,
    undefined,
    undefined,
    undefined,
    undefined,
    [
      ...localDeveloperTools(store, context, "", () => {}),
      ...calendarTools(store, () => {}),
    ],
  );
  const tools = config.tools!;
  for (const name of [
    "list_local_developers",
    "set_local_ticket_developers",
    "set_developer_vacation",
  ])
    assert.equal(
      tools.some((t) => t.name === name),
      false,
    );
  const list = tools.find((t) => t.name === "list_tickets")!;
  assert.ok(!JSON.stringify(list.parameters).includes('"localDevelopers"'));
  await assert.rejects(
    async () => list.handler!({ fields: ["localDevelopers"] }, {} as any),
    /недоступно/,
  );
  const result: any = await list.handler!(
    { fields: ["assigned", "state"] },
    {} as any,
  );
  assert.ok(Array.isArray(result.tickets));
  const batch = tools.find((t) => t.name === "batch_update_tickets")!;
  assert.ok(!JSON.stringify(batch.parameters).includes('"const":"developers"'));
  await assert.rejects(
    async () =>
      batch.handler!(
        { operations: [{ action: "developers", id: 42, developerIds: [] }] },
        {} as any,
      ),
    /недоступ/,
  );
  const search = tools.find((t) => t.name === "search_calendar_reminders")!;
  assert.ok(!JSON.stringify(search.parameters).includes('"developerIds"'));
  await assert.rejects(
    async () => search.handler!({ kinds: ["vacation"] }, {} as any),
    /недоступно/,
  );
  change(store, "lead");
  await assert.rejects(
    async () => list.handler!({}, {} as any),
    /Режим работы изменился/,
  );
  const lead = sessionConfig(store, context);
  assert.match(
    JSON.stringify(
      lead.tools!.find((t) => t.name === "list_tickets")!.parameters,
    ),
    /localDevelopers/,
  );
});
test("future tools remain available by default, output excludes management metadata", async (t) => {
  const store = fixture(t);
  change(store, "developer");
  const [tool] = modeTools(store, [
    defineTool("new_feature", {
      description: "New unrelated feature",
      parameters: z.object({ value: z.string() }),
      handler: async () => ({
        assigned: "Azure person",
        localDevelopers: [{ name: "Alice" }],
        nested: { developerIds: ["a"] },
        title: "kept",
      }),
    }),
  ]);
  const value: any = await tool.handler!({ value: "test" }, {} as any);
  assert.deepEqual(value, {
    assigned: "Azure person",
    nested: {},
    title: "kept",
  });
});
test("settings retain explicit mode for older clients; active chat/review prevents switching", async (t) => {
  const store = fixture(t);
  const { app, agent, reviewAgent } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "correct-password-long" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...store.settings(), workMode: "developer" })
    .expect(200);
  const { workMode: _, ...oldClient } = store.settings();
  await request(app).put("/api/settings").set(auth).send(oldClient).expect(200);
  assert.equal(store.settings().workMode, "developer");
  await request(app).get("/api/local-developers").set(auth).expect(403);
  const active = agent.active;
  agent.active = () => "busy";
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...store.settings(), workMode: "lead" })
    .expect(409);
  agent.active = active;
  const reviewActive = reviewAgent.active;
  reviewAgent.active = () => "busy";
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...store.settings(), workMode: "lead" })
    .expect(409);
  reviewAgent.active = reviewActive;
  await request(app)
    .put("/api/settings")
    .set(auth)
    .send({ ...store.settings(), workMode: "lead" })
    .expect(200);
});
