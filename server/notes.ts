import {
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Express } from "express";
import multer from "multer";
import { Store, AppError } from "./store.js";
import { commentImageType } from "./comment-markdown.js";

const uuid = z.string().uuid();
const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200000),
  revision: z.coerce.number().int().min(0),
  uploadIds: z
    .string()
    .default("[]")
    .transform((v, ctx) => {
      try {
        return z.array(uuid).max(10).parse(JSON.parse(v));
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Некорректный список картинок заметки.",
        });
        return z.NEVER;
      }
    }),
});
type Note = {
  id: string;
  title: string;
  body: string;
  revision: number;
  updated_at: string;
};
export class Notes {
  readonly directory: string;
  constructor(private store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_notes(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_note_images(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES personal_notes(id) ON DELETE CASCADE,mime TEXT NOT NULL,size INTEGER NOT NULL);
    `);
    this.directory = join(store.dir, "note-images");
    mkdirSync(this.directory, { recursive: true });
    this.collect();
  }
  list() {
    return this.store.db
      .prepare(
        "SELECT id,title,substr(body,1,160) AS snippet,revision,updated_at FROM personal_notes ORDER BY updated_at DESC,id",
      )
      .all();
  }
  read(id: string) {
    uuid.parse(id);
    const note = this.store.db
      .prepare("SELECT * FROM personal_notes WHERE id=?")
      .get(id) as Note | undefined;
    if (!note) throw new AppError(404, "Заметка не найдена.");
    return note;
  }
  create(id: string) {
    uuid.parse(id);
    this.store.db
      .prepare(
        "INSERT OR IGNORE INTO personal_notes(id,title,updated_at) VALUES (?,'Новая заметка',?)",
      )
      .run(id, new Date().toISOString());
    return this.read(id);
  }
  save(id: string, input: unknown, files: Buffer[]) {
    uuid.parse(id);
    const v = draftSchema.parse(input);
    if (
      files.length !== v.uploadIds.length ||
      new Set(v.uploadIds).size !== v.uploadIds.length
    )
      throw new AppError(400, "Некорректный список картинок заметки.");
    if (
      files.some((b) => !b.length || b.length > 10 * 1024 * 1024) ||
      files.reduce((n, b) => n + b.length, 0) > 30 * 1024 * 1024
    )
      throw new AppError(
        400,
        "Картинка должна быть до 10 МБ, новые картинки вместе — до 30 МБ.",
      );
    const formats = files.map(commentImageType);
    try {
      this.store.db
        .transaction(() => {
          if (v.revision === 0) {
            const existing = this.store.db
              .prepare("SELECT * FROM personal_notes WHERE id=?")
              .get(id) as Note | undefined;
            if (existing) {
              let canonical = v.body;
              for (const imageId of v.uploadIds)
                canonical = canonical.replaceAll(
                  `https://orbit.invalid/note-image/${imageId}`,
                  `/api/notes/${id}/images/${imageId}`,
                );
              if (
                existing.revision === 1 &&
                existing.title === v.title &&
                existing.body === canonical
              )
                return;
              throw new AppError(
                409,
                "Заметка уже создана. Откройте сохранённую версию перед изменением.",
              );
            }
            this.store.db
              .prepare(
                "INSERT INTO personal_notes(id,title,revision,updated_at) VALUES (?,?,0,?)",
              )
              .run(id, v.title, new Date().toISOString());
          }
          const old = this.read(id);
          if (old.revision !== v.revision)
            throw new AppError(
              409,
              "Заметка изменена в другом окне. Скопируйте свой текст, затем откройте сохранённую версию.",
            );
          let body = v.body;
          const used = new Set<string>();
          for (let i = 0; i < files.length; i++) {
            const imageId = v.uploadIds[i],
              marker = `https://orbit.invalid/note-image/${imageId}`;
            if (!body.includes(marker))
              throw new AppError(400, "Картинка отсутствует в тексте заметки.");
            if (
              this.store.db
                .prepare("SELECT 1 FROM personal_note_images WHERE id=?")
                .get(imageId)
            )
              throw new AppError(
                409,
                "Картинка уже сохранена. Откройте актуальную заметку.",
              );
            writeFileSync(join(this.directory, imageId), files[i], {
              flag: "wx",
              mode: 0o600,
            });
            this.store.db
              .prepare(
                "INSERT INTO personal_note_images(id,note_id,mime,size) VALUES (?,?,?,?)",
              )
              .run(imageId, id, formats[i], files[i].length);
            body = body.replaceAll(
              marker,
              `/api/notes/${id}/images/${imageId}`,
            );
          }
          if (body.includes("https://orbit.invalid/note-image/"))
            throw new AppError(
              400,
              "Не все картинки доступны. Вставьте отсутствующее изображение заново.",
            );
          for (const match of body.matchAll(
            /\/api\/notes\/([^/\s)]+)\/images\/([0-9a-f-]{36})/g,
          )) {
            if (
              match[1] !== id ||
              !this.store.db
                .prepare(
                  "SELECT 1 FROM personal_note_images WHERE id=? AND note_id=?",
                )
                .get(match[2], id)
            )
              throw new AppError(
                400,
                "Картинка не принадлежит этой заметке или уже удалена. Вставьте её заново.",
              );
            used.add(match[2]);
          }
          if (used.size > 10)
            throw new AppError(400, "В заметке может быть до 10 картинок.");
          this.store.db
            .prepare(
              "UPDATE personal_notes SET title=?,body=?,revision=revision+1,updated_at=? WHERE id=?",
            )
            .run(v.title, body, new Date().toISOString(), id);
          for (const row of this.store.db
            .prepare("SELECT id FROM personal_note_images WHERE note_id=?")
            .all(id) as { id: string }[]) {
            if (!used.has(row.id))
              this.store.db
                .prepare("DELETE FROM personal_note_images WHERE id=?")
                .run(row.id);
          }
        })
        .immediate();
    } finally {
      this.collect();
    }
    return this.read(id);
  }
  remove(id: string, revision: number) {
    this.store.db
      .transaction(() => {
        if (this.read(id).revision !== revision)
          throw new AppError(
            409,
            "Заметка изменена в другом окне. Откройте актуальную версию перед удалением.",
          );
        this.store.db.prepare("DELETE FROM personal_notes WHERE id=?").run(id);
      })
      .immediate();
    this.collect();
  }
  image(noteId: string, id: string) {
    uuid.parse(noteId);
    uuid.parse(id);
    const row = this.store.db
      .prepare("SELECT mime FROM personal_note_images WHERE id=? AND note_id=?")
      .get(id, noteId) as { mime: string } | undefined;
    if (!row) throw new AppError(404, "Картинка заметки не найдена.");
    try {
      return { mime: row.mime, bytes: readFileSync(join(this.directory, id)) };
    } catch {
      throw new AppError(404, "Файл картинки заметки недоступен.");
    }
  }
  collect() {
    // The write lock prevents collection racing another process's in-flight save.
    this.store.db
      .transaction(() => {
        const live = new Set(
          (
            this.store.db
              .prepare("SELECT id FROM personal_note_images")
              .all() as { id: string }[]
          ).map((r) => r.id),
        );
        for (const file of readdirSync(this.directory)) {
          if (uuid.safeParse(file).success && !live.has(file)) {
            try {
              unlinkSync(join(this.directory, file));
            } catch {
              /* Retry on next write/startup; never remove referenced files. */
            }
          }
        }
      })
      .immediate();
  }
}
export function registerNotes(app: Express, store: Store) {
  const notes = new Notes(store);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 10,
      fileSize: 10 * 1024 * 1024,
      fields: 4,
      fieldSize: 1024 * 1024,
    },
  }).array("images", 10);
  app.get("/api/notes", (_req, res) => res.json(notes.list()));
  app.post("/api/notes", (req, res) =>
    res.json(notes.create(uuid.parse(req.body.id))),
  );
  app.get("/api/notes/:id", (req, res) =>
    res.json(notes.read(String(req.params.id))),
  );
  app.put(
    "/api/notes/:id",
    (req, res, next) =>
      upload(req, res, (error) =>
        error
          ? next(
              new AppError(
                400,
                "Не удалось принять картинки. До 10 файлов по 10 МБ.",
              ),
            )
          : next(),
      ),
    (req, res) => {
      res.json(
        notes.save(
          String(req.params.id),
          req.body,
          ((req.files as Express.Multer.File[]) || []).map((f) => f.buffer),
        ),
      );
    },
  );
  app.delete("/api/notes/:id", (req, res) => {
    notes.remove(
      String(req.params.id),
      z.number().int().min(1).parse(req.body.revision),
    );
    res.json({ ok: true });
  });
  app.get("/api/notes/:note/images/:id", (req, res) => {
    const image = notes.image(String(req.params.note), String(req.params.id));
    res
      .type(image.mime)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(image.bytes);
  });
}
