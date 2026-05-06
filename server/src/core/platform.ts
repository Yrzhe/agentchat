import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/**
 * Platform-agnostic Drizzle SQLite handle.
 *
 * Both D1 (production) and better-sqlite3 (tests) extend this base type.
 * Concrete adapters cast their driver-specific Drizzle instance into `DB`.
 * The optional `batch(...)` method is a D1 extension; `core/chat/send.ts`
 * detects it at runtime via `atomicWrite` and falls back to sequential
 * execution on drivers that don't have it.
 *
 * This used to be `ReturnType<typeof drizzle from "drizzle-orm/d1">`, which
 * tied the entire core layer to D1 at the type level and would have forced
 * a non-D1 adapter to redefine the type. (Codex/OpenCode review HIGH #8)
 */
export type DB = BaseSQLiteDatabase<"async", unknown>;

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Verify a workspace-scoped API bearer issued by `/api/keys/issue`.
 * Triple-check: revocation, audience, scope, and membership must all hold.
 *
 * Adapters that only serve the agent/MCP path (no human dashboard) implement
 * just this interface and skip `BrowserAuth` entirely. (Codex review MED #10)
 */
export interface MachineAuth {
  verifyKey(token: string, expectedAud: string): Promise<{ userId: string; workspaceId: string } | null>;
}

/**
 * Resolve the currently logged-in human user for browser routes (install
 * authorize page, dashboard feed, send-message form). Adapters that don't
 * expose a browser dashboard can omit this — the install/status routes are
 * a feature module that needs `BrowserAuth` to mount.
 */
export interface BrowserAuth {
  currentUser(req: Request): Promise<{ id: string; email: string; name: string } | null>;
}

/**
 * Composed adapter implementing both halves. Production EdgeSpark uses this;
 * a hypothetical headless CF Workers adapter could expose only `MachineAuth`.
 */
export interface AuthAdapter extends MachineAuth, BrowserAuth {}

export interface Platform {
  db: DB;
  auth: AuthAdapter;
  now(): Date;
  log: Logger;
}
