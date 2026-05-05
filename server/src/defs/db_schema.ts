/**
 * Database Schema
 *
 * Define your app tables here using Drizzle ORM.
 * If you want app-level `relations(...)`, define them in `src/defs/db_relations.ts`.
 *
 * After making changes, run:
 *   edgespark db generate   (create migration files)
 *   edgespark db migrate    (apply to the project database)
 *   edgespark deploy        (deploy with latest schema)
 */

import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  origin: text("origin"),
  name: text("name").notNull(),
  teamId: text("team_id"),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["owner", "member"] }).notNull(),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
]);

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  scope: text("scope").notNull(),
  audience: text("audience").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
}, (t) => [
  index("api_keys_hash_idx").on(t.hash),
]);

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  userId: text("user_id").notNull().references(() => users.id),
  framework: text("framework").notNull(),
  frameworkVersion: text("framework_version"),
  deviceId: text("device_id").notNull(),
  deviceName: text("device_name"),
  hostSessionId: text("host_session_id"),
  cwd: text("cwd"),
  status: text("status", { enum: ["online", "idle", "offline"] }).notNull().default("online"),
  lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }),
  lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => [
  index("agents_workspace_status_hb_idx").on(t.workspaceId, t.status, t.lastHeartbeatAt),
  index("agents_unique_session_idx").on(t.workspaceId, t.deviceId, t.framework, t.hostSessionId),
]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  senderAgentId: text("sender_agent_id").references(() => agents.id),
  senderUserId: text("sender_user_id").references(() => users.id),
  body: text("body").notNull(),
  kind: text("kind", { enum: ["broadcast", "direct"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => [
  index("messages_workspace_created_idx").on(t.workspaceId, t.createdAt),
]);

export const mentions = sqliteTable("mentions", {
  messageId: text("message_id").notNull().references(() => messages.id),
  targetAgentId: text("target_agent_id").notNull().references(() => agents.id),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.targetAgentId] }),
  index("mentions_target_idx").on(t.targetAgentId, t.messageId),
]);
