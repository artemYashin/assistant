// Run through rollback-group-test.sh in the existing Orbit image, with Orbit stopped.
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
const directory = process.env.DATA_DIR || "/data";
const databasePath = path.join(directory, "orbit.sqlite");
const keyPath = path.join(directory, "master.key");
const cache = "ticket_relations_cache";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function integrity(db) {
  const results = db.pragma("integrity_check");
  if (results.length !== 1 || results[0].integrity_check !== "ok")
    throw new Error("SQLite integrity check failed; cleanup was not committed.");
}
async function main() {
  if (!fs.statSync(databasePath).isFile() || !fs.statSync(keyPath).isFile())
    throw new Error("Existing orbit.sqlite and master.key are required.");
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Invalid master.key; cleanup cancelled.");
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    integrity(db);
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(cache)) {
      console.log("Hierarchy cache is already absent. No data changed.");
      return;
    }
    const backupDirectory = path.join(
      directory,
      "backups",
      `before-group-test-rollback-${randomUUID()}`,
    );
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backupPath = path.join(backupDirectory, "orbit.sqlite");
    // SQLite backup includes committed WAL contents; copying only the database file would not.
    await db.backup(backupPath);
    fs.chmodSync(backupPath, 0o600);
    const backupKey = path.join(backupDirectory, "master.key");
    fs.writeFileSync(backupKey, key, { flag: "wx", mode: 0o600 });
    if (hash(fs.readFileSync(backupKey)) !== hash(key))
      throw new Error("Key backup verification failed.");
    const copy = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      integrity(copy);
      // Both schema and row counts must match before any removal. The service is stopped.
      const schema = (connection) =>
        connection
          .prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")
          .all();
      if (JSON.stringify(schema(db)) !== JSON.stringify(schema(copy)))
        throw new Error("Backup schema mismatch.");
      for (const { name } of db
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()) {
        const quoted = '"' + name.replaceAll('"', '""') + '"';
        const count = (connection) =>
          connection.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n;
        if (count(db) !== count(copy)) throw new Error("Backup row-count mismatch.");
      }
    } finally {
      copy.close();
    }
    fs.writeFileSync(
      path.join(backupDirectory, "VERIFIED.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          purpose: "group-test hierarchy cache rollback",
          scope: "SQLite and master.key; attachment files remain untouched",
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Verified backup: ${backupDirectory}`);
    db.transaction(() => {
      db.exec("DROP TABLE IF EXISTS ticket_relations_cache");
      integrity(db);
    })();
    console.log(
      "Removed only ticket_relations_cache. Tickets, trash, notes, settings and files were not reset.",
    );
  } finally {
    db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
