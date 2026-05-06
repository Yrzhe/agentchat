import { Hono, type Context } from "hono";
import { db as edgesparkDb } from "edgespark";
import type { DB } from "./core/platform";
import { makeEdgesparkAuth } from "./adapters/edgespark/auth";
import { handleMcpRequest } from "./adapters/edgespark/mcp-server";
import { mountInstallRoutes } from "./install/handlers";
import { mountStatusRoute } from "./web/status";

function getCtx() {
  const db = edgesparkDb as unknown as DB;
  return { db, auth: makeEdgesparkAuth(db) };
}

/**
 * Authenticate the bearer token against the workspace audience and dispatch
 * to the MCP Streamable HTTP transport. Used for POST (RPC), GET (server →
 * client SSE side-channel), and DELETE (session terminate) per MCP 2025-06-18.
 *
 * Implementation note: this server runs in stateless mode (no
 * `sessionIdGenerator`). Each request is fully self-contained — there is no
 * `Mcp-Session-Id` issued or expected. This is a deliberate fit for
 * Cloudflare Workers, where there's no shared in-memory state across
 * isolates and any persistent session would require a separate KV/DO write.
 * The transport supports POST/GET/DELETE in stateless mode; clients that
 * speak the full Streamable HTTP profile work without changes.
 */
async function dispatchMcp(c: Context): Promise<Response> {
  const { db, auth } = getCtx();
  const workspaceId = c.req.param("workspaceId");
  const url = new URL(c.req.url);
  const expectedAud = `${url.origin}/api/webhooks/mcp/${workspaceId}`;
  const tokenHeader = c.req.header("authorization") ?? "";
  const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.slice(7) : "";
  const identity = await auth.verifyKey(token, expectedAud);
  if (!identity || identity.workspaceId !== workspaceId) {
    return new Response("unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer realm="agentchat"` },
    });
  }
  return handleMcpRequest(c.req.raw, {
    db,
    workspaceId,
    userId: identity.userId,
    headers: {
      framework: c.req.header("x-agentchat-framework") ?? undefined,
      frameworkVersion: c.req.header("x-agentchat-framework-version") ?? undefined,
      deviceId: c.req.header("x-agentchat-device-id") ?? undefined,
      deviceName: c.req.header("x-agentchat-device-name") ?? undefined,
      hostSessionId: c.req.header("x-agentchat-host-session") ?? undefined,
    },
  });
}

const app = new Hono()
  .post("/api/webhooks/mcp/:workspaceId", dispatchMcp)
  .get("/api/webhooks/mcp/:workspaceId", dispatchMcp)
  .delete("/api/webhooks/mcp/:workspaceId", dispatchMcp)
  .get("/api/public/health", (c) => c.json({ ok: true, version: "0.1.0" }));

mountInstallRoutes(app, getCtx);
mountStatusRoute(app, getCtx);

export default app;
