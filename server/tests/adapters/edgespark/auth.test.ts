import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { makeTestDb, seedWorkspace } from "../../helpers/db-fixture";
import type { DB } from "../../../src/core/platform";
import { makeEdgesparkAuth } from "../../../src/adapters/edgespark/auth";

let db: DB; let close: () => void;
const aud = "https://agentchat.app/mcp/ws1";

async function seedKey(db: DB, opts: { token: string; userId: string; workspaceId: string; scope: string; audience: string }) {
  const hash = await sha256Hex(opts.token);
  await db.run(sql`INSERT INTO api_keys (id, hash, user_id, workspace_id, scope, audience)
    VALUES (${crypto.randomUUID()}, ${hash}, ${opts.userId}, ${opts.workspaceId}, ${opts.scope}, ${opts.audience})`);
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-a", userIds: ["u-a"] });
  await seedKey(db, { token: "good", userId: "u-a", workspaceId: "ws1",
    scope: "workspace:ws1", audience: aud });
});
afterEach(() => close());

describe("verifyKey", () => {
  it("returns identity for a valid token", async () => {
    const a = makeEdgesparkAuth(db);
    const r = await a.verifyKey("good", aud);
    expect(r).toEqual({ userId: "u-a", workspaceId: "ws1" });
  });

  it("rejects when audience mismatches (token re-used on a different workspace URL)", async () => {
    const a = makeEdgesparkAuth(db);
    expect(await a.verifyKey("good", "https://agentchat.app/mcp/ws2")).toBeNull();
  });

  it("rejects when scope mismatches workspace", async () => {
    await db.run(sql`UPDATE api_keys SET scope = 'workspace:other'`);
    const a = makeEdgesparkAuth(db);
    expect(await a.verifyKey("good", aud)).toBeNull();
  });

  it("rejects revoked keys", async () => {
    await db.run(sql`UPDATE api_keys SET revoked_at = ${Date.now()}`);
    const a = makeEdgesparkAuth(db);
    expect(await a.verifyKey("good", aud)).toBeNull();
  });

  it("rejects when user is no longer a workspace member", async () => {
    await db.run(sql`DELETE FROM workspace_members`);
    const a = makeEdgesparkAuth(db);
    expect(await a.verifyKey("good", aud)).toBeNull();
  });

  it("rejects unknown token", async () => {
    const a = makeEdgesparkAuth(db);
    expect(await a.verifyKey("nope", aud)).toBeNull();
  });
});
