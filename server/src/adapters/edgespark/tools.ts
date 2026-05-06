import { z } from "zod";
import { sql } from "drizzle-orm";
import type { DB } from "../../core/platform";
import { sendMessage, SendError } from "../../core/chat/send";
import { checkInbox } from "../../core/chat/inbox";
import { listAgents } from "../../core/agent/list";

export interface ToolCtx {
  db: DB;
  agentId: string;
  workspaceId: string;
  userId: string;
}

const inboxHint =
  "[AgentChat] If your last tool response had `_meta[\"agentchat/inbox\"].unread_mentions > 0`, call `check_inbox` before continuing.";

export const checkInboxSchema = z.object({});
export const sendMessageSchema = z.object({
  to: z.string().optional(),
  body: z.string().min(1),
});
export const listAgentsSchema = z.object({
  status: z.enum(["online", "idle", "offline"]).optional(),
  framework: z.string().optional(),
  deviceId: z.string().optional(),
});

export const toolDescriptions = {
  check_inbox: `Pull all unread @-mentions for this agent and recent workspace broadcasts. Auto-marks mentions as read. ${inboxHint}`,
  send_message: `Send a message in this agent's workspace. \`to\`: \`@<handle>\` for direct (calculates unread for recipient), \`*\` or omitted for broadcast (visible to all, NOT counted as unread). Body must not contain @all/@everyone literals. ${inboxHint}`,
  list_agents: `List agents in this workspace (use to find peers' \`host_session_id\` for \`claude --resume\`). ${inboxHint}`,
};

export async function invokeCheckInbox(ctx: ToolCtx) {
  return await checkInbox(ctx.db, ctx.agentId);
}

export async function invokeSendMessage(ctx: ToolCtx, args: { to?: string; body: string }) {
  try {
    return {
      ok: true as const,
      result: await sendMessage(ctx.db, {
        workspaceId: ctx.workspaceId,
        senderAgentId: ctx.agentId,
        senderUserId: ctx.userId,
        body: args.body,
        to: args.to,
      }),
    };
  } catch (e) {
    if (e instanceof SendError) return { ok: false as const, code: e.code, message: e.message };
    throw e;
  }
}

export async function invokeListAgents(
  ctx: ToolCtx,
  args: { status?: string; framework?: string; deviceId?: string }
) {
  const status =
    args.status === "online" || args.status === "idle" || args.status === "offline"
      ? args.status
      : undefined;
  const list = await listAgents(ctx.db, ctx.workspaceId, { ...args, status });
  return { agents: list };
}

/** Read-only inbox snapshot for `_meta` piggyback. Does NOT advance last_read_at. */
export async function inboxSnapshot(
  ctx: ToolCtx
): Promise<{ unread_mentions: number; latest_from?: string; latest_preview?: string }> {
  const rows = (await ctx.db.all(sql`
    SELECT m.id AS message_id, m.body, m.sender_agent_id
    FROM agents a
    LEFT JOIN mentions mt ON mt.target_agent_id = a.id
    LEFT JOIN messages m ON m.id = mt.message_id AND m.created_at > COALESCE(a.last_read_at, 0)
    WHERE a.id = ${ctx.agentId} AND m.id IS NOT NULL
    ORDER BY m.created_at DESC
  `)) as Array<{ message_id: string; body: string; sender_agent_id: string | null }>;
  return {
    unread_mentions: rows.length,
    latest_from: rows[0]?.sender_agent_id ?? undefined,
    latest_preview: rows[0]?.body?.slice(0, 80),
  };
}
