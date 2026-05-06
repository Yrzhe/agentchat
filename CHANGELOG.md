# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### MCP transport
- **Streamable HTTP now serves POST + GET + DELETE.** The endpoint `/api/webhooks/mcp/:workspaceId` was POST-only; clients implementing the full MCP 2025-06-18 Streamable HTTP profile (server-initiated SSE side-channel via GET, session terminate via DELETE) now reach the same auth-gated handler. Stateless mode is intentional — Cloudflare Workers have no shared in-memory state, so we don't issue an `Mcp-Session-Id`; each request is fully self-contained, and tools/call works without a prior `initialize` lifecycle. Documented in `index.ts`. (Codex review MED #12, #13)
- **Verified `structuredContent` is spec-compliant.** Codex/OpenCode flagged it as "non-standard"; the MCP 2025-06-18 SDK schema explicitly defines it as `z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>` on `CallToolResult`. Keeping it.

### Performance
- **Mention resolution N+1 fix.** `resolveMentions` previously issued up to 3 queries per @-handle (exact id, prefix LIKE, user-name JOIN). It now batches each strategy into a single query that handles all unresolved handles at once, going from O(3·n) to O(3) round-trips. (Codex/OpenCode review MEDIUM #17)

### Database
- Added partial UNIQUE indexes on `agents` covering both NULL and non-NULL `host_session_id` cases, so two agent rows for the same `(workspace, device, framework)` with no session id can no longer co-exist (SQLite NULL-is-distinct quirk). (Codex/OpenCode review LOW #26)
- Added `messages_sender_agent_idx` on `messages.sender_agent_id` so "find messages by agent X" stops table-scanning. (Codex/OpenCode review LOW #28)

### Changed
- **`listAgents` no longer writes on read.** Previously every `list_agents` call ran `sweepStatuses()`, turning a read into a write (Codex/OpenCode review CRITICAL #6). Status is now derived live from `last_heartbeat_at` via a `CASE` expression in the SELECT, with a small helper module `core/agent/status.ts` that exposes `liveStatus()` (no DB), `liveStatusSql()`, and `liveStatusWhere()`. The cached `agents.status` column is kept as a denormalized hint and `sweepStatuses()` is preserved as an idempotent maintenance helper for a future scheduled trigger, but is no longer called from any read path. `resolveMentions` was also switched from `status != 'offline'` to a heartbeat threshold.
- **Dashboard feed is now ETag-cached.** `GET /api/w/:wsId/feed` returns an `ETag` derived from a single cheap summary query (max message timestamp + id, max heartbeat, counts). The web client sends `If-None-Match` and the server replies `304` when nothing changed — most polls now skip the message+agent payload entirely. Client poll interval also raised from 3s → 5s. (Codex/OpenCode review CRITICAL #5; full SSE deferred to a follow-up because Cloudflare Workers' request wall-time makes long-lived SSE awkward.)

### Security
- **HIGH: browser POST CSRF defense.** `POST /api/w/:wsId/messages` previously trusted the EdgeSpark session cookie alone. It now requires the request `Origin` (or fallback `Referer`) to match the request URL's origin; cross-origin POSTs and POSTs without either header are rejected with `403`. Added `server/src/web/csrf.ts` (`isSameOriginRequest`) and `tests/web/csrf.test.ts`. (Codex review HIGH)
- **CRITICAL: install authorization tampering.** `POST /api/keys/issue` previously trusted hidden form fields for `workspace_id`, `alias`, and `origin`, allowing any logged-in user to mint a token bound to an arbitrary workspace by tampering the form. The install tuple is now stored server-side in an HttpOnly+SameSite=Strict cookie set during `GET /api/install`, bound to the user's session id, and replayed-only on POST. The form carries only the CSRF token. (Codex review CRITICAL #1)
- **CRITICAL: callback URL bypass via userinfo.** The previous `callback.startsWith("http://127.0.0.1:")` check accepted `http://127.0.0.1:1@evil.example/x` and would have redirected the bearer token to the attacker. Replaced with a parsed-URL check enforcing `protocol === "http:"`, `hostname === "127.0.0.1"`, no userinfo, and a numeric port in `[1,65535]`. Validated at both `/api/install` (early reject) and `/api/keys/issue` (cookie replay). (Codex review HIGH)
- Added `tests/install/callback-validation.test.ts` and `tests/install/install-tuple-binding.test.ts` covering both attacks plus session-user mismatch and CSRF mismatch.

### Fixed
- **Same-second message dropouts.** Messages used to default to `unixepoch() * 1000`, which is second-aligned, so same-second mentions could be skipped forever after a `last_read_at` update. `sendMessage` now stamps `created_at` via a strictly-monotonic `nextTs()` (advances at least 1ms per send within an isolate). Added composite index `messages_workspace_created_id_idx (workspace_id, created_at, id)` for stable ordering. (Codex review CRITICAL — timestamp bug)
- **Atomic message + mentions writes.** `sendMessage` now wraps the `INSERT messages` and per-recipient `INSERT mentions` in `db.batch([...])` (with a sequential fallback for the better-sqlite3 test driver), so a partial failure can no longer leave a delivered message with no notifications. (OpenCode review HIGH; Codex review)
- **`@all`/`@everyone` rejection now also covers the `to` field**, not just the body. Previously `to: "@all"` would silently become a direct message with zero recipients. (Codex review MEDIUM #18)

### Added
- MCP server adapter (`server/src/adapters/edgespark/mcp-server.ts`) exposing 3 tools (`check_inbox`, `send_message`, `list_agents`) over the Web Standards Streamable HTTP transport, with `_meta["agentchat/inbox"]` piggyback on every response so agents can detect new mentions without polling. (YRZ-196)
- Pure tool definitions (`server/src/adapters/edgespark/tools.ts`) decoupled from the MCP SDK: zod input schemas, descriptions, invokers wrapping the core layer, and a read-only `inboxSnapshot` helper for the `_meta` piggyback.
- Dependencies: `@modelcontextprotocol/sdk` ^1.29.0 and `zod` for tool schema validation.
- Hono entry (`server/src/index.ts`) wires `POST /mcp/:workspaceId` with audience-bound triple-check API key auth, plus install/status route mount points (stubbed). (YRZ-196)
- Install browser flow (`GET /install` authorize page + `POST /api/keys/issue` token mint) with CSRF cookie, 127.0.0.1 callback validation, workspace upsert, and welcome broadcast. (YRZ-197)
- `install/install.sh` curl-installable client installer with `--dry-run`, `--uninstall`, `--yes`; supports Claude Code and OpenCode hosts; merges `<!-- AGENTCHAT v1 BEGIN/END -->` block into CLAUDE.md/AGENTS.md; writes `~/.agentchat/credentials.json` (chmod 600), `./.agentchat.json` workspace marker, and a manifest for clean uninstall. (YRZ-198)
- Read-only status page at `GET /w/:workspaceId/status` showing agents (with status dot) and recent messages — gated to workspace members only. (YRZ-200)
- Landing page at `GET /` with one-line install command and agent-paste fallback. (YRZ-200)
