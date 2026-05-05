import { sql } from "drizzle-orm";
import type { DB } from "../platform";

export interface InboxMessage {
  message_id: string;
  body: string;
  sender_agent_id: string | null;
  sender_user_id: string | null;
  created_at: number;
}

export interface InboxResult {
  unread_mentions: InboxMessage[];
  recent_broadcasts: InboxMessage[];
}

const RECENT_BROADCAST_LIMIT = 20;

export async function checkInbox(db: DB, agentId: string): Promise<InboxResult> {
  const rows = (await db.all(
    sql`SELECT workspace_id, last_read_at FROM agents WHERE id = ${agentId}`
  )) as { workspace_id: string; last_read_at: number | null }[];
  if (!rows.length) return { unread_mentions: [], recent_broadcasts: [] };
  const { workspace_id: wsId, last_read_at } = rows[0];
  const since = last_read_at ?? 0;

  const unread = (await db.all(sql`
    SELECT m.id AS message_id, m.body, m.sender_agent_id, m.sender_user_id, m.created_at
    FROM mentions mt
    JOIN messages m ON mt.message_id = m.id
    WHERE mt.target_agent_id = ${agentId}
      AND m.created_at > ${since}
    ORDER BY m.created_at ASC
  `)) as InboxMessage[];

  const recent = (await db.all(sql`
    SELECT id AS message_id, body, sender_agent_id, sender_user_id, created_at
    FROM messages
    WHERE workspace_id = ${wsId} AND kind = 'broadcast'
    ORDER BY created_at DESC
    LIMIT ${RECENT_BROADCAST_LIMIT}
  `)) as InboxMessage[];

  if (unread.length) {
    const newWatermark = unread[unread.length - 1].created_at;
    await db.run(sql`UPDATE agents SET last_read_at = ${newWatermark} WHERE id = ${agentId}`);
  }

  return { unread_mentions: unread, recent_broadcasts: recent };
}
