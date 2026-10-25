import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Store } from "../server/store.js";
import { Notes } from "../server/notes.js";
import { createApp } from "../server/app.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=",
  "base64",
);
const marker = (id: string) => `https://orbit.invalid/note-image/${id}`;
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-notes-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, notes: new Notes(store) };
}
test("notes save image files, delete only unreferenced files and preserve unrelated notes", (t) => {
  const { notes } = fixture(t),
    one = notes.create(randomUUID()),
    two = notes.create(randomUUID()),
    a = randomUUID(),
    b = randomUUID();
  const saved = notes.save(
    one.id,
    {
      title: "One",
      body: `![A](${marker(a)}) ![B](${marker(b)})`,
      revision: 1,
      uploadIds: JSON.stringify([a, b]),
    },
    [png, png],
  );
  assert.equal(saved.revision, 2);
  assert.equal(notes.image(one.id, a).mime, "image/png");
  assert.ok(existsSync(join(notes.directory, a)));
  assert.ok(!saved.body.includes("orbit.invalid"));
  const next = notes.save(
    one.id,
    {
      title: "One",
      body: `![B](/api/notes/${one.id}/images/${b})`,
      revision: 2,
    },
    [],
  );
  assert.ok(!existsSync(join(notes.directory, a)));
  assert.ok(existsSync(join(notes.directory, b)));
  assert.throws(() => notes.image(two.id, b), /не найдена/);
  assert.throws(
    () => notes.save(one.id, { title: "Stale", body: "", revision: 2 }, []),
    /другом окне/,
  );
  assert.equal(notes.read(one.id).body, next.body);
  notes.remove(one.id, 3);
  assert.ok(!existsSync(join(notes.directory, b)));
  assert.equal(notes.read(two.id).id, two.id);
});
test("failed saves roll back metadata and collect new files without touching saved images", (t) => {
  const { notes } = fixture(t),
    note = notes.create(randomUUID()),
    a = randomUUID(),
    b = randomUUID();
  notes.save(
    note.id,
    {
      title: "Keep",
      body: `![A](${marker(a)})`,
      revision: 1,
      uploadIds: JSON.stringify([a]),
    },
    [png],
  );
  const old = notes.read(note.id);
  assert.throws(
    () =>
      notes.save(
        note.id,
        {
          title: "Bad",
          body: `![B](${marker(b)}) ![Missing](/api/notes/${note.id}/images/${randomUUID()})`,
          revision: 2,
          uploadIds: JSON.stringify([b]),
        },
        [png],
      ),
    /не принадлежит/,
  );
  assert.deepEqual(notes.read(note.id), old);
  assert.ok(existsSync(join(notes.directory, a)));
  assert.ok(!existsSync(join(notes.directory, b)));
  assert.throws(
    () =>
      notes.save(
        note.id,
        {
          title: "Bad",
          body: "x",
          revision: 2,
          uploadIds: JSON.stringify([randomUUID()]),
        },
        [Buffer.from("<svg/>")],
      ),
    /PNG/,
  );
  assert.deepEqual(readdirSync(notes.directory), [a]);
});
test("populated storage upgrades and restarts preserve notes and files, recover orphan files only", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-notes-upgrade-"));
  let store = new Store(dir);
  try {
    store.set("existing-setting", { important: true });
    let notes = new Notes(store);
    const note = notes.create(randomUUID()),
      id = randomUUID();
    notes.save(
      note.id,
      {
        title: "Existing",
        body: `![A](${marker(id)})`,
        revision: 1,
        uploadIds: JSON.stringify([id]),
      },
      [png],
    );
    const orphan = randomUUID();
    writeFileSync(join(notes.directory, orphan), png);
    writeFileSync(join(notes.directory, "keep.txt"), "unmanaged");
    for (let i = 0; i < 2; i++) {
      store.close();
      store = new Store(dir);
      notes = new Notes(store);
      assert.equal(notes.read(note.id).title, "Existing");
      assert.deepEqual(notes.image(note.id, id).bytes, png);
      assert.ok(!existsSync(join(notes.directory, orphan)));
      assert.ok(existsSync(join(notes.directory, "keep.txt")));
      assert.deepEqual(store.get("existing-setting", null), {
        important: true,
      });
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("note routes require auth and CSRF; multipart save and private image access", async (t) => {
  const { store } = fixture(t),
    { app } = createApp(store),
    id = randomUUID(),
    image = randomUUID();
  const headers = {
    Host: "localhost:43871",
    Origin: "http://localhost:43871",
    "X-Orbit-Request": "1",
  };
  await request(app).get("/api/notes").set(headers).expect(401);
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
  await request(app).post("/api/notes").set(auth).send({ id }).expect(200);
  await request(app)
    .put("/api/notes/" + id)
    .set(auth)
    .field("title", "Saved")
    .field("body", `![A](${marker(image)})`)
    .field("revision", "1")
    .field("uploadIds", JSON.stringify([image]))
    .attach("images", png, "image.png")
    .expect(200);
  await request(app)
    .get(`/api/notes/${id}/images/${image}`)
    .set(headers)
    .expect(401);
  const result = await request(app)
    .get(`/api/notes/${id}/images/${image}`)
    .set(auth)
    .expect(200);
  assert.equal(result.headers["cache-control"], "private, no-store");
  await request(app)
    .delete("/api/notes/" + id)
    .set({ ...headers, Cookie: auth.Cookie })
    .send({ revision: 2 })
    .expect(403);
  await request(app)
    .delete("/api/notes/" + id)
    .set(auth)
    .send({ revision: 2 })
    .expect(200);
  await request(app)
    .get(`/api/notes/${id}/images/${image}`)
    .set(auth)
    .expect(404);
});

test("first save is atomic and retry after lost response creates no duplicates", (t) => {
  const { store, notes } = fixture(t),
    id = randomUUID(),
    image = randomUUID();
  const input = {
    title: "First save",
    body: `![x](${marker(image)})`,
    revision: 0,
    uploadIds: JSON.stringify([image]),
  };
  const saved = notes.save(id, input, [png]);
  assert.equal(saved.revision, 1);
  assert.deepEqual(notes.save(id, input, [png]), saved);
  assert.equal(notes.list().length, 1);
  assert.throws(
    () => notes.save(id, { ...input, title: "Different" }, [png]),
    /уже создана/,
  );
  const failed = randomUUID(),
    bad = randomUUID();
  assert.throws(() =>
    notes.save(
      failed,
      {
        title: "Rollback",
        body: `![x](${marker(bad)}) ![missing](/api/notes/${failed}/images/${randomUUID()})`,
        revision: 0,
        uploadIds: JSON.stringify([bad]),
      },
      [png],
    ),
  );
  assert.equal(
    store.db.prepare("SELECT 1 FROM personal_notes WHERE id=?").get(failed),
    undefined,
  );
  assert.equal(existsSync(join(notes.directory, bad)), false);
  assert.equal(notes.read(id).body, saved.body);
});
