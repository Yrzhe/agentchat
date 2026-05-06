/**
 * Manual message retention pruner — stop-gap for Codex/OpenCode review MED #19.
 *
 * EdgeSpark doesn't expose a Cloudflare Cron Trigger today, so there is no
 * scheduled hook to clean old messages. This script can be run by an admin
 * (locally with the EdgeSpark D1 binding, or pasted into an admin endpoint
 * later) to delete messages older than `daysToKeep`.
 *
 * Usage (local + manual):
 *
 *     // Wire into a temporary admin route that calls pruneMessages(db, 30),
 *     // run once, then unmount the route. Or run via `edgespark db sql`
 *     // with the SQL printed below.
 *
 * Why not a hot-path cleanup: deleting on every send/list adds latency to
 * the user-visible request path. Keeping it as an explicit, owner-triggered
 * action is safer until a proper scheduler arrives.
 */

import { sql } from "drizzle-orm";
import type { DB } from "../src/core/platform";

export interface PruneResult {
  cutoffMs: number;
  mentionsDeleted: number;
  messagesDeleted: number;
}

export async function pruneMessages(db: DB, daysToKeep: number): Promise<PruneResult> {
  if (!Number.isInteger(daysToKeep) || daysToKeep < 1) {
    throw new Error(`daysToKeep must be a positive integer, got ${daysToKeep}`);
  }
  const cutoffMs = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  // Mentions reference messages by FK; delete them first.
  const mentionsBefore = (await db.all(
    sql`SELECT COUNT(*) AS n FROM mentions mt JOIN messages m ON mt.message_id = m.id
        WHERE m.created_at < ${cutoffMs}`
  )) as { n: number }[];

  await db.run(sql`
    DELETE FROM mentions
    WHERE message_id IN (SELECT id FROM messages WHERE created_at < ${cutoffMs})
  `);

  const messagesBefore = (await db.all(
    sql`SELECT COUNT(*) AS n FROM messages WHERE created_at < ${cutoffMs}`
  )) as { n: number }[];

  await db.run(sql`DELETE FROM messages WHERE created_at < ${cutoffMs}`);

  return {
    cutoffMs,
    mentionsDeleted: Number(mentionsBefore[0]?.n ?? 0),
    messagesDeleted: Number(messagesBefore[0]?.n ?? 0),
  };
}
