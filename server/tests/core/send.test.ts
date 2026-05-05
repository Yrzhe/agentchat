import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendMessage } from "../../src/core/chat/send";
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

describe("sendMessage", () => {
  it("creates a broadcast message with no mentions when to is omitted", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "morning everyone",
    });
    expect(r.kind).toBe("broadcast");
    expect(r.mentioned).toEqual([]);
    const rows = (await db.all(sql`SELECT kind FROM messages`)) as { kind: string }[];
    expect(rows[0].kind).toBe("broadcast");
    const ms = (await db.all(sql`SELECT * FROM mentions`)) as unknown[];
    expect(ms).toHaveLength(0);
  });

  it("creates a direct message with mentions resolved by agent_id prefix", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "hey @a-bob please look",
      to: "@a-bob",
    });
    expect(r.kind).toBe("direct");
    expect(r.mentioned).toEqual(["a-bob"]);
  });

  it("rejects @all in body with 400-shaped error", async () => {
    await expect(
      sendMessage(db, {
        workspaceId: "ws1",
        senderAgentId: "a-alice",
        senderUserId: "u-alice",
        body: "@all heads up",
      })
    ).rejects.toMatchObject({ code: "BROADCAST_KEYWORD_FORBIDDEN" });
  });

  it("ignores @-mentions that don't resolve to a member or agent", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "@nobody hi",
      to: "@nobody",
    });
    expect(r.kind).toBe("direct");
    expect(r.mentioned).toEqual([]);
  });
});
