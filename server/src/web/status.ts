import type { Hono } from "hono";
import { sql } from "drizzle-orm";
import { html } from "hono/html";
import type { DB, AuthAdapter } from "../core/platform";
import { sendMessage, SendError } from "../core/chat/send";

export function mountStatusRoute(
  app: Hono,
  ctxFn: () => { db: DB; auth: AuthAdapter }
): void {
  // List workspaces the current user belongs to (used by the dashboard SPA).
  app.get("/api/me/workspaces", async (c) => {
    const { db, auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) return c.json({ error: "unauthorized" }, 401);

    const rows = (await db.all(sql`
      SELECT w.id, w.name, w.origin,
             (SELECT COUNT(*) FROM agents a WHERE a.workspace_id = w.id) AS agent_count,
             (SELECT MAX(m.created_at) FROM messages m WHERE m.workspace_id = w.id) AS last_message_at
      FROM workspaces w
      JOIN workspace_members mb ON mb.workspace_id = w.id
      WHERE mb.user_id = ${me.id}
      ORDER BY last_message_at DESC NULLS LAST, w.id ASC
    `)) as Array<{ id: string; name: string; origin: string | null; agent_count: number; last_message_at: number | null }>;

    return c.json({ user: { id: me.id, email: me.email, name: me.name }, workspaces: rows });
  });

  // POST a human-authored message into a workspace.
  app.post("/api/w/:workspaceId/messages", async (c) => {
    const { db, auth } = ctxFn();
    const me = await auth.currentUser(c.req.raw);
    if (!me) return c.text("unauthorized", 401);
    const wsId = c.req.param("workspaceId");

    const member = (await db.all(
      sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${wsId} AND user_id = ${me.id} LIMIT 1`
    )) as unknown[];
    if (!member.length) return c.text("not a workspace member", 403);

    const form = await c.req.parseBody();
    const body = String(form["body"] ?? "").trim();
    const to = String(form["to"] ?? "").trim();
    if (!body) return c.text("body required", 400);

    try {
      await sendMessage(db, {
        workspaceId: wsId,
        senderAgentId: null,
        senderUserId: me.id,
        body,
        to: to || undefined,
      });
    } catch (e) {
      if (e instanceof SendError) return c.text(e.message, 400);
      throw e;
    }

    return c.redirect(`/api/w/${wsId}/status`);
  });

  // Read-only status page (also serves as the human "chat" view with a send form).
  app.get("/api/w/:workspaceId/status", async (c) => {
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
      sql`SELECT m.id, m.body, m.kind, m.sender_agent_id, m.sender_user_id, m.created_at,
                 u.name AS sender_user_name, u.email AS sender_user_email
          FROM messages m
          LEFT JOIN users u ON u.id = m.sender_user_id
          WHERE m.workspace_id = ${wsId}
          ORDER BY m.created_at DESC LIMIT 50`
    )) as Array<{ id: string; body: string; kind: string; sender_agent_id: string | null; sender_user_id: string | null; created_at: number; sender_user_name: string | null; sender_user_email: string | null }>;

    function senderLabel(m: typeof msgs[number]): string {
      if (m.sender_agent_id) {
        const a = agents.find((x) => x.id === m.sender_agent_id);
        const dev = a?.device_name ? ` @ ${a.device_name}` : "";
        const fw = a?.framework ? ` (${a.framework})` : "";
        return `agent ${m.sender_agent_id.slice(0, 8)}${dev}${fw}`;
      }
      if (m.sender_user_id) {
        return `${m.sender_user_name || m.sender_user_email || m.sender_user_id.slice(0, 8)} (you)`;
      }
      return "system";
    }

    function fmtTime(epoch: number): string {
      // Messages.created_at uses sqlite strftime('%s','now') (seconds);
      // agents.last_heartbeat_at uses Date.now() (ms). Auto-detect.
      const ms = epoch < 1e12 ? epoch * 1000 : epoch;
      return new Date(ms).toISOString().slice(11, 19) + " UTC";
    }

    return c.html(html`<!doctype html>
<html><head><meta charset="utf-8"><title>${ws[0]?.name ?? wsId} — AgentChat</title>
<meta http-equiv="refresh" content="5">
<style>
  body{font:14px/1.5 system-ui;max-width:880px;margin:24px auto;padding:0 16px;color:#222}
  h2{margin:0 0 4px} .meta{color:#777;font-size:12px}
  table{border-collapse:collapse;width:100%;margin:8px 0 24px}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top}
  .bcast{background:#f7f7fa} .direct{background:#fff8e1}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%}
  .online{background:#34c759} .idle{background:#ff9500} .offline{background:#aaa}
  code{font-size:12px;background:#f3f3f5;padding:1px 4px;border-radius:4px}
  form.send{margin:16px 0 24px;padding:14px;border:1px solid #e3e3e8;border-radius:10px;background:#fafafb}
  form.send textarea{width:100%;min-height:60px;font:13px/1.4 system-ui;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box}
  form.send input[type=text]{width:200px;font:13px/1.4 system-ui;padding:6px 8px;border:1px solid #ddd;border-radius:6px}
  form.send button{background:#1a73e8;color:#fff;border:0;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer}
  form.send .row{display:flex;gap:8px;align-items:center;margin-top:8px}
  .nav{margin-bottom:8px}
  .body{white-space:pre-wrap;word-break:break-word}
</style></head>
<body>
<div class="nav"><a href="/">← Dashboard</a></div>
<h2>${ws[0]?.name ?? "(unknown workspace)"}</h2>
<div class="meta">id: <code>${wsId}</code>${ws[0]?.origin ? html` · origin: ${ws[0].origin}` : ""} · auto-refresh 5s</div>

<form class="send" method="POST" action="/api/w/${wsId}/messages">
  <textarea name="body" placeholder="Write to agents in this workspace. Use @<agent-id-prefix> in the body to mention specific agents — e.g. 'hi @abc12 take a look'." required></textarea>
  <div class="row">
    <label class="meta">To (optional):</label>
    <input type="text" name="to" placeholder="@<agent-id-prefix> or leave blank for broadcast">
    <button type="submit">Send</button>
    <span class="meta">Tip: leave blank → broadcast (visible to all, not unread); "@&lt;prefix&gt;" → direct (counted as unread for that agent).</span>
  </div>
</form>

<h3>Agents (${agents.length})</h3>
<table><tr><th></th><th>id</th><th>framework</th><th>device</th><th>last seen</th><th>session (for resume)</th></tr>
${agents.length === 0
  ? html`<tr><td colspan="6" class="meta" style="padding:14px">No agents yet. Run the installer in a project to register one.</td></tr>`
  : agents.map((a) => html`<tr><td><span class="dot ${a.status}"></span></td><td><code>${a.id.slice(0,8)}</code></td><td>${a.framework}</td><td>${a.device_name ?? ""}</td><td>${fmtTime(a.last_heartbeat_at)}</td><td><code>${a.host_session_id ?? ""}</code></td></tr>`)}
</table>

<h3>Recent messages (${msgs.length}, newest first)</h3>
<table>
${msgs.length === 0
  ? html`<tr><td colspan="4" class="meta" style="padding:14px">No messages yet. Send one above ↑.</td></tr>`
  : msgs.map((m) => html`<tr class="${m.kind === "broadcast" ? "bcast" : "direct"}">
    <td style="white-space:nowrap;width:90px"><span class="meta">${fmtTime(m.created_at)}</span></td>
    <td style="width:80px">${m.kind}</td>
    <td style="width:200px">${senderLabel(m)}</td>
    <td class="body">${m.body}</td>
  </tr>`)}
</table>
<p class="meta">Auto-refreshes every 5s. Or <a href="/api/w/${wsId}/status">refresh now</a>.</p>
</body></html>`);
  });
}
