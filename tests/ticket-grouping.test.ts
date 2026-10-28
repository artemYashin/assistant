import assert from "node:assert/strict";
import test from "node:test";
import {
  groupedTicketRows,
  parseGroupPreferences,
  uniqueGroupTickets,
} from "../services/frontend/src/pages/tickets/model/grouping.js";

const ticket = (id: number, extra: Record<string, unknown> = {}) => ({
  source: "azure-a",
  id,
  type: "User Story",
  title: `Task ${id}`,
  ...extra,
});

test("group preferences default safely without changing existing settings", () => {
  for (const value of [null, "", "broken json", "null", "42", "{}"])
    assert.deepEqual(parseGroupPreferences(value), { mode: "list", parentTypes: [] });
  assert.deepEqual(
    parseGroupPreferences(
      JSON.stringify({
        mode: "grouped",
        parentTypes: ["Bug", "Bug", null, 3, "", " ", "User Story"],
      }),
    ),
    { mode: "grouped", parentTypes: ["Bug", "User Story"] },
  );
  assert.equal(parseGroupPreferences('{"mode":"future-mode"}').mode, "list");
});

test("list mode preserves filtered root order and never inserts children", () => {
  const roots = [ticket(2), ticket(1)];
  const rows = groupedTicketRows(
    roots,
    false,
    ["User Story"],
    { 2: { id: 2, childIds: [3], children: [ticket(3)] } },
    new Set([2]),
  );
  assert.deepEqual(
    rows.map((row) => row.ticket),
    roots,
  );
  assert.ok(rows.every((row) => !row.child && !row.expandable && !row.expanded));
});

test("grouping expands only configured root types, at exactly one level", () => {
  const roots = [ticket(1), ticket(2, { type: "Bug" })];
  const rows = groupedTicketRows(
    roots,
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [3], children: [ticket(3)] },
      2: { id: 2, childIds: [4], children: [ticket(4)] },
      3: { id: 3, childIds: [5], children: [ticket(5)] },
    },
    new Set([1, 2, 3]),
  );
  assert.deepEqual(
    rows.map((row) => row.ticket.id),
    [1, 3, 2],
  );
  assert.equal(rows[0].expandable, true);
  assert.equal(rows[1].child, true);
  assert.equal(rows[1].expandable, false);
  assert.equal(rows[1].expanded, false);
  assert.equal(rows[2].expandable, false);
});

test("children bypass root filtering, including unimported and trashed tickets", () => {
  const roots = [ticket(1, { state: "Active" })];
  const children = [
    ticket(2, { state: "Closed", imported: false }),
    ticket(3, { state: "Removed", inTrash: true }),
  ];
  const rows = groupedTicketRows(
    roots,
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [2, 3], children },
      99: { id: 99, childIds: [100], children: [ticket(100)] },
    },
    new Set([1, 99]),
  );
  assert.deepEqual(
    rows.map((row) => row.ticket),
    [...roots, ...children],
  );
  assert.deepEqual(roots, [ticket(1, { state: "Active" })]);
});

test("shared child is shown under each parent with distinct row keys and one selection", () => {
  const child = ticket(3);
  const rows = groupedTicketRows(
    [ticket(1), ticket(2), child],
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [3], children: [child] },
      2: { id: 2, childIds: [3], children: [child] },
    },
    new Set([1, 2]),
  );
  assert.deepEqual(
    rows.map((row) => row.ticket.id),
    [1, 3, 2, 3],
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.deepEqual(
    uniqueGroupTickets(rows).map((item) => item.id),
    [1, 3, 2],
  );
});

test("selection excludes unavailable children and distinguishes source identities", () => {
  const roots = [ticket(1), ticket(1, { source: "azure-b" })];
  const rows = groupedTicketRows(
    roots,
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [9], children: [ticket(9, { unavailable: true })] },
    },
    new Set([1]),
  );
  assert.deepEqual(uniqueGroupTickets(rows), roots);
});

test("collapsed parents retain expansion affordance without requiring child details", () => {
  const rows = groupedTicketRows(
    [ticket(1), ticket(2)],
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [3] },
      2: { id: 2, childIds: [] },
    },
    new Set(),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].expandable, true);
  assert.equal(rows[0].expanded, false);
  assert.equal(rows[1].expandable, false);
});

test("known children leave root list even while parents are collapsed", () => {
  const rows = groupedTicketRows(
    [ticket(3, { type: "Task" }), ticket(1)],
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [3] },
    },
    new Set(),
  );
  assert.deepEqual(
    rows.map((row) => row.ticket.id),
    [1],
  );
});

test("children remain roots when their parent is filtered out or its type is not selected", () => {
  const parents = { 1: { id: 1, childIds: [3] } };
  assert.deepEqual(
    groupedTicketRows([ticket(3)], true, ["User Story"], parents, new Set()).map(
      (row) => row.ticket.id,
    ),
    [3],
  );
  assert.deepEqual(
    groupedTicketRows([ticket(1), ticket(3)], true, ["Bug"], parents, new Set()).map(
      (row) => row.ticket.id,
    ),
    [1, 3],
  );
});

test("one-level chains and cycles retain reachable roots independently of sorting", () => {
  const parents = {
    1: { id: 1, childIds: [2], children: [ticket(2)] },
    2: { id: 2, childIds: [3], children: [ticket(3)] },
  };
  for (const roots of [
    [ticket(1), ticket(2), ticket(3)],
    [ticket(3), ticket(2), ticket(1)],
  ]) {
    const rows = groupedTicketRows(roots, true, ["User Story"], parents, new Set([1, 2]));
    assert.deepEqual(
      rows
        .filter((row) => !row.child)
        .map((row) => row.ticket.id)
        .sort(),
      [1, 3],
    );
    assert.deepEqual(
      uniqueGroupTickets(rows)
        .map((row) => row.id)
        .sort(),
      [1, 2, 3],
    );
  }
  const cycle = groupedTicketRows(
    [ticket(2), ticket(1)],
    true,
    ["User Story"],
    {
      1: { id: 1, childIds: [2], children: [ticket(2)] },
      2: { id: 2, childIds: [1], children: [ticket(1)] },
    },
    new Set([1, 2]),
  );
  assert.deepEqual(
    cycle.map((row) => row.ticket.id),
    [1, 2],
  );
});
