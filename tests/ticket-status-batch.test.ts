import test from "node:test";
import assert from "node:assert/strict";
import { changeTicketStates } from "../server/ticket-status-batch.js";
import { AppError } from "../server/store.js";
const item = (id: number, state = "Active", project = "Project") => ({
  id,
  rev: 7,
  fields: {
    "System.TeamProject": project,
    "System.WorkItemType": "Bug",
    "System.State": state,
  },
});

test("bulk states use one write envelope, two reads and one state lookup per type", async () => {
  let reads = 0,
    writes = 0,
    lookups = 0;
  const changes = [1, 2, 3].map((id) => ({ id, state: "RFT" }));
  const results = await changeTicketStates(changes, "Project", {
    read: async (ids) => {
      reads++;
      return ids.map((id) => item(id, reads === 1 ? "Active" : "RFT"));
    },
    states: async () => {
      lookups++;
      return ["Active", "RFT"];
    },
    beforeWrite: () => {},
    patch: async (prepared) => {
      writes++;
      assert.deepEqual(
        prepared,
        changes.map((x) => ({ ...x, revision: 7 })),
      );
      return prepared.map(() => ({ code: 200 }));
    },
  });
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  assert.equal(lookups, 1);
  assert.ok(results.every((x) => x.success && x.outcome === "changed"));
});

test("bulk verification reports partial success after an ambiguous write without retries", async () => {
  let reads = 0,
    writes = 0;
  const results = await changeTicketStates(
    [1, 2, 3, 4].map((id) => ({ id, state: "RFT" })),
    "Project",
    {
      read: async () =>
        ++reads === 1
          ? [item(1), item(2), item(3, "RFT"), item(4, "Active", "Other")]
          : [item(1, "RFT"), item(2)],
      states: async () => ["RFT"],
      beforeWrite: () => {},
      patch: async (prepared) => {
        writes++;
        assert.deepEqual(
          prepared.map((x) => x.id),
          [1, 2],
        );
        throw new AppError(502, "Timeout");
      },
    },
  );
  assert.equal(writes, 1);
  assert.equal(results[0].outcome, "confirmed_after_error");
  assert.equal(results[1].success, false);
  assert.match(results[1].error, /Timeout/);
  assert.equal(results[2].outcome, "already");
  assert.equal(results[3].success, false);
});

test("bulk refuses duplicate IDs and honors cancellation before write", async () => {
  let writes = 0;
  const access = {
    read: async () => [item(1), item(2)],
    states: async () => ["RFT"],
    patch: async () => {
      writes++;
    },
    beforeWrite: () => {
      throw new AppError(409, "Остановлено");
    },
  };
  await assert.rejects(
    changeTicketStates(
      [
        { id: 1, state: "RFT" },
        { id: 1, state: "RFT" },
      ],
      "Project",
      access,
    ),
    /уникальных/,
  );
  await assert.rejects(
    changeTicketStates(
      [
        { id: 1, state: "RFT" },
        { id: 2, state: "RFT" },
      ],
      "Project",
      access,
    ),
    /Остановлено/,
  );
  assert.equal(writes, 0);
});
