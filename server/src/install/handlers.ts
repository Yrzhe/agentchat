import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { authorizePage } from "./pages";
import { deriveWorkspaceId } from "../core/workspace";
import type { DB, AuthAdapter } from "../core/platform";

const INSTALL_COOKIE = "agentchat_install";
const CSRF_COOKIE = "agentchat_csrf";
const COOKIE_TTL_SECONDS = 600;

interface InstallTuple {
  userId: string;
  workspaceId: string;
  alias: string;
  origin: string;
  callback: string;
  csrf: string;
}

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

    if (!isValidLoopbackCallback(callback)) {
      return c.text("Bad request: callback must be http://127.0.0.1:<port>", 400);
    }

    let workspaceId: string;
    try {
      workspaceId = await deriveWorkspaceId(origin, alias);
    } catch (e) {
      return c.text(`Bad request: ${(e as Error).message}`, 400);
    }

    const csrf = crypto.randomUUID();
    const tuple: InstallTuple = {
      userId: me.id,
      workspaceId,
      alias,
      origin,
      callback,
      csrf,
    };
    const tupleEncoded = encodeURIComponent(JSON.stringify(tuple));

    c.res.headers.append(
      "set-cookie",
      `${CSRF_COOKIE}=${csrf}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_TTL_SECONDS}`
    );
    c.res.headers.append(
      "set-cookie",
      `${INSTALL_COOKIE}=${tupleEncoded}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_TTL_SECONDS}`
    );

    return c.html(authorizePage({ origin, cwd, framework, deviceName, workspaceId, alias, csrf }));
  });

  app.post("/api/keys/issue", async (c) => {
    const { db, auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) return c.text("unauthorized", 401);

    const cookieHeader = c.req.header("cookie") ?? "";
    const tuple = readInstallCookie(cookieHeader);
    if (!tuple) return c.text("install session missing or expired", 400);
    if (tuple.userId !== me.id) return c.text("install session user mismatch", 403);

    const body = await c.req.parseBody();
    const csrfCookie = matchCookie(cookieHeader, CSRF_COOKIE);
    if (!csrfCookie || csrfCookie !== body["csrf"] || csrfCookie !== tuple.csrf) {
      return c.text("csrf mismatch", 403);
    }

    if (!isValidLoopbackCallback(tuple.callback)) {
      return c.text("invalid callback bound to install session", 400);
    }

    const { workspaceId, alias, origin, callback } = tuple;

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

    await db.run(sql`INSERT INTO messages (id, workspace_id, sender_user_id, body, kind, created_at)
      VALUES (${crypto.randomUUID()}, ${workspaceId}, ${me.id},
              ${"AgentChat 已激活。试试 send_message 给同 workspace 其他 agent。"}, ${"broadcast"},
              ${Date.now()})`);

    const dest = new URL(callback);
    dest.searchParams.set("token", token);
    dest.searchParams.set("workspace_id", workspaceId);
    dest.searchParams.set("mcp_url", audience);

    c.res.headers.append("set-cookie", `${INSTALL_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    c.res.headers.append("set-cookie", `${CSRF_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return c.redirect(dest.toString());
  });
}

export function isValidLoopbackCallback(raw: string): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (parsed.hostname !== "127.0.0.1") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  if (!parsed.port) return false;
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return true;
}

function matchCookie(header: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  return header.match(re)?.[1];
}

function readInstallCookie(header: string): InstallTuple | null {
  const raw = matchCookie(header, INSTALL_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (
      typeof parsed?.userId === "string" &&
      typeof parsed?.workspaceId === "string" &&
      typeof parsed?.alias === "string" &&
      typeof parsed?.origin === "string" &&
      typeof parsed?.callback === "string" &&
      typeof parsed?.csrf === "string"
    ) {
      return parsed as InstallTuple;
    }
    return null;
  } catch {
    return null;
  }
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
