import { mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import multer from "multer";
import type { Express } from "express";
import { AppError, type Store } from "./store.js";
import { commentImageType } from "./comment-markdown.js";
const uuid = z.string().uuid();
const directory = (store: Store) => join(store.dir, "ticket-note-images");
export function collectTicketNoteImages(store: Store) {
  const dir = directory(store);
  mkdirSync(dir, { recursive: true });
  store.db
    .transaction(() => {
      const rows = store.db
        .prepare(
          "SELECT i.image_id,m.notes FROM ticket_note_images i LEFT JOIN ticket_metadata m ON m.source=i.source AND m.id=i.ticket_id",
        )
        .all() as { image_id: string; notes: string | null }[];
      for (const row of rows)
        if (!row.notes?.includes(`/api/ticket-note-images/${row.image_id}`))
          store.db.prepare("DELETE FROM ticket_note_images WHERE image_id=?").run(row.image_id);
      const live = new Set(
        (
          store.db.prepare("SELECT image_id FROM ticket_note_images").all() as {
            image_id: string;
          }[]
        ).map((r) => r.image_id),
      );
      for (const file of readdirSync(dir))
        if (uuid.safeParse(file).success && !live.has(file)) {
          try {
            unlinkSync(join(dir, file));
          } catch {
            /* Retry on next cleanup. */
          }
        }
    })
    .immediate();
}
export function saveTicketNote(store: Store, id: number, input: unknown, files: Buffer[]) {
  const v = z
    .object({
      source: z.string().min(1),
      notes: z.string().max(20000),
      expectedNotes: z.string().max(20000),
      uploadIds: z.string().default("[]"),
    })
    .parse(input);
  let ids: string[];
  try {
    ids = z.array(uuid).max(10).parse(JSON.parse(v.uploadIds));
  } catch {
    throw new AppError(400, "Некорректный список картинок заметки.");
  }
  if (ids.length !== files.length || new Set(ids).size !== ids.length)
    throw new AppError(400, "Некорректный список картинок заметки.");
  if (
    files.some((b) => b.length > 10 * 1024 * 1024) ||
    files.reduce((n, b) => n + b.length, 0) > 30 * 1024 * 1024
  )
    throw new AppError(400, "Картинки: до 10 МБ каждая, до 30 МБ за сохранение.");
  const formats = files.map(commentImageType);
  mkdirSync(directory(store), { recursive: true });
  let notes = v.notes;
  try {
    store.db
      .transaction(() => {
        const old = store.db
          .prepare("SELECT notes FROM ticket_metadata WHERE source=? AND id=?")
          .get(v.source, id) as { notes: string } | undefined;
        if (!old && !store.hasLocalTicket(id, v.source))
          throw new AppError(404, "Тикет отсутствует в локальном списке.");
        if ((old?.notes || "") !== v.expectedNotes)
          throw new AppError(
            409,
            "Заметки изменены в другом окне. Скопируйте черновик и откройте заметки заново.",
          );
        store.db
          .prepare("INSERT OR IGNORE INTO ticket_metadata(source,id) VALUES (?,?)")
          .run(v.source, id);
        for (let i = 0; i < ids.length; i++) {
          const marker = `https://orbit.invalid/ticket-note-image/${ids[i]}`;
          if (!notes.includes(marker)) throw new AppError(400, "Картинка отсутствует в заметке.");
          writeFileSync(join(directory(store), ids[i]), files[i], {
            flag: "wx",
            mode: 0o600,
          });
          store.db
            .prepare(
              "INSERT INTO ticket_note_images(image_id,source,ticket_id,mime) VALUES (?,?,?,?)",
            )
            .run(ids[i], v.source, id, formats[i]);
          notes = notes.replaceAll(marker, `/api/ticket-note-images/${ids[i]}`);
        }
        if (notes.includes("https://orbit.invalid/ticket-note-image/"))
          throw new AppError(400, "Вставьте отсутствующие картинки заново.");
        const used = new Set<string>();
        for (const match of notes.matchAll(/\/api\/ticket-note-images\/([0-9a-f-]{36})/g)) {
          if (
            !store.db
              .prepare(
                "SELECT 1 FROM ticket_note_images WHERE image_id=? AND source=? AND ticket_id=?",
              )
              .get(match[1], v.source, id)
          )
            throw new AppError(400, "Картинка не принадлежит заметкам этого тикета.");
          used.add(match[1]);
        }
        if (used.size > 10) throw new AppError(400, "В заметках тикета может быть до 10 картинок.");
        store.db
          .prepare("UPDATE ticket_metadata SET notes=? WHERE source=? AND id=?")
          .run(notes, v.source, id);
      })
      .immediate();
  } finally {
    collectTicketNoteImages(store);
  }
  return { notes };
}
export function listTicketNotes(store: Store) {
  store.purgeTicketTrash();
  collectTicketNoteImages(store);
  return (
    store.db
      .prepare(
        `SELECT m.source,m.id,m.notes,t.title,t.state,t.type,r.body AS trash_body,
    CASE WHEN t.id IS NOT NULL THEN 'added' WHEN r.id IS NOT NULL THEN 'deleted' ELSE 'not_imported' END AS localStatus
    FROM ticket_metadata m LEFT JOIN tickets t ON t.source=m.source AND t.id=m.id
    LEFT JOIN ticket_trash r ON r.source=m.source AND r.id=m.id WHERE trim(m.notes)<>'' ORDER BY m.id DESC,m.source`,
      )
      .all() as any[]
  ).map((r) => {
    let trash: any = {};
    try {
      trash = JSON.parse(r.trash_body || "{}");
    } catch {}
    return {
      source: r.source,
      id: r.id,
      notes: r.notes,
      title: r.title || trash.title || `Тикет #${r.id}`,
      state: r.state || trash.state || "",
      type: r.type || trash.type || "",
      localStatus: r.localStatus,
    };
  });
}
export function registerTicketNotes(app: Express, store: Store) {
  collectTicketNoteImages(store);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 10,
      fileSize: 10 * 1024 * 1024,
      fields: 4,
      fieldSize: 1024 * 1024,
    },
  }).array("images", 10);
  app.get("/api/ticket-notes", (_req, res) => res.json(listTicketNotes(store)));
  app.get("/api/ticket-notes/:id", (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id),
      source = z.string().min(1).parse(req.query.source);
    const row = store.db
      .prepare("SELECT notes FROM ticket_metadata WHERE source=? AND id=?")
      .get(source, id) as { notes: string } | undefined;
    res.json({ notes: row?.notes || "" });
  });
  app.put(
    "/api/ticket-notes/:id",
    (req, res, next) =>
      upload(req, res, (e) => (e ? next(new AppError(400, "До 10 картинок по 10 МБ.")) : next())),
    (req, res) =>
      res.json(
        saveTicketNote(
          store,
          z.coerce.number().int().positive().parse(req.params.id),
          req.body,
          ((req.files as Express.Multer.File[]) || []).map((f) => f.buffer),
        ),
      ),
  );
  app.get("/api/ticket-note-images/:id", (req, res) => {
    const id = uuid.parse(req.params.id),
      row = store.db.prepare("SELECT mime FROM ticket_note_images WHERE image_id=?").get(id) as
        { mime: string } | undefined;
    if (!row) throw new AppError(404, "Картинка заметки не найдена.");
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(directory(store), id));
    } catch {
      throw new AppError(404, "Файл картинки заметки недоступен.");
    }
    res
      .type(row.mime)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(bytes);
  });
}
