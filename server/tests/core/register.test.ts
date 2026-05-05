import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { upsertAgent } from "../../src/core/agent/register";
import { listAgents } from "../../src/core/agent/list";
import { makeTestDb, seedWorkspace } from "../helpers/db-fixture";
import type { DB } from "../../src/core/platform";

let db: DB; let close: () => void;
beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-a", userIds: ["u-a"] });
});
afterEach(() => close());

describe("upsertAgent", () => {
  it("creates a new agent on first call", async () => {
    const id = await upsertAgent(db, {
      workspaceId: "ws1", userId: "u-a", framework: "claude-code", frameworkVersion: "0.5.0",
      deviceId: "dev-1", deviceName: "yrzhetop", hostSessionId: "sess-1", cwd: "/repo",
    });
    expect(id).toMatch(/^.+/);
    const list = await listAgents(db, "ws1", {});
    expect(list).toHaveLength(1);
    expect(list[0].agent_id).toBe(id);
  });

  it("reuses agent_id for the same (workspace, device, framework, host_session)", async () => {
    const a = await upsertAgent(db, { workspaceId: "ws1", userId: "u-a", framework: "claude-code", deviceId: "d", hostSessionId: "s" });
    const b = await upsertAgent(db, { workspaceId: "ws1", userId: "u-a", framework: "claude-code", deviceId: "d", hostSessionId: "s" });
    expect(a).toBe(b);
  });

  it("creates separate agents when host_session differs", async () => {
    const a = await upsertAgent(db, { workspaceId: "ws1", userId: "u-a", framework: "claude-code", deviceId: "d", hostSessionId: "s1" });
    const b = await upsertAgent(db, { workspaceId: "ws1", userId: "u-a", framework: "claude-code", deviceId: "d", hostSessionId: "s2" });
    expect(a).not.toBe(b);
  });
});

describe("listAgents filters by status", () => {
  it("returns all agents when no filter", async () => {
    await upsertAgent(db, { workspaceId: "ws1", userId: "u-a", framework: "claude-code", deviceId: "d", hostSessionId: "s1" });
    const all = await listAgents(db, "ws1", {});
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("online");
  });
});
