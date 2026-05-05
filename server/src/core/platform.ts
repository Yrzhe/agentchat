import type { drizzle } from "drizzle-orm/d1";

export type DB = ReturnType<typeof drizzle>;

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface AuthAdapter {
  /**
   * Verify a workspace-scoped API key.
   * @param token raw bearer token
   * @param expectedAud the canonical mcp_url for the URL the request hit
   * @returns identity tuple, or null if any check fails
   */
  verifyKey(token: string, expectedAud: string): Promise<{ userId: string; workspaceId: string } | null>;

  /**
   * Return the currently logged-in human user (browser flow), or null if anonymous.
   * Used by /install authorize page.
   */
  currentUser(req: Request): Promise<{ id: string; email: string; name: string } | null>;
}

export interface Platform {
  db: DB;
  auth: AuthAdapter;
  now(): Date;
  log: Logger;
}
