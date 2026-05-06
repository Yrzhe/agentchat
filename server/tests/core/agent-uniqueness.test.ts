import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { upsertAgent } from "../../src/core/agent/register";
import { makeTestDb, seedWorkspace } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB;
let close: () => void;

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice"] });
});
afterEach(() => close());

describe("agents NULL uniqueness (Codex/OpenCode review #26)", () => {
  it("does not allow two agents with same (workspace, device, framework, NULL session)", async () => {
    // Two raw INSERTs simulating what would happen if upsertAgent's lookup were ever bypassed.
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, host_session_id, status, last_heartbeat_at)
      VALUES ('a1', 'ws1', 'u-alice', 'claude-code', 'dev-x', NULL, 'online', ${Date.now()})`);
    let rejected = false;
    let errSummary = "";
    try {
      await db.run(sql`INSERT INTO agents
        (id, workspace_id, user_id, framework, device_id, host_session_id, status, last_heartbeat_at)
        VALUES ('a2', 'ws1', 'u-alice', 'claude-code', 'dev-x', NULL, 'online', ${Date.now()})`);
    } catch (e) {
      rejected = true;
      const err = e as Error & { cause?: Error; code?: string };
      errSummary = `${err.message} | cause: ${err.cause?.message ?? ""} | code: ${err.code ?? err.cause?.[ "code" as keyof Error] ?? ""}`;
    }
    expect(rejected).toBe(true);
    expect(errSummary).toMatch(/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/);
  });

  it("still allows agents on different sessions for the same device", async () => {
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, host_session_id, status, last_heartbeat_at)
      VALUES ('a1', 'ws1', 'u-alice', 'claude-code', 'dev-x', 'sess-1', 'online', ${Date.now()})`);
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, host_session_id, status, last_heartbeat_at)
      VALUES ('a2', 'ws1', 'u-alice', 'claude-code', 'dev-x', 'sess-2', 'online', ${Date.now()})`);
    const rows = (await db.all(sql`SELECT id FROM agents WHERE device_id = 'dev-x'`)) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("upsertAgent is idempotent — same input twice returns the same id", async () => {
    const id1 = await upsertAgent(db, {
      workspaceId: "ws1", userId: "u-alice", framework: "claude-code", deviceId: "dev-y",
    });
    const id2 = await upsertAgent(db, {
      workspaceId: "ws1", userId: "u-alice", framework: "claude-code", deviceId: "dev-y",
    });
    expect(id1).toBe(id2);
    const count = (await db.all(sql`SELECT COUNT(*) AS n FROM agents WHERE device_id = 'dev-y'`)) as { n: number }[];
    expect(count[0].n).toBe(1);
  });
});
