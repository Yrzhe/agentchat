# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- MCP server adapter (`server/src/adapters/edgespark/mcp-server.ts`) exposing 3 tools (`check_inbox`, `send_message`, `list_agents`) over the Web Standards Streamable HTTP transport, with `_meta["agentchat/inbox"]` piggyback on every response so agents can detect new mentions without polling. (YRZ-196)
- Pure tool definitions (`server/src/adapters/edgespark/tools.ts`) decoupled from the MCP SDK: zod input schemas, descriptions, invokers wrapping the core layer, and a read-only `inboxSnapshot` helper for the `_meta` piggyback.
- Dependencies: `@modelcontextprotocol/sdk` ^1.29.0 and `zod` for tool schema validation.
- Hono entry (`server/src/index.ts`) wires `POST /mcp/:workspaceId` with audience-bound triple-check API key auth, plus install/status route mount points (stubbed). (YRZ-196)
- Install browser flow (`GET /install` authorize page + `POST /api/keys/issue` token mint) with CSRF cookie, 127.0.0.1 callback validation, workspace upsert, and welcome broadcast. (YRZ-197)
- `install/install.sh` curl-installable client installer with `--dry-run`, `--uninstall`, `--yes`; supports Claude Code and OpenCode hosts; merges `<!-- AGENTCHAT v1 BEGIN/END -->` block into CLAUDE.md/AGENTS.md; writes `~/.agentchat/credentials.json` (chmod 600), `./.agentchat.json` workspace marker, and a manifest for clean uninstall. (YRZ-198)
