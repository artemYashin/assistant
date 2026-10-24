import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import {
  saveTicketNote,
  listTicketNotes,
  collectTicketNoteImages,
} from "../server/ticket-note-images.js";
import {
  saveTicketMetadata,
  ticketMetadata,
} from "../server/ticket-metadata.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=",
  "base64",
);
const marker = (id: string) => `https://orbit.invalid/ticket-note-image/${id}`;
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ticket-note-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.db
    .prepare(
      "INSERT INTO tickets VALUES (?,42,'Title','Active','','Bug','','','')",
    )
    .run(store.source());
  return store;
}
test("Markdown images preserve metadata, survive trash, clean on text update and expire with trash", (t) => {
  const store = fixture(t),
    source = store.source(),
    id = randomUUID(),
    context = { client: "", project: "" };
  saveTicketMetadata(store, 42, source, context, {
    notes: "old plain text",
    priority: 7,
    tags: ["keep"],
  });
  const saved = saveTicketNote(
    store,
    42,
    {
      source,
      notes: `**Bold** ![screen](${marker(id)})`,
      expectedNotes: "old plain text",
      uploadIds: JSON.stringify([id]),
    },
    [png],
  );
  assert.ok(saved.notes.includes("/api/ticket-note-images/"));
  assert.equal(ticketMetadata(store, 42).priority, 7);
  assert.deepEqual(ticketMetadata(store, 42).tags, ["keep"]);
  const path = join(store.dir, "ticket-note-images", id);
  assert.ok(existsSync(path));
  assert.equal(listTicketNotes(store)[0].localStatus, "added");
  store.db
    .prepare("INSERT INTO ticket_trash VALUES (?,?,?,?)")
    .run(
      source,
      42,
      JSON.stringify({ title: "Trash title", state: "Done" }),
      Date.now(),
    );
  store.db.prepare("DELETE FROM tickets WHERE id=42").run();
  const row = listTicketNotes(store)[0];
  assert.equal(row.localStatus, "deleted");
  assert.equal(row.title, "Trash title");
  assert.ok(existsSync(path));
  saveTicketMetadata(store, 42, source, context, { notes: "no image" });
  assert.equal(existsSync(path), false);
  const next = randomUUID();
  saveTicketNote(
    store,
    42,
    {
      source,
      notes: `![x](${marker(next)})`,
      expectedNotes: "no image",
      uploadIds: JSON.stringify([next]),
    },
    [png],
  );
  store.purgeTicketTrash(Date.now() + 31 * 86400000);
  assert.equal(existsSync(join(store.dir, "ticket-note-images", next)), false);
  assert.deepEqual(listTicketNotes(store), []);
});
test("stale save, invalid image reference and failed upload leave original note and files intact", (t) => {
  const store = fixture(t),
    source = store.source(),
    id = randomUUID();
  const saved = saveTicketNote(
    store,
    42,
    {
      source,
      notes: `![x](${marker(id)})`,
      expectedNotes: "",
      uploadIds: JSON.stringify([id]),
    },
    [png],
  );
  assert.throws(
    () =>
      saveTicketNote(
        store,
        42,
        { source, notes: "wrong", expectedNotes: "" },
        [],
      ),
    /другом окне/,
  );
  const fresh = randomUUID();
  assert.throws(
    () =>
      saveTicketNote(
        store,
        42,
        {
          source,
          notes: `![x](${marker(fresh)}) ![bad](/api/ticket-note-images/${randomUUID()})`,
          expectedNotes: saved.notes,
          uploadIds: JSON.stringify([fresh]),
        },
        [png],
      ),
    /не принадлежит/,
  );
  assert.equal(ticketMetadata(store, 42).notes, saved.notes);
  assert.deepEqual(readdirSync(join(store.dir, "ticket-note-images")), [id]);
  assert.throws(
    () =>
      saveTicketNote(
        store,
        42,
        {
          source,
          notes: "x",
          expectedNotes: saved.notes,
          uploadIds: "not json",
        },
        [],
      ),
    /Некорректный/,
  );
});
test("populated upgrade and repeated restart preserve old plain notes and collection identity", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ticket-note-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let store = new Store(dir);
  store.db.prepare("DROP TABLE ticket_note_images").run();
  store.db
    .prepare(
      "INSERT INTO ticket_metadata VALUES ('collection-a',42,'old **literal** text',8,'[\"tag\"]')",
    )
    .run();
  store.db
    .prepare(
      "INSERT INTO ticket_metadata VALUES ('collection-b',42,'Other note',3,'[]')",
    )
    .run();
  store.close();
  for (let i = 0; i < 2; i++) {
    store = new Store(dir);
    collectTicketNoteImages(store);
    const rows = listTicketNotes(store);
    assert.equal(rows.length, 2);
    assert.equal(
      ticketMetadata(store, 42, "collection-a").notes,
      "old **literal** text",
    );
    assert.equal(ticketMetadata(store, 42, "collection-a").priority, 8);
    assert.deepEqual(ticketMetadata(store, 42, "collection-a").tags, ["tag"]);
    store.close();
  }
});

test("ticket note HTTP upload requires auth and CSRF, returns private images and keeps draft conflicts explicit", async (t) => {
  const { default: request } = await import("supertest");
  const { createApp } = await import("../server/app.js");
  const store = fixture(t),
    { app } = createApp(store),
    source = store.source(),
    image = randomUUID();
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  await request(app).get("/api/ticket-notes").set(headers).expect(401);
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
  await request(app)
    .put("/api/ticket-notes/42")
    .set({ ...headers, Cookie: auth.Cookie })
    .field("source", source)
    .field("notes", "x")
    .field("expectedNotes", "")
    .expect(403);
  const saved = await request(app)
    .put("/api/ticket-notes/42")
    .set(auth)
    .field("source", source)
    .field("notes", `![x](${marker(image)})`)
    .field("expectedNotes", "")
    .field("uploadIds", JSON.stringify([image]))
    .attach("images", png, "screen.png")
    .expect(200);
  await request(app)
    .get("/api/ticket-note-images/" + image)
    .set(headers)
    .expect(401);
  const result = await request(app)
    .get("/api/ticket-note-images/" + image)
    .set(auth)
    .expect(200);
  assert.equal(result.headers["cache-control"], "private, no-store");
  await request(app)
    .put("/api/ticket-notes/42")
    .set(auth)
    .field("source", source)
    .field("notes", "stale")
    .field("expectedNotes", "")
    .expect(409);
  const list = await request(app)
    .get("/api/ticket-notes")
    .set(auth)
    .expect(200);
  assert.equal(list.body[0].notes, saved.body.notes);
  await request(app)
    .put("/api/ticket-notes/42")
    .set(auth)
    .field("source", source)
    .field("notes", "")
    .field("expectedNotes", saved.body.notes)
    .expect(200);
  await request(app)
    .get("/api/ticket-note-images/" + image)
    .set(auth)
    .expect(404);
});
