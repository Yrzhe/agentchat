import { sql, type SQL } from "drizzle-orm";
import { now as clockNow } from "../clock";

/** Derived agent status thresholds (ms since last heartbeat). */
export const IDLE_MS = 5 * 60 * 1000;
export const OFFLINE_MS = 30 * 60 * 1000;

export type LiveStatus = "online" | "idle" | "offline";

/**
 * Compute live status from a heartbeat timestamp without touching the DB.
 * Use this in tests, in-memory paths, and as the authority over the cached
 * `agents.status` column (which is now a hint, not a source of truth).
 */
export function liveStatus(lastHeartbeatAtMs: number, now: number = clockNow()): LiveStatus {
  const age = now - lastHeartbeatAtMs;
  if (age < IDLE_MS) return "online";
  if (age < OFFLINE_MS) return "idle";
  return "offline";
}

/**
 * SQL fragment that derives a live `status` value from `last_heartbeat_at`.
 * Use it in SELECT lists in place of the cached `status` column when callers
 * want freshness without a write.
 */
export function liveStatusSql(now: number = clockNow()): SQL {
  return sql`CASE
    WHEN last_heartbeat_at >= ${now - IDLE_MS} THEN 'online'
    WHEN last_heartbeat_at >= ${now - OFFLINE_MS} THEN 'idle'
    ELSE 'offline'
  END`;
}

/**
 * SQL fragment for `WHERE status = ?` style filters that should now hit
 * the heartbeat directly rather than the cached column.
 */
export function liveStatusWhere(status: LiveStatus, now: number = clockNow()): SQL {
  if (status === "online") return sql`last_heartbeat_at >= ${now - IDLE_MS}`;
  if (status === "idle") {
    return sql`last_heartbeat_at < ${now - IDLE_MS} AND last_heartbeat_at >= ${now - OFFLINE_MS}`;
  }
  return sql`last_heartbeat_at < ${now - OFFLINE_MS}`;
}
