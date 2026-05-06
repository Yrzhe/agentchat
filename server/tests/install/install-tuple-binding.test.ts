import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { mountInstallRoutes } from "../../src/install/handlers";
import { makeTestDb } from "../helpers/db-fixture";
import type { DB, AuthAdapter } from "../../src/core/platform";

let db: DB;
let close: () => void;
let app: Hono;

const fakeAuth: AuthAdapter = {
  verifyKey: async () => null,
  currentUser: async () => ({ id: "u-alice", email: "alice@x.test", name: "Alice" }),
};

beforeEach(() => {
  ({ db, close } = makeTestDb());
  app = new Hono();
  mountInstallRoutes(app, () => ({ db, auth: fakeAuth }));
});
afterEach(() => close());

function extractCookies(setCookieHeaders: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of setCookieHeaders) {
    const [pair] = raw.split(";");
    const [k, ...rest] = pair.split("=");
    out[k.trim()] = rest.join("=");
  }
  return out;
}

async function getInstallPage(originParam: string, callback = "http://127.0.0.1:51000") {
  const url =
    `http://test.local/api/install?origin=${encodeURIComponent(originParam)}` +
    `&alias=${encodeURIComponent(originParam.split("/").pop() ?? "ws")}` +
    `&cwd=${encodeURIComponent("/tmp/" + (originParam.split("/").pop() ?? "ws"))}` +
    `&framework=claude-code&device_name=mac&callback=${encodeURIComponent(callback)}`;
  return app.fetch(new Request(url));
}

describe("CRITICAL #1 — install tuple binding", () => {
  it("rejects POST without an install cookie even with a logged-in user", async () => {
    const res = await app.fetch(
      new Request("http://test.local/api/keys/issue", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "csrf=anything",
      })
    );
    expect(res.status).toBe(400);
  });

  it("ignores tampered form fields — workspace_id from cookie wins", async () => {
    // Step 1: legitimately authorize attacker's own origin.
    const attackerOrigin = "https://github.com/attacker/own-repo";
    const r1 = await getInstallPage(attackerOrigin);
    const cookies = extractCookies(r1.headers.getSetCookie());
    expect(cookies.agentchat_install).toBeTruthy();
    expect(cookies.agentchat_csrf).toBeTruthy();

    const tuple = JSON.parse(decodeURIComponent(cookies.agentchat_install));
    const attackerWsId = tuple.workspaceId;

    // Step 2: attempt to mint a token for a victim workspace by submitting a different workspace_id.
    const fakeVictimWsId = "0000000000000000";
    const cookieHeader = `agentchat_install=${cookies.agentchat_install}; agentchat_csrf=${cookies.agentchat_csrf}`;
    const r2 = await app.fetch(
      new Request("http://test.local/api/keys/issue", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body:
          `csrf=${cookies.agentchat_csrf}` +
          `&workspace_id=${fakeVictimWsId}` +
          `&alias=evil&origin=https://github.com/victim/repo`,
        redirect: "manual",
      })
    );

    // We do NOT expect server to mint a token for the victim ws — only for the cookie-bound one.
    const issuedRows = (await db.all(
      sql`SELECT workspace_id FROM api_keys`
    )) as { workspace_id: string }[];
    expect(issuedRows).toHaveLength(1);
    expect(issuedRows[0].workspace_id).toBe(attackerWsId);
    expect(issuedRows[0].workspace_id).not.toBe(fakeVictimWsId);

    // The membership table should also not contain the fake victim ws.
    const members = (await db.all(
      sql`SELECT workspace_id FROM workspace_members WHERE workspace_id = ${fakeVictimWsId}`
    )) as unknown[];
    expect(members).toHaveLength(0);

    expect(r2.status).toBe(302);
  });

  it("rejects mismatched csrf even with a valid install cookie", async () => {
    const r1 = await getInstallPage("https://github.com/a/b");
    const cookies = extractCookies(r1.headers.getSetCookie());
    const cookieHeader = `agentchat_install=${cookies.agentchat_install}; agentchat_csrf=${cookies.agentchat_csrf}`;
    const r2 = await app.fetch(
      new Request("http://test.local/api/keys/issue", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body: "csrf=not-the-real-token",
      })
    );
    expect(r2.status).toBe(403);
  });

  it("rejects install GET when callback is not loopback (CRITICAL #2 e2e)", async () => {
    const r1 = await getInstallPage("https://github.com/a/b", "http://127.0.0.1:1@evil.example/x");
    expect(r1.status).toBe(400);
  });

  it("rejects POST when the cookie's userId no longer matches the logged-in session", async () => {
    const r1 = await getInstallPage("https://github.com/a/b");
    const cookies = extractCookies(r1.headers.getSetCookie());
    // Hand-craft a cookie that claims a different user.
    const tuple = JSON.parse(decodeURIComponent(cookies.agentchat_install));
    const tampered = encodeURIComponent(JSON.stringify({ ...tuple, userId: "u-mallory" }));
    const cookieHeader = `agentchat_install=${tampered}; agentchat_csrf=${cookies.agentchat_csrf}`;
    const r2 = await app.fetch(
      new Request("http://test.local/api/keys/issue", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
        body: `csrf=${cookies.agentchat_csrf}`,
      })
    );
    expect(r2.status).toBe(403);
  });
});
