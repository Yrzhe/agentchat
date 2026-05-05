import { sql } from "drizzle-orm";
import type { DB } from "../platform";
import { parseMentions, containsBroadcastKeyword } from "./parse";

export interface SendInput {
  workspaceId: string;
  senderAgentId: string;
  senderUserId: string;
  body: string;
  to?: string;
}

export interface SendResult {
  messageId: string;
  kind: "broadcast" | "direct";
  mentioned: string[];
}

export class SendError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
  }
}

export async function sendMessage(db: DB, input: SendInput): Promise<SendResult> {
  if (containsBroadcastKeyword(input.body)) {
    throw new SendError(
      "BROADCAST_KEYWORD_FORBIDDEN",
      "Use to:'*' (or omit to) for broadcast — '@all'/'@everyone' literals are not allowed."
    );
  }
  const isDirect = input.to && input.to !== "*" && input.to.startsWith("@");
  const kind: "broadcast" | "direct" = isDirect ? "direct" : "broadcast";

  const candidates = isDirect
    ? [input.to!.slice(1), ...parseMentions(input.body)]
    : parseMentions(input.body);

  const resolved = await resolveMentions(db, input.workspaceId, candidates);

  const messageId = crypto.randomUUID();
  await db.run(sql`
    INSERT INTO messages (id, workspace_id, sender_agent_id, sender_user_id, body, kind)
    VALUES (${messageId}, ${input.workspaceId}, ${input.senderAgentId}, ${input.senderUserId}, ${input.body}, ${kind})
  `);

  if (kind === "direct") {
    for (const agentId of resolved) {
      await db.run(sql`INSERT INTO mentions (message_id, target_agent_id) VALUES (${messageId}, ${agentId})`);
    }
  }

  return { messageId, kind, mentioned: resolved };
}

async function resolveMentions(db: DB, workspaceId: string, handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const dedup = Array.from(new Set(handles));
  const out: string[] = [];
  for (const h of dedup) {
    const byId = (await db.all(
      sql`SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND id = ${h} LIMIT 1`
    )) as { id: string }[];
    if (byId.length) { out.push(byId[0].id); continue; }
    const byPrefix = (await db.all(
      sql`SELECT id FROM agents WHERE workspace_id = ${workspaceId} AND id LIKE ${h + "%"} LIMIT 2`
    )) as { id: string }[];
    if (byPrefix.length === 1) { out.push(byPrefix[0].id); continue; }
    const byUser = (await db.all(
      sql`SELECT a.id FROM agents a JOIN users u ON a.user_id = u.id
          WHERE a.workspace_id = ${workspaceId} AND u.name = ${h} AND a.status != ${"offline"}`
    )) as { id: string }[];
    for (const r of byUser) out.push(r.id);
  }
  return Array.from(new Set(out));
}
