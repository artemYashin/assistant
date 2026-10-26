import test from "node:test";
import assert from "node:assert/strict";
import { noteImageBudget } from "../services/frontend/src/entities/note/index.js";
for (const kind of ["free", "ticket"] as const)
  test(`${kind}: removed drafts do not consume limits and Undo restores accounting`, () => {
    const images = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      file: { size: 100 },
    }));
    assert.deepEqual(noteImageBudget("", images, kind), { count: 0, bytes: 0 });
    const marker = `https://orbit.invalid/${kind === "free" ? "note-image" : "ticket-note-image"}/0`;
    const saved = kind === "free" ? "/api/notes/abcd/images/1234" : "/api/ticket-note-images/1234";
    assert.deepEqual(
      noteImageBudget(`![a](${marker}) ![b](${saved}) ![b](${saved})`, images, kind),
      { count: 2, bytes: 100 },
    );
  });
