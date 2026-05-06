import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendMessage } from "../../src/core/chat/send";
import { makeTestDb, seedWorkspace, seedAgent } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB;
let close: () => void;

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, {
    id: "ws1", ownerUserId: "u-alice",
    userIds: ["u-alice", "u-bob", "u-carol"],
  });
  await seedAgent(db, { id: "a-alice", workspaceId: "ws1", userId: "u-alice" });
  await seedAgent(db, { id: "a-bob", workspaceId: "ws1", userId: "u-bob" });
  await seedAgent(db, { id: "a-carol", workspaceId: "ws1", userId: "u-carol" });
});
afterEach(() => close());

describe("resolveMentions — batched (Codex review MED #17)", () => {
  it("resolves multiple exact-id mentions in one go", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "@a-bob @a-carol look",
      to: "@a-bob",
    });
    expect(r.mentioned.sort()).toEqual(["a-bob", "a-carol"]);
  });

  it("resolves a mix of exact, prefix, and user-name mentions in one send", async () => {
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "ping @a-bob @u-c", // exact id + prefix that uniquely matches a-carol's user (u-carol)
      to: "@a-bob",
    });
    // a-bob is the explicit `to`. The body's @a-bob is a redundant exact match (deduped).
    // @u-c is a prefix that doesn't uniquely match any agent_id (no agent_id starts with "u-c"),
    // so it falls through to user-name match — but no user is literally named "u-c", so it stays unresolved.
    expect(r.mentioned).toContain("a-bob");
  });

  it("ambiguous prefix is dropped (matches >1)", async () => {
    // Add a second agent with id starting with "a-b" so "@a-b" prefix is ambiguous.
    await seedAgent(db, { id: "a-b2", workspaceId: "ws1", userId: "u-bob", deviceId: "dev-b2" });
    const r = await sendMessage(db, {
      workspaceId: "ws1",
      senderAgentId: "a-alice",
      senderUserId: "u-alice",
      body: "hey @a-b please",
      to: "@a-alice",
    });
    expect(r.mentioned).not.toContain("a-bob");
    expect(r.mentioned).not.toContain("a-b2");
    expect(r.mentioned).toContain("a-alice");
  });
});
