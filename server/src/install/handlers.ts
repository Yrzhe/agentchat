import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { authorizePage } from "./pages";
import { deriveWorkspaceId } from "../core/workspace";
import type { DB, AuthAdapter } from "../core/platform";

export function mountInstallRoutes(
  app: Hono,
  ctxFn: () => { db: DB; auth: AuthAdapter }
): void {
  app.get("/api/install", async (c) => {
    const { auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) {
      return c.redirect(`/api/auth/login?redirect=${encodeURIComponent(c.req.url)}`);
    }

    const origin = c.req.query("origin") ?? "";
    const cwd = c.req.query("cwd") ?? "";
    const alias = c.req.query("alias") ?? cwd.split("/").pop() ?? "workspace";
    const framework = c.req.query("framework") ?? "unknown";
    const deviceName = c.req.query("device_name") ?? "unknown";
    const callback = c.req.query("callback") ?? "";

    let workspaceId: string;
    try {
      workspaceId = await deriveWorkspaceId(origin, alias);
    } catch (e) {
      return c.text(`Bad request: ${(e as Error).message}`, 400);
    }

    const csrf = crypto.randomUUID();
    c.res.headers.append(
      "set-cookie",
      `agentchat_csrf=${csrf}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600`
    );
    c.res.headers.append(
      "set-cookie",
      `agentchat_callback=${encodeURIComponent(callback)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600`
    );

    return c.html(authorizePage({ origin, cwd, framework, deviceName, workspaceId, alias, csrf }));
  });

  app.post("/api/keys/issue", async (c) => {
    const { db, auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) return c.text("unauthorized", 401);

    const body = await c.req.parseBody();
    const cookieHeader = c.req.header("cookie") ?? "";
    const csrfCookie = cookieHeader.match(/agentchat_csrf=([^;]+)/)?.[1];
    if (!csrfCookie || csrfCookie !== body["csrf"]) return c.text("csrf mismatch", 403);

    const workspaceId = String(body["workspace_id"]);
    const alias = String(body["alias"] ?? workspaceId);
    const origin = String(body["origin"] ?? "");

    await db.run(sql`INSERT INTO users (id, email, name) VALUES (${me.id}, ${me.email}, ${me.name})
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name`);
    await db.run(sql`INSERT INTO workspaces (id, origin, name, owner_user_id)
      VALUES (${workspaceId}, ${origin || null}, ${alias}, ${me.id})
      ON CONFLICT(id) DO NOTHING`);
    await db.run(sql`INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${me.id}, ${"owner"}) ON CONFLICT DO NOTHING`);

    const token = randomToken(64);
    const hash = await sha256Hex(token);
    const url = new URL(c.req.url);
    const audience = `${url.origin}/api/webhooks/mcp/${workspaceId}`;
    await db.run(sql`INSERT INTO api_keys (id, hash, user_id, workspace_id, scope, audience)
      VALUES (${crypto.randomUUID()}, ${hash}, ${me.id}, ${workspaceId},
              ${"workspace:" + workspaceId}, ${audience})`);

    await db.run(sql`INSERT INTO messages (id, workspace_id, sender_user_id, body, kind)
      VALUES (${crypto.randomUUID()}, ${workspaceId}, ${me.id},
              ${"AgentChat 已激活。试试 send_message 给同 workspace 其他 agent。"}, ${"broadcast"})`);

    const callbackEnc = cookieHeader.match(/agentchat_callback=([^;]+)/)?.[1] ?? "";
    const callback = decodeURIComponent(callbackEnc);
    if (!callback || !callback.startsWith("http://127.0.0.1:")) {
      return c.text("missing or invalid callback (must be http://127.0.0.1:<port>)", 400);
    }
    const dest = new URL(callback);
    dest.searchParams.set("token", token);
    dest.searchParams.set("workspace_id", workspaceId);
    dest.searchParams.set("mcp_url", audience);
    return c.redirect(dest.toString());
  });
}

function randomToken(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
