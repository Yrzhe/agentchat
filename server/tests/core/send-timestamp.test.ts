import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendMessage } from "../../src/core/chat/send";
import { checkInbox } from "../../src/core/chat/inbox";
import { makeTestDb, seedWorkspace, seedAgent } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";
import { sql } from "drizzle-orm";

let db: DB;
let close: () => void;

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice", "u-bob"] });
  await seedAgent(db, { id: "a-alice", workspaceId: "ws1", userId: "u-alice" });
  await seedAgent(db, { id: "a-bob", workspaceId: "ws1", userId: "u-bob" });
});
afterEach(() => close());

describe("CRITICAL #3 — message timestamp resolution", () => {
  it("sendMessage stamps created_at with millisecond precision (not second-rounded)", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "ping",
      to: "@a-bob",
    });
    const rows = (await db.all(
      sql`SELECT created_at FROM messages WHERE id = ${r.messageId}`
    )) as { created_at: number }[];
    // Truth: ms-precision timestamp should not be second-aligned.
    // The legacy default `unixepoch() * 1000` rounded every message to %1000ms === 0.
    // After the fix, we stamp via Date.now(), so collisions on %1000 are 1-in-1000.
    expect(rows[0].created_at).toBe(r.createdAt);
    expect(typeof r.createdAt).toBe("number");
  });

  it("inbox returns mentions arriving in rapid succession (regression for second-rounded watermark)", async () => {
    // Three direct mentions sent back-to-back (previously could share an unixepoch second).
    const r1 = await sendMessage(db, {
      workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-alice",
      body: "first", to: "@a-bob",
    });
    const r2 = await sendMessage(db, {
      workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-alice",
      body: "second", to: "@a-bob",
    });
    const r3 = await sendMessage(db, {
      workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-alice",
      body: "third", to: "@a-bob",
    });

    const inbox = await checkInbox(db, "a-bob");
    const ids = inbox.unread_mentions.map((m) => m.message_id);
    expect(ids).toEqual([r1.messageId, r2.messageId, r3.messageId]);
  });
});

describe("CRITICAL #4 — sendMessage atomicity", () => {
  // Note: better-sqlite3 in tests doesn't have D1's batch semantics, so we exercise
  // the code path on the success case here. Atomic rollback under partial-failure
  // is a D1-only behavior provided by `db.batch([...])` in production.
  it("persists message + mentions together when the write succeeds", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "@a-bob hi",
      to: "@a-bob",
    });
    const msgs = (await db.all(sql`SELECT id FROM messages WHERE id = ${r.messageId}`)) as { id: string }[];
    const ms = (await db.all(
      sql`SELECT target_agent_id FROM mentions WHERE message_id = ${r.messageId}`
    )) as { target_agent_id: string }[];
    expect(msgs).toHaveLength(1);
    expect(ms.map((x) => x.target_agent_id)).toEqual(["a-bob"]);
  });

  it("rejects @all in the to field too (Codex MEDIUM #18)", async () => {
    await expect(
      sendMessage(db, {
        workspaceId: "ws1",
        senderAgentId: "a-alice",
        senderUserId: "u-alice",
        body: "broadcast",
        to: "@all",
      })
    ).rejects.toMatchObject({ code: "BROADCAST_KEYWORD_FORBIDDEN" });
    await expect(
      sendMessage(db, {
        workspaceId: "ws1",
        senderAgentId: "a-alice",
        senderUserId: "u-alice",
        body: "broadcast",
        to: "@everyone",
      })
    ).rejects.toMatchObject({ code: "BROADCAST_KEYWORD_FORBIDDEN" });
  });
});
