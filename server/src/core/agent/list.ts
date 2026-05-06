import { sql } from "drizzle-orm";
import type { DB } from "../platform";
import { liveStatusSql, liveStatusWhere, type LiveStatus } from "./status";
import { now } from "../clock";

export interface AgentListItem {
  agent_id: string;
  framework: string;
  device_id: string;
  device_name: string | null;
  host_session_id: string | null;
  status: LiveStatus;
  last_seen: number;
  cwd: string | null;
}

/**
 * List agents in a workspace. Status is computed live from `last_heartbeat_at`
 * — no write is performed on this read path.
 */
export async function listAgents(
  db: DB,
  workspaceId: string,
  filter: { status?: LiveStatus; framework?: string; deviceId?: string }
): Promise<AgentListItem[]> {
  const t = now();
  const rows = (await db.all(sql`
    SELECT id AS agent_id, framework, device_id, device_name, host_session_id,
           ${liveStatusSql(t)} AS status,
           last_heartbeat_at AS last_seen, cwd
    FROM agents
    WHERE workspace_id = ${workspaceId}
      ${filter.status ? sql`AND ${liveStatusWhere(filter.status, t)}` : sql``}
      ${filter.framework ? sql`AND framework = ${filter.framework}` : sql``}
      ${filter.deviceId ? sql`AND device_id = ${filter.deviceId}` : sql``}
    ORDER BY last_heartbeat_at DESC
  `)) as AgentListItem[];
  return rows;
}
