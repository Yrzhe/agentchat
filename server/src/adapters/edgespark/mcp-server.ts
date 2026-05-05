import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  toolDescriptions,
  checkInboxSchema,
  sendMessageSchema,
  listAgentsSchema,
  invokeCheckInbox,
  invokeSendMessage,
  invokeListAgents,
  inboxSnapshot,
  type ToolCtx,
} from "./tools";
import { upsertAgent, refreshHeartbeat } from "../../core/agent/register";
import type { DB } from "../../core/platform";

export interface McpRequestContext {
  db: DB;
  workspaceId: string;
  userId: string;
  headers: {
    framework?: string;
    frameworkVersion?: string;
    deviceId?: string;
    deviceName?: string;
    hostSessionId?: string;
  };
}

export async function handleMcpRequest(req: Request, ctx: McpRequestContext): Promise<Response> {
  const agentId = await upsertAgent(ctx.db, {
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    framework: ctx.headers.framework ?? "unknown",
    frameworkVersion: ctx.headers.frameworkVersion,
    deviceId: ctx.headers.deviceId ?? "unknown",
    deviceName: ctx.headers.deviceName,
    hostSessionId: ctx.headers.hostSessionId,
  });
  const toolCtx: ToolCtx = {
    db: ctx.db,
    agentId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
  };

  const server = new McpServer({ name: "agentchat", version: "0.1.0" });

  server.registerTool(
    "check_inbox",
    { description: toolDescriptions.check_inbox, inputSchema: checkInboxSchema.shape },
    async () => {
      await refreshHeartbeat(ctx.db, agentId);
      const result = await invokeCheckInbox(toolCtx);
      const meta = await inboxSnapshot(toolCtx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result } as Record<string, unknown>,
        _meta: { "agentchat/inbox": meta },
      };
    }
  );

  server.registerTool(
    "send_message",
    { description: toolDescriptions.send_message, inputSchema: sendMessageSchema.shape },
    async (args) => {
      await refreshHeartbeat(ctx.db, agentId);
      const r = await invokeSendMessage(toolCtx, args);
      const meta = await inboxSnapshot(toolCtx);
      if (!r.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: r.message }],
          _meta: { "agentchat/inbox": meta },
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(r.result, null, 2) }],
        structuredContent: { ...r.result } as Record<string, unknown>,
        _meta: { "agentchat/inbox": meta },
      };
    }
  );

  server.registerTool(
    "list_agents",
    { description: toolDescriptions.list_agents, inputSchema: listAgentsSchema.shape },
    async (args) => {
      await refreshHeartbeat(ctx.db, agentId);
      const result = await invokeListAgents(toolCtx, args);
      const meta = await inboxSnapshot(toolCtx);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: { ...result } as Record<string, unknown>,
        _meta: { "agentchat/inbox": meta },
      };
    }
  );

  const transport = new WebStandardStreamableHTTPServerTransport();
  await server.connect(transport);
  return await transport.handleRequest(req);
}
