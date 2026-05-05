import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkInbox } from "../../src/core/chat/inbox";
import { sendMessage } from "../../src/core/chat/send";
import { makeTestDb, seedWorkspace, seedAgent } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB; let close: () => void;
beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-a", userIds: ["u-a", "u-b"] });
  await seedAgent(db, { id: "a-alice", workspaceId: "ws1", userId: "u-a" });
  await seedAgent(db, { id: "a-bob", workspaceId: "ws1", userId: "u-b" });
});
afterEach(() => close());

describe("checkInbox", () => {
  it("returns 0 unread for an agent with no mentions", async () => {
    const r = await checkInbox(db, "a-bob");
    expect(r.unread_mentions).toEqual([]);
    expect(r.recent_broadcasts).toEqual([]);
  });

  it("returns directed mentions, then advances last_read_at so they're cleared next call", async () => {
    await sendMessage(db, { workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-a",
      body: "task for you", to: "@a-bob" });
    const r1 = await checkInbox(db, "a-bob");
    expect(r1.unread_mentions).toHaveLength(1);
    expect(r1.unread_mentions[0].body).toBe("task for you");
    const r2 = await checkInbox(db, "a-bob");
    expect(r2.unread_mentions).toEqual([]);
  });

  it("broadcasts appear in recent_broadcasts but not unread_mentions", async () => {
    await sendMessage(db, { workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-a",
      body: "morning everyone" });
    const r = await checkInbox(db, "a-bob");
    expect(r.unread_mentions).toEqual([]);
    expect(r.recent_broadcasts).toHaveLength(1);
    expect(r.recent_broadcasts[0].body).toBe("morning everyone");
  });

  it("recent_broadcasts is capped at 20, newest first", async () => {
    for (let i = 0; i < 25; i++) {
      await sendMessage(db, { workspaceId: "ws1", senderAgentId: "a-alice", senderUserId: "u-a",
        body: `msg ${i}` });
    }
    const r = await checkInbox(db, "a-bob");
    expect(r.recent_broadcasts).toHaveLength(20);
    expect(r.recent_broadcasts[0].body).toBe("msg 24");
  });
});
