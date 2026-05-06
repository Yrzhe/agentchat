import { sql } from "drizzle-orm";
import type { DB } from "../platform";
import { parseMentions, containsBroadcastKeyword } from "./parse";
import { OFFLINE_MS } from "../agent/status";

export interface SendInput {
  workspaceId: string;
  /** null when the message is sent by a human user from the dashboard (not an agent). */
  senderAgentId: string | null;
  senderUserId: string;
  body: string;
  to?: string;
}

export interface SendResult {
  messageId: string;
  kind: "broadcast" | "direct";
  mentioned: string[];
  createdAt: number;
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

  const toRaw = input.to;
  if (toRaw && containsBroadcastKeyword(toRaw)) {
    throw new SendError(
      "BROADCAST_KEYWORD_FORBIDDEN",
      "Use to:'*' for broadcast — '@all'/'@everyone' in the to field are not allowed."
    );
  }

  const isDirect = !!toRaw && toRaw !== "*" && toRaw.startsWith("@");
  const kind: "broadcast" | "direct" = isDirect ? "direct" : "broadcast";

  const candidates = isDirect
    ? [toRaw!.slice(1), ...parseMentions(input.body)]
    : parseMentions(input.body);

  const resolved = await resolveMentions(db, input.workspaceId, candidates);

  const messageId = crypto.randomUUID();
  const createdAt = nextTs();

  const statements = [
    db.run(sql`
      INSERT INTO messages (id, workspace_id, sender_agent_id, sender_user_id, body, kind, created_at)
      VALUES (${messageId}, ${input.workspaceId}, ${input.senderAgentId}, ${input.senderUserId},
              ${input.body}, ${kind}, ${createdAt})
    `),
  ];

  if (kind === "direct") {
    for (const agentId of resolved) {
      statements.push(
        db.run(sql`INSERT INTO mentions (message_id, target_agent_id) VALUES (${messageId}, ${agentId})`)
      );
    }
  }

  await atomicWrite(db, statements);

  return { messageId, kind, mentioned: resolved, createdAt };
}

/**
 * Resolve a list of @-handles to canonical agent IDs in a workspace.
 *
 * Strategy (in order — first hit wins per handle):
 *   1. Exact agent_id match.
 *   2. Unique prefix match on agent_id.
 *   3. User name match (online or idle agents only — offline excluded).
 *
 * Previously this looped per-handle, issuing up to 3 queries per handle
 * (Codex/OpenCode review MEDIUM #17 — N+1). It now collects all unresolved
 * handles between strategies and runs a single batched query each.
 */
async function resolveMentions(db: DB, workspaceId: string, handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const dedup = Array.from(new Set(handles));
  const resolved = new Set<string>();
  const stillUnresolved = new Set(dedup);

  // 1. Exact id match — single IN query.
  if (stillUnresolved.size) {
    const handlesArr = Array.from(stillUnresolved);
    const exact = (await db.all(sql`
      SELECT id FROM agents
      WHERE workspace_id = ${workspaceId}
        AND id IN (${sql.join(handlesArr.map((h) => sql`${h}`), sql`, `)})
    `)) as { id: string }[];
    for (const r of exact) {
      resolved.add(r.id);
      stillUnresolved.delete(r.id);
    }
  }

  // 2. Prefix match — one OR-of-LIKE query for the remaining handles.
  if (stillUnresolved.size) {
    const handlesArr = Array.from(stillUnresolved);
    const prefixed = (await db.all(sql`
      SELECT id FROM agents
      WHERE workspace_id = ${workspaceId}
        AND (${sql.join(handlesArr.map((h) => sql`id LIKE ${h + "%"}`), sql` OR `)})
    `)) as { id: string }[];
    // Group prefix matches by which handle they could belong to. Only accept
    // matches that are *unique* within the result for that prefix.
    for (const h of handlesArr) {
      const matches = prefixed.filter((r) => r.id.startsWith(h));
      if (matches.length === 1) {
        resolved.add(matches[0].id);
        stillUnresolved.delete(h);
      }
    }
  }

  // 3. User-name match — single IN query, heartbeat threshold for liveness.
  if (stillUnresolved.size) {
    const handlesArr = Array.from(stillUnresolved);
    const offlineCutoff = Date.now() - OFFLINE_MS;
    const byUser = (await db.all(sql`
      SELECT a.id FROM agents a JOIN users u ON a.user_id = u.id
      WHERE a.workspace_id = ${workspaceId}
        AND u.name IN (${sql.join(handlesArr.map((h) => sql`${h}`), sql`, `)})
        AND a.last_heartbeat_at >= ${offlineCutoff}
    `)) as { id: string }[];
    for (const r of byUser) resolved.add(r.id);
  }

  return Array.from(resolved);
}

/**
 * Strictly-monotonic millisecond timestamp within a Worker isolate.
 * Prevents same-ms collisions for rapid-fire messages (one source of the
 * "lost mention after last_read_at" bug). Cross-isolate collisions are still
 * possible but rare; the inbox should also tiebreak on id when adding indexes.
 */
let _lastTs = 0;
function nextTs(): number {
  const now = Date.now();
  _lastTs = now > _lastTs ? now : _lastTs + 1;
  return _lastTs;
}

/**
 * Run a list of write statements atomically when the driver supports it (D1 batch),
 * sequentially otherwise (better-sqlite3 in tests).
 */
async function atomicWrite(db: DB, statements: Promise<unknown>[]): Promise<void> {
  if (statements.length === 0) return;
  if (statements.length === 1) {
    await statements[0];
    return;
  }
  const maybeBatch = (db as unknown as { batch?: (stmts: unknown[]) => Promise<unknown> }).batch;
  if (typeof maybeBatch === "function") {
    await maybeBatch.call(db, statements);
    return;
  }
  for (const stmt of statements) await stmt;
}
