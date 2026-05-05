import { sql } from "drizzle-orm";
import type { DB } from "../platform";
import { sweepStatuses } from "./register";

export interface AgentListItem {
  agent_id: string;
  framework: string;
  device_id: string;
  device_name: string | null;
  host_session_id: string | null;
  status: string;
  last_seen: number;
  cwd: string | null;
}

export async function listAgents(
  db: DB,
  workspaceId: string,
  filter: { status?: string; framework?: string; deviceId?: string }
): Promise<AgentListItem[]> {
  await sweepStatuses(db);
  const rows = (await db.all(sql`
    SELECT id AS agent_id, framework, device_id, device_name, host_session_id, status,
           last_heartbeat_at AS last_seen, cwd
    FROM agents
    WHERE workspace_id = ${workspaceId}
      ${filter.status ? sql`AND status = ${filter.status}` : sql``}
      ${filter.framework ? sql`AND framework = ${filter.framework}` : sql``}
      ${filter.deviceId ? sql`AND device_id = ${filter.deviceId}` : sql``}
    ORDER BY last_heartbeat_at DESC
  `)) as AgentListItem[];
  return rows;
}
