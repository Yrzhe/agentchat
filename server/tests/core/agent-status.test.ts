import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { liveStatus, IDLE_MS, OFFLINE_MS } from "../../src/core/agent/status";
import { listAgents } from "../../src/core/agent/list";
import { sql } from "drizzle-orm";
import { makeTestDb, seedWorkspace } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

describe("liveStatus (no DB)", () => {
  it("classifies recent heartbeat as online", () => {
    const now = 1_000_000_000_000;
    expect(liveStatus(now - 1_000, now)).toBe("online");
    expect(liveStatus(now - (IDLE_MS - 1), now)).toBe("online");
  });
  it("classifies stale-but-not-dead as idle", () => {
    const now = 1_000_000_000_000;
    expect(liveStatus(now - IDLE_MS, now)).toBe("idle");
    expect(liveStatus(now - (OFFLINE_MS - 1), now)).toBe("idle");
  });
  it("classifies very old as offline", () => {
    const now = 1_000_000_000_000;
    expect(liveStatus(now - OFFLINE_MS, now)).toBe("offline");
    expect(liveStatus(now - 10 * OFFLINE_MS, now)).toBe("offline");
  });
});

describe("listAgents — no read-triggers-write (CRITICAL #6)", () => {
  let db: DB;
  let close: () => void;

  beforeEach(async () => {
    ({ db, close } = makeTestDb());
    await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice"] });
  });
  afterEach(() => close());

  it("derives status from heartbeat at query time, ignoring stale cached column", async () => {
    const now = Date.now();
    // Insert two agents: one with a fresh heartbeat but cached status='offline',
    // one with an ancient heartbeat but cached status='online'. The live status
    // should override the cache in both cases.
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a-fresh', 'ws1', 'u-alice', 'claude-code', 'd1', 'offline', ${now - 1000})`);
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a-stale', 'ws1', 'u-alice', 'claude-code', 'd2', 'online', ${now - 60 * 60 * 1000})`);

    const list = await listAgents(db, "ws1", {});
    const fresh = list.find((a) => a.agent_id === "a-fresh")!;
    const stale = list.find((a) => a.agent_id === "a-stale")!;
    expect(fresh.status).toBe("online");
    expect(stale.status).toBe("offline");
  });

  it("does NOT mutate the cached status column on read", async () => {
    const now = Date.now();
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a-old', 'ws1', 'u-alice', 'claude-code', 'd1', 'online', ${now - 60 * 60 * 1000})`);

    await listAgents(db, "ws1", {});
    await listAgents(db, "ws1", {});

    const cached = (await db.all(
      sql`SELECT status FROM agents WHERE id = 'a-old'`
    )) as { status: string }[];
    // Pre-fix, listAgents would have run sweepStatuses() and flipped this to 'offline'.
    // The fix removes that write entirely — the cached column stays as written.
    expect(cached[0].status).toBe("online");
  });

  it("filter by status uses heartbeat threshold, not cached column", async () => {
    const now = Date.now();
    // Fresh heartbeat but cached as offline — should still match status='online' filter.
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a-1', 'ws1', 'u-alice', 'claude-code', 'd1', 'offline', ${now - 1000})`);
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a-2', 'ws1', 'u-alice', 'claude-code', 'd2', 'online', ${now - OFFLINE_MS - 1000})`);

    const onlines = await listAgents(db, "ws1", { status: "online" });
    const offlines = await listAgents(db, "ws1", { status: "offline" });
    expect(onlines.map((a) => a.agent_id)).toEqual(["a-1"]);
    expect(offlines.map((a) => a.agent_id)).toEqual(["a-2"]);
  });
});
