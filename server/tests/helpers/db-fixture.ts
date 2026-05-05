// server/tests/helpers/db-fixture.ts
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "../../src/defs/db_schema";
import { sql } from "drizzle-orm";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DB } from "../../src/core/platform";

export function makeTestDb(): { db: DB; close: () => void } {
  const sqlite = new Database(":memory:");
  const dir = path.join(__dirname, "..", "..", "drizzle");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const cleaned = raw.replace(/-->\s*statement-breakpoint/g, "");
    sqlite.exec(cleaned);
  }
  const db = drizzle(sqlite, { schema }) as unknown as DB;
  return { db, close: () => sqlite.close() };
}

export async function seedWorkspace(db: DB, opts: { id: string; ownerUserId: string; userIds: string[] }) {
  await db.run(sql`INSERT INTO users (id, email, name) VALUES
    ${sql.join(opts.userIds.map((u) => sql`(${u}, ${u + "@x.test"}, ${u})`), sql`,`)}`);
  await db.run(sql`INSERT INTO workspaces (id, name, owner_user_id) VALUES (${opts.id}, ${opts.id}, ${opts.ownerUserId})`);
  for (const u of opts.userIds) {
    await db.run(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${opts.id}, ${u}, ${"member"})`);
  }
}

export async function seedAgent(db: DB, opts: { id: string; workspaceId: string; userId: string; framework?: string; deviceId?: string }) {
  await db.run(sql`INSERT INTO agents (id, workspace_id, user_id, framework, device_id, status)
    VALUES (${opts.id}, ${opts.workspaceId}, ${opts.userId}, ${opts.framework ?? "claude-code"}, ${opts.deviceId ?? "dev-1"}, ${"online"})`);
}
