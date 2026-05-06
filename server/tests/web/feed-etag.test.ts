import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { mountStatusRoute } from "../../src/web/status";
import { makeTestDb, seedWorkspace } from "../helpers/db-fixture";
import type { DB, AuthAdapter } from "../../src/core/platform";

let db: DB;
let close: () => void;
let app: Hono;

const fakeAuth: AuthAdapter = {
  verifyKey: async () => null,
  currentUser: async () => ({ id: "u-alice", email: "alice@x.test", name: "Alice" }),
};

beforeEach(async () => {
  ({ db, close } = makeTestDb());
  app = new Hono();
  mountStatusRoute(app, () => ({ db, auth: fakeAuth }));
  await seedWorkspace(db, { id: "ws1", ownerUserId: "u-alice", userIds: ["u-alice"] });
});
afterEach(() => close());

describe("feed ETag / 304 (CRITICAL #5 — reduce poll cost)", () => {
  it("returns an etag and caches it", async () => {
    const r = await app.fetch(new Request("http://test/api/w/ws1/feed"));
    expect(r.status).toBe(200);
    const etag = r.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(etag).toMatch(/^W\//);
  });

  it("returns 304 when If-None-Match matches and nothing changed", async () => {
    const r1 = await app.fetch(new Request("http://test/api/w/ws1/feed"));
    const etag = r1.headers.get("etag")!;

    const r2 = await app.fetch(
      new Request("http://test/api/w/ws1/feed", { headers: { "if-none-match": etag } })
    );
    expect(r2.status).toBe(304);
    expect(r2.headers.get("etag")).toBe(etag);
    const text = await r2.text();
    expect(text).toBe("");
  });

  it("returns a fresh body and new etag after a message lands", async () => {
    const r1 = await app.fetch(new Request("http://test/api/w/ws1/feed"));
    const etag1 = r1.headers.get("etag")!;

    await db.run(sql`INSERT INTO messages (id, workspace_id, sender_user_id, body, kind, created_at)
      VALUES ('m1', 'ws1', 'u-alice', 'hi', 'broadcast', ${Date.now()})`);

    const r2 = await app.fetch(
      new Request("http://test/api/w/ws1/feed", { headers: { "if-none-match": etag1 } })
    );
    expect(r2.status).toBe(200);
    expect(r2.headers.get("etag")).toBeTruthy();
    expect(r2.headers.get("etag")).not.toBe(etag1);
  });

  it("etag changes when an agent's heartbeat updates", async () => {
    await db.run(sql`INSERT INTO agents
      (id, workspace_id, user_id, framework, device_id, status, last_heartbeat_at)
      VALUES ('a1', 'ws1', 'u-alice', 'claude-code', 'd1', 'online', ${Date.now() - 5000})`);
    const r1 = await app.fetch(new Request("http://test/api/w/ws1/feed"));
    const etag1 = r1.headers.get("etag")!;

    await db.run(sql`UPDATE agents SET last_heartbeat_at = ${Date.now()} WHERE id = 'a1'`);
    const r2 = await app.fetch(new Request("http://test/api/w/ws1/feed"));
    expect(r2.headers.get("etag")).not.toBe(etag1);
  });
});

describe("POST /api/w/:wsId/messages — Origin defense (HIGH #7)", () => {
  it("rejects cross-origin POST", async () => {
    const r = await app.fetch(
      new Request("http://test/api/w/ws1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ body: "hi" }),
      })
    );
    expect(r.status).toBe(403);
  });

  it("accepts same-origin POST", async () => {
    const r = await app.fetch(
      new Request("http://test/api/w/ws1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          origin: "http://test",
        },
        body: JSON.stringify({ body: "hello world" }),
      })
    );
    expect(r.status).toBe(200);
  });

  it("rejects POST with no Origin and no Referer", async () => {
    const r = await app.fetch(
      new Request("http://test/api/w/ws1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ body: "hi" }),
      })
    );
    expect(r.status).toBe(403);
  });
});
