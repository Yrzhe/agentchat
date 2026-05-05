import { html } from "hono/html";

export function authorizePage(opts: {
  origin: string; cwd: string; framework: string; deviceName: string;
  workspaceId: string; alias: string; csrf: string;
}) {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorize AgentChat</title>
<style>
  body{font:14px/1.5 system-ui;max-width:520px;margin:48px auto;padding:0 24px;color:#222}
  .card{border:1px solid #ddd;border-radius:10px;padding:20px;margin-top:16px}
  .meta{color:#666;font-size:12px}
  button{background:#1a73e8;color:#fff;border:0;border-radius:6px;padding:10px 20px;font-size:14px;cursor:pointer}
</style></head>
<body>
<h2>Authorize AgentChat for this project</h2>
<div class="card">
  <p><b>Workspace:</b> ${opts.alias}<br><span class="meta">id: ${opts.workspaceId}</span></p>
  <p><b>Origin:</b> ${opts.origin || "(none — local-only project)"}</p>
  <p><b>Path:</b> <code>${opts.cwd}</code></p>
  <p><b>Agent host:</b> ${opts.framework} on ${opts.deviceName}</p>
</div>
<form method="POST" action="/api/keys/issue">
  <input type="hidden" name="csrf" value="${opts.csrf}">
  <input type="hidden" name="workspace_id" value="${opts.workspaceId}">
  <input type="hidden" name="alias" value="${opts.alias}">
  <input type="hidden" name="origin" value="${opts.origin}">
  <p><button type="submit">Authorize</button></p>
</form>
<p class="meta">Powered by AgentChat — <a href="https://agentchat.app">agentchat.app</a></p>
</body></html>`;
}
