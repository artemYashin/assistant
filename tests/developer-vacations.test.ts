import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import { LocalDevelopers } from "../server/local-developers.js";
import { Calendar } from "../server/calendar.js";
import {
  setDeveloperVacation,
  vacationBounds,
} from "../server/developer-vacations.js";
import { developerOnVacation } from "../src/developer-vacation.js";
import { notificationDue } from "../server/calendar-notifications.js";
import { searchCalendar } from "../server/calendar-search.js";
import { parseCalendarFilters } from "../src/calendar-filters.js";

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-vacation-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}
test("one inclusive vacation per developer, scope updates, filtering, overrides and cancellation", (t) => {
  const store = fixture(t),
    people = new LocalDevelopers(store),
    calendar = new Calendar(store);
  const context = { client: "Customer", project: "Project" };
  const person = people.add(["Alice"], context)[0];
  setDeveloperVacation(store, person.id, {
    start: "2099-11-01",
    end: "2099-11-10",
  });
  const item = calendar.list()[0];
  assert.equal(item.vacation?.returnDate, "2099-11-11");
  assert.equal(item.client, "Customer");
  assert.equal(item.project, "Project");
  assert.deepEqual(item.developerIds, [person.id]);
  assert.equal(people.list(context)[0].vacationStart, "2099-11-01");
  calendar.complete(item.id);
  calendar.setPreferences(item.id, { leadMinutes: 45, calendarHidden: true, notificationsHidden: true });
  setDeveloperVacation(store, person.id, {
    start: "2099-11-01",
    end: "2099-11-10",
  });
  assert.equal(calendar.list()[0].completed, true);
  setDeveloperVacation(store, person.id, {
    start: "2099-11-02",
    end: "2099-11-12",
  });
  assert.equal(calendar.list().length, 1);
  assert.equal(calendar.list()[0].id, item.id);
  assert.equal(calendar.list()[0].completed, false);
  assert.equal(calendar.list()[0].leadMinutes, 45);
  assert.equal(calendar.list()[0].calendarHidden, true);
  assert.equal(calendar.list()[0].notificationsHidden, true);
  people.edit(person.id, "Alice renamed", { client: "", project: "" });
  assert.equal(calendar.list()[0].scope, "general");
  assert.match(calendar.list()[0].title, /Alice renamed/);
  assert.equal(searchCalendar(store, { types: ["vacation"] }).total, 1);
  assert.equal(
    searchCalendar(store, { types: ["reminder", "ticket"] }).total,
    0,
  );
  assert.deepEqual(parseCalendarFilters({ types: ["vacation"] }).types, [
    "vacation",
  ]);
  assert.throws(
    () => calendar.save({ title: "wrong", start: null, end: null }, item.id),
    /настройках разработчика/,
  );
  assert.throws(() =>
    setDeveloperVacation(store, person.id, {
      start: "2099-02-30",
      end: "2099-03-01",
    }),
  );
  assert.throws(() =>
    setDeveloperVacation(store, person.id, {
      start: "2099-03-02",
      end: "2099-03-01",
    }),
  );
  assert.equal(calendar.list().length, 1);
  calendar.remove(item.id);
  assert.equal(calendar.list()[0].completed, true);
  assert.equal(
    people.list({ client: "", project: "" })[0].vacationStart,
    "2099-11-02",
  );
  setDeveloperVacation(store, person.id, null);
  assert.equal(calendar.list().length, 0);
  assert.equal(people.list(context)[0].vacationStart, null);
});
test("vacation boundaries include final day, timezone and DST; notifications start at lead and stop after return", (t) => {
  const store = fixture(t),
    people = new LocalDevelopers(store),
    calendar = new Calendar(store);
  store.set("settings", {
    ...store.settings(),
    syncSchedule: {
      ...store.settings().syncSchedule,
      timeZone: "Europe/Berlin",
    },
  });
  const person = people.add(["Alice"], { client: "", project: "" })[0];
  const bounds = vacationBounds("2099-10-24", "2099-10-25", "Europe/Berlin");
  setDeveloperVacation(store, person.id, {
    start: "2099-10-24",
    end: "2099-10-25",
  });
  const item = calendar.list()[0],
    profile = people.list({ client: "", project: "" })[0];
  assert.equal(developerOnVacation(profile, bounds.start), true);
  assert.equal(developerOnVacation(profile, bounds.end), true);
  assert.equal(
    developerOnVacation(
      profile,
      new Date(Date.parse(bounds.end) + 1).toISOString(),
    ),
    false,
  );
  const warning = Date.parse(item.warningStart!);
  assert.equal(notificationDue(item, 0, new Date(warning - 1)), false);
  assert.equal(notificationDue(item, 0, new Date(warning)), true);
  assert.equal(
    notificationDue(item, 0, new Date(Date.parse(bounds.end) + 1)),
    false,
  );
  calendar.setLead(item.id, 120);
  assert.equal(
    Date.parse(calendar.list()[0].warningStart!),
    Date.parse(item.start!) - 120 * 60000,
  );
});
test("upgrade and repeated reopen preserve developers, notes, assignments, existing events and vacation IDs", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-vacation-upgrade-"));
  let store = new Store(dir);
  try {
    const people = new LocalDevelopers(store),
      ctx = { client: "Customer", project: "Project" };
    const person = people.add(["Existing"], ctx)[0];
    store.set("existing-project-note", "Keep this note");
    const event = new Calendar(store).save({
      title: "Existing event",
      start: null,
      end: null,
    }).id;
    store.db
      .prepare("INSERT INTO ticket_developers VALUES (?,?,?)")
      .run("source", 42, person.id);
    store.db.exec("DROP TABLE developer_vacations");
    store.close();
    store = new Store(dir);
    assert.equal(new LocalDevelopers(store).list(ctx)[0].id, person.id);
    assert.equal(store.get("existing-project-note", ""), "Keep this note");
    assert.equal(
      (
        store.db
          .prepare("SELECT COUNT(*) AS n FROM ticket_developers")
          .get() as any
      ).n,
      1,
    );
    assert.equal(new Calendar(store).list()[0].id, event);
    setDeveloperVacation(store, person.id, {
      start: "2099-01-01",
      end: "2099-01-03",
    });
    const id = new Calendar(store).list().find((i) => i.vacation)!.id;
    new Calendar(store).complete(id);
    for (let n = 0; n < 2; n++) {
      store.close();
      store = new Store(dir);
      assert.equal(new Calendar(store).list().find((i) => i.vacation)!.id, id);
      assert.equal(
        new Calendar(store).list().find((i) => i.vacation)!.completed,
        true,
      );
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("vacation API enforces authentication/context and board exposes dates without changing saved notes", async (t) => {
  const { default: request } = await import("supertest");
  const { createApp } = await import("../server/app.js");
  const store = fixture(t),
    people = new LocalDevelopers(store);
  const context = { client: "Customer", project: "Project" };
  const person = people.add(["Existing"], context)[0];
  const { app } = createApp(store);
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  const setup = await request(app)
    .post("/api/auth/setup")
    .set(headers)
    .send({ password: "long-enough-password" })
    .expect(200);
  const auth = {
    ...headers,
    Cookie: setup.headers["set-cookie"][0].split(";")[0],
    "X-CSRF-Token": setup.body.csrf,
  };
  const path = `/api/developer-board/${person.id}/vacation`;
  const vacation = { start: "2099-11-01", end: "2099-11-10" };
  await request(app)
    .put(path)
    .set(headers)
    .send({ context, vacation })
    .expect(401);
  await request(app)
    .put(path)
    .set(auth)
    .send({ context: { client: "Other", project: "Other" }, vacation })
    .expect(404);
  await request(app)
    .put(`/api/developer-board/${person.id}/notes`)
    .set(auth)
    .send({ context, notes: "Preserve original notes" })
    .expect(200);
  await request(app)
    .put(path)
    .set(auth)
    .send({ context, vacation })
    .expect(200);
  const result = await request(app)
    .get("/api/developer-board")
    .query(context)
    .set(auth)
    .expect(200);
  assert.equal(result.body.developers[0].notes, "Preserve original notes");
  assert.equal(result.body.developers[0].vacationEnd, vacation.end);
  await request(app)
    .put(path)
    .set(auth)
    .send({ context, vacation: null })
    .expect(200);
  assert.equal(new Calendar(store).list().length, 0);
});

test("ended vacation completes its reminder automatically and cannot be reopened without new dates", (t) => {
  const store = fixture(t),
    people = new LocalDevelopers(store),
    calendar = new Calendar(store);
  const person = people.add(["Returned"], { client: "", project: "" })[0];
  setDeveloperVacation(store, person.id, {
    start: "2020-01-01",
    end: "2020-01-02",
  });
  const item = calendar.list()[0];
  assert.equal(item.completed, true);
  assert.equal(
    searchCalendar(store, { types: ["vacation"], statuses: ["active"] }).total,
    0,
  );
  assert.throws(() => calendar.reopen(item.id), /Отпуск уже закончился/);
  assert.equal(
    people.list({ client: "", project: "" })[0].vacationEnd,
    "2020-01-02",
  );
  const bounds = vacationBounds("2026-10-25", "2026-10-25", "Europe/Berlin");
  assert.equal(
    Date.parse(bounds.end) - Date.parse(bounds.start) + 1,
    25 * 3600000,
  );
});

test("chat vacation tool creates, changes and cancels one period and refreshes UI; rejects unavailable people and cancelled runs", async (t) => {
  const { localDeveloperTools } = await import("../server/local-developers.js");
  const store = fixture(t),
    people = new LocalDevelopers(store),
    context = { client: "Customer", project: "Project" };
  const person = people.add(["Alice"], { client: "", project: "" })[0];
  const other = people
    .add(["Other"], { client: "Other", project: "Other" })
    .find((p) => p.name === "Other")!;
  let updates = 0,
    stopped = false;
  const tools = localDeveloperTools(
    store,
    context,
    "Поставь Алисе отпуск",
    () => {
      if (stopped) throw new Error("Cancelled");
    },
    undefined,
    () => updates++,
  );
  const tool = tools.find((t) => t.name === "set_developer_vacation")!;
  const invoke = (input: any) => (tool.handler as any)(input);
  const first = await invoke({
    developerId: person.id,
    vacation: { start: "2099-11-01", end: "2099-11-05" },
  });
  assert.equal(first.returnDate, "2099-11-06");
  assert.equal(first.azureChanged, false);
  const id = new Calendar(store).list()[0].id;
  await invoke({
    developerId: person.id,
    vacation: { start: "2099-11-01", end: "2099-11-08" },
  });
  assert.equal(new Calendar(store).list()[0].id, id);
  assert.equal(new Calendar(store).list().length, 1);
  await assert.rejects(
    () => invoke({ developerId: other.id, vacation: null }),
    /недоступен/,
  );
  await assert.rejects(() =>
    invoke({
      developerId: person.id,
      vacation: { start: "2099-11-09", end: "2099-11-08" },
    }),
  );
  assert.equal(updates, 2);
  stopped = true;
  await assert.rejects(
    () => invoke({ developerId: person.id, vacation: null }),
    /Cancelled/,
  );
  assert.equal(new Calendar(store).list().length, 1);
  stopped = false;
  const cancelled = await invoke({ developerId: person.id, vacation: null });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.developer.vacationStart, null);
  assert.equal(new Calendar(store).list().length, 0);
  assert.equal(updates, 3);
});

test("upcoming vacation boundaries use the vacation timezone and include arbitrarily distant dates", async () => {
  const { developerVacationStatus } =
    await import("../server/developer-vacation-status.js");
  const person = {
    vacationStart: "2026-10-26",
    vacationEnd: "2026-10-27",
    vacationZone: "Asia/Bishkek",
  };
  assert.equal(
    developerVacationStatus(person, "2026-10-25T17:59:59Z"),
    "upcoming",
  );
  assert.equal(
    developerVacationStatus(person, "2026-10-25T18:00:00Z"),
    "current",
  );
  assert.equal(
    developerVacationStatus(person, "2026-10-27T17:59:59Z"),
    "current",
  );
  assert.equal(developerVacationStatus(person, "2026-10-27T18:00:00Z"), "past");
  assert.equal(
    developerVacationStatus(
      { ...person, vacationStart: null },
      "2026-10-25T00:00:00Z",
    ),
    "none",
  );
  assert.equal(
    developerVacationStatus(
      { ...person, vacationStart: "2099-01-01", vacationEnd: "2099-01-05" },
      "2026-10-25T00:00:00Z",
    ),
    "upcoming",
  );
});

test("chat developer search filters vacation status and preserves old unfiltered calls", async (t) => {
  const { localDeveloperTools } = await import("../server/local-developers.js");
  const store = fixture(t),
    people = new LocalDevelopers(store),
    context = { client: "Customer", project: "Project" };
  store.set("settings", {
    ...store.settings(),
    syncSchedule: { ...store.settings().syncSchedule, timeZone: "UTC" },
  });
  const add = (name: string, scope = context) =>
    people.add([name], scope).find((p) => p.name === name)!;
  const future = add("Future", { client: "", project: "" }),
    current = add("Current"),
    past = add("Past"),
    none = add("No leave"),
    foreign = add("Foreign", { client: "Other", project: "Other" });
  const today = new Date().toISOString().slice(0, 10);
  setDeveloperVacation(store, future.id, {
    start: "2099-01-01",
    end: "2099-01-05",
  });
  setDeveloperVacation(store, foreign.id, {
    start: "2099-01-01",
    end: "2099-01-05",
  });
  setDeveloperVacation(store, current.id, { start: today, end: today });
  setDeveloperVacation(store, past.id, {
    start: "2020-01-01",
    end: "2020-01-05",
  });
  const tool = localDeveloperTools(
    store,
    context,
    "Кто скоро в отпуск?",
    () => {},
  ).find((t) => t.name === "list_local_developers")!;
  const read = (args: any) => (tool.handler as any)(args);
  assert.equal((await read({})).developers.length, 4);
  for (const [status, id] of [
    ["upcoming", future.id],
    ["current", current.id],
    ["past", past.id],
    ["none", none.id],
  ]) {
    const rows = (await read({ vacationStatus: status })).developers;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    assert.equal(rows[0].vacationStatus, status);
  }
  assert.equal(
    (await read({ vacationStatus: "upcoming" })).developers[0].returnDate,
    "2099-01-06",
  );
  setDeveloperVacation(store, future.id, null);
  assert.equal(
    (await read({ vacationStatus: "upcoming" })).developers.length,
    0,
  );
});
