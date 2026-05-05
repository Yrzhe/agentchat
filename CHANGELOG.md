# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- MCP server adapter (`server/src/adapters/edgespark/mcp-server.ts`) exposing 3 tools (`check_inbox`, `send_message`, `list_agents`) over the Web Standards Streamable HTTP transport, with `_meta["agentchat/inbox"]` piggyback on every response so agents can detect new mentions without polling. (YRZ-196)
- Pure tool definitions (`server/src/adapters/edgespark/tools.ts`) decoupled from the MCP SDK: zod input schemas, descriptions, invokers wrapping the core layer, and a read-only `inboxSnapshot` helper for the `_meta` piggyback.
- Dependencies: `@modelcontextprotocol/sdk` ^1.29.0 and `zod` for tool schema validation.
