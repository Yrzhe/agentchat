import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { pruneMessages } from "../../scripts/prune-messages";
import { makeTestDb, seedWorkspace, seedAgent } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB;
let close: () => void;

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice"] });
  await seedAgent(db, { id: "a-alice", workspaceId: "ws1", userId: "u-alice" });
});
afterEach(() => close());

describe("pruneMessages (Batch 7 #19)", () => {
  it("deletes messages + their mentions older than the cutoff", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    // 40 days old → should be pruned
    await db.run(sql`INSERT INTO messages (id, workspace_id, sender_user_id, body, kind, created_at)
      VALUES ('m-old', 'ws1', 'u-alice', 'old', 'direct', ${now - 40 * dayMs})`);
    await db.run(sql`INSERT INTO mentions (message_id, target_agent_id) VALUES ('m-old', 'a-alice')`);
    // 5 days old → keep
    await db.run(sql`INSERT INTO messages (id, workspace_id, sender_user_id, body, kind, created_at)
      VALUES ('m-recent', 'ws1', 'u-alice', 'fresh', 'broadcast', ${now - 5 * dayMs})`);

    const r = await pruneMessages(db, 30);
    expect(r.messagesDeleted).toBe(1);
    expect(r.mentionsDeleted).toBe(1);

    const remaining = (await db.all(sql`SELECT id FROM messages`)) as { id: string }[];
    expect(remaining.map((r) => r.id)).toEqual(["m-recent"]);
  });

  it("rejects invalid daysToKeep", async () => {
    await expect(pruneMessages(db, 0)).rejects.toThrow();
    await expect(pruneMessages(db, -1)).rejects.toThrow();
    await expect(pruneMessages(db, 1.5)).rejects.toThrow();
  });
});
