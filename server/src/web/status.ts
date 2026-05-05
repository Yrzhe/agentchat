import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { html } from "hono/html";
import type { DB, AuthAdapter } from "../core/platform";

export function mountStatusRoute(
  app: Hono,
  ctxFn: () => { db: DB; auth: AuthAdapter }
): void {
  app.get("/w/:workspaceId/status", async (c) => {
    const { db, auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) {
      return c.redirect(`/api/auth/login?redirect=${encodeURIComponent(c.req.url)}`);
    }
    const wsId = c.req.param("workspaceId");

    const member = (await db.all(
      sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${wsId} AND user_id = ${me.id} LIMIT 1`
    )) as unknown[];
    if (!member.length) return c.text("not a workspace member", 403);

    const ws = (await db.all(
      sql`SELECT id, name, origin FROM workspaces WHERE id = ${wsId}`
    )) as { id: string; name: string; origin: string | null }[];

    const agents = (await db.all(
      sql`SELECT id, framework, device_name, host_session_id, status, last_heartbeat_at
          FROM agents WHERE workspace_id = ${wsId} ORDER BY last_heartbeat_at DESC`
    )) as Array<{ id: string; framework: string; device_name: string | null; host_session_id: string | null; status: string; last_heartbeat_at: number }>;

    const msgs = (await db.all(
      sql`SELECT id, body, kind, sender_agent_id, sender_user_id, created_at
          FROM messages WHERE workspace_id = ${wsId} ORDER BY created_at DESC LIMIT 20`
    )) as Array<{ id: string; body: string; kind: string; sender_agent_id: string | null; sender_user_id: string | null; created_at: number }>;

    return c.html(html`<!doctype html>
<html><head><meta charset="utf-8"><title>${ws[0]?.name ?? wsId} — AgentChat</title>
<style>
  body{font:14px/1.5 system-ui;max-width:880px;margin:24px auto;padding:0 16px;color:#222}
  h2{margin:0 0 4px} .meta{color:#777;font-size:12px}
  table{border-collapse:collapse;width:100%;margin:8px 0 24px}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eee;font-size:13px}
  .bcast{background:#f7f7fa} .direct{background:#fff} .dot{display:inline-block;width:8px;height:8px;border-radius:50%}
  .online{background:#34c759} .idle{background:#ff9500} .offline{background:#aaa}
  code{font-size:12px;background:#f3f3f5;padding:1px 4px;border-radius:4px}
</style></head>
<body>
<h2>${ws[0]?.name ?? "(unknown workspace)"}</h2>
<div class="meta">id: <code>${wsId}</code>${ws[0]?.origin ? ` · origin: ${ws[0].origin}` : ""}</div>

<h3>Agents (${agents.length})</h3>
<table><tr><th></th><th>id</th><th>framework</th><th>device</th><th>last seen</th><th>session (for resume)</th></tr>
${agents.map((a) => html`<tr><td><span class="dot ${a.status}"></span></td><td><code>${a.id.slice(0,8)}</code></td><td>${a.framework}</td><td>${a.device_name ?? ""}</td><td>${new Date(a.last_heartbeat_at).toISOString().slice(0,19)}</td><td><code>${a.host_session_id ?? ""}</code></td></tr>`)}
</table>

<h3>Recent messages (${msgs.length})</h3>
<table>
${msgs.map((m) => html`<tr class="${m.kind === "broadcast" ? "bcast" : "direct"}"><td style="white-space:nowrap"><span class="meta">${new Date(m.created_at).toISOString().slice(11,19)}</span></td><td>${m.kind}</td><td>${m.sender_agent_id ? `agent ${m.sender_agent_id.slice(0,8)}` : `user ${(m.sender_user_id ?? "").slice(0,8)}`}</td><td>${m.body}</td></tr>`)}
</table>
<p class="meta">Refresh to update. <a href="https://agentchat.app">agentchat.app</a></p>
</body></html>`);
  });
}
