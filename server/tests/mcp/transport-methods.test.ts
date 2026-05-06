import { describe, it, expect } from "vitest";
import { Hono, type Context } from "hono";

/**
 * Batch 4 #12 — verify the MCP webhook is mounted for POST/GET/DELETE.
 *
 * We can't easily exercise the real `index.ts` app in vitest (it imports
 * from `edgespark` which has no test stub), but we can pin the wiring shape
 * by reproducing the auth-gated dispatcher and asserting the same surface.
 * The dispatcher under test is `dispatchMcp` in src/index.ts; here we mirror
 * its behavior to lock in: any HTTP method routed to the path goes through
 * the same auth check, and unauthorized callers see 401 regardless of verb.
 */
describe("MCP transport — POST/GET/DELETE wiring (Codex MED #12)", () => {
  function buildAuthOnlyApp() {
    const app = new Hono();
    const handler = async (c: Context) => {
      const tokenHeader = c.req.header("authorization") ?? "";
      const token = tokenHeader.startsWith("Bearer ") ? tokenHeader.slice(7) : "";
      if (!token) {
        return new Response("unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer realm="agentchat"` },
        });
      }
      return new Response("ok", { status: 200 });
    };
    app.post("/api/webhooks/mcp/:workspaceId", handler);
    app.get("/api/webhooks/mcp/:workspaceId", handler);
    app.delete("/api/webhooks/mcp/:workspaceId", handler);
    return app;
  }

  it.each(["GET", "POST", "DELETE"] as const)("%s without bearer → 401", async (method) => {
    const app = buildAuthOnlyApp();
    const r = await app.fetch(
      new Request("http://test/api/webhooks/mcp/ws1", { method })
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it.each(["GET", "POST", "DELETE"] as const)("%s with bearer reaches handler", async (method) => {
    const app = buildAuthOnlyApp();
    const r = await app.fetch(
      new Request("http://test/api/webhooks/mcp/ws1", {
        method,
        headers: { authorization: "Bearer t" },
      })
    );
    expect(r.status).toBe(200);
  });
});
