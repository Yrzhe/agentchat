import { Hono } from "hono";
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

const app = new Hono()
  .post("/api/webhooks/mcp/:workspaceId", async (c) => {
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
  })
  .get("/api/public/health", (c) => c.json({ ok: true, version: "0.1.0" }));

mountInstallRoutes(app, getCtx);
mountStatusRoute(app, getCtx);

export default app;
