import { sql } from "drizzle-orm";
import type { DB } from "../platform";

export interface UpsertAgentInput {
  workspaceId: string;
  userId: string;
  framework: string;
  frameworkVersion?: string;
  deviceId: string;
  deviceName?: string;
  hostSessionId?: string;
  cwd?: string;
}

const IDLE_MS = 5 * 60 * 1000;
const OFFLINE_MS = 30 * 60 * 1000;

export async function upsertAgent(db: DB, input: UpsertAgentInput): Promise<string> {
  const existing = (await db.all(sql`
    SELECT id FROM agents
    WHERE workspace_id = ${input.workspaceId}
      AND device_id = ${input.deviceId}
      AND framework = ${input.framework}
      AND host_session_id ${input.hostSessionId ? sql`= ${input.hostSessionId}` : sql`IS NULL`}
    LIMIT 1
  `)) as { id: string }[];

  const now = Date.now();

  if (existing.length) {
    await db.run(sql`UPDATE agents SET last_heartbeat_at = ${now}, status = 'online' WHERE id = ${existing[0].id}`);
    return existing[0].id;
  }

  const id = crypto.randomUUID();
  await db.run(sql`
    INSERT INTO agents (id, workspace_id, user_id, framework, framework_version, device_id, device_name,
                        host_session_id, cwd, status, last_heartbeat_at)
    VALUES (${id}, ${input.workspaceId}, ${input.userId}, ${input.framework},
            ${input.frameworkVersion ?? null}, ${input.deviceId}, ${input.deviceName ?? null},
            ${input.hostSessionId ?? null}, ${input.cwd ?? null}, 'online', ${now})
  `);
  return id;
}

export async function refreshHeartbeat(db: DB, agentId: string): Promise<void> {
  await db.run(sql`UPDATE agents SET last_heartbeat_at = ${Date.now()}, status = 'online' WHERE id = ${agentId}`);
}

export async function sweepStatuses(db: DB): Promise<void> {
  const now = Date.now();
  await db.run(sql`UPDATE agents SET status = 'idle' WHERE status = 'online' AND last_heartbeat_at < ${now - IDLE_MS}`);
  await db.run(sql`UPDATE agents SET status = 'offline' WHERE status != 'offline' AND last_heartbeat_at < ${now - OFFLINE_MS}`);
}
