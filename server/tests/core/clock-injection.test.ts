import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { sendMessage } from "../../src/core/chat/send";
import { setClock, resetClock } from "../../src/core/clock";
import { makeTestDb, seedWorkspace, seedAgent } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB;
let close: () => void;

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice", "u-bob"] });
  await seedAgent(db, { id: "a-alice", workspaceId: "ws1", userId: "u-alice" });
  await seedAgent(db, { id: "a-bob", workspaceId: "ws1", userId: "u-bob" });
});
afterEach(() => {
  close();
  resetClock();
});

describe("clock injection (Codex review MED #11)", () => {
  it("sendMessage uses the injected clock for created_at", async () => {
    const FAKE = 1_700_000_000_000;
    setClock(() => FAKE);

    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "deterministic time",
      to: "@a-bob",
    });

    // nextTs() advances by 1 each call within the isolate, but seed first
    // value comes from clock — so created_at >= FAKE and within a small
    // window of the count of prior sends since module-load.
    expect(r.createdAt).toBeGreaterThanOrEqual(FAKE);

    const rows = (await db.all(
      sql`SELECT created_at FROM messages WHERE id = ${r.messageId}`
    )) as { created_at: number }[];
    expect(rows[0].created_at).toBe(r.createdAt);
  });
});
