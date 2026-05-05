import { sql } from "drizzle-orm";
import type { AuthAdapter, DB } from "../../core/platform";

export function makeEdgesparkAuth(db: DB): AuthAdapter {
  return {
    async verifyKey(token, expectedAud) {
      const hash = await sha256Hex(token);
      const rows = (await db.all(sql`
        SELECT k.user_id, k.workspace_id, k.scope, k.audience, k.revoked_at,
               EXISTS (SELECT 1 FROM workspace_members m
                       WHERE m.workspace_id = k.workspace_id AND m.user_id = k.user_id) AS is_member
        FROM api_keys k WHERE k.hash = ${hash} LIMIT 1
      `)) as Array<{ user_id: string; workspace_id: string; scope: string; audience: string; revoked_at: number | null; is_member: number }>;
      if (!rows.length) return null;
      const r = rows[0];
      if (r.revoked_at) return null;
      if (r.audience !== expectedAud) return null;
      if (r.scope !== `workspace:${r.workspace_id}`) return null;
      if (!r.is_member) return null;

      void db.run(sql`UPDATE api_keys SET last_used_at = ${Date.now()} WHERE hash = ${hash}`);
      return { userId: r.user_id, workspaceId: r.workspace_id };
    },

    async currentUser(_req) {
      const { auth } = await import("edgespark/http");
      return auth.isAuthenticated() ? { id: auth.user.id, email: auth.user.email ?? "", name: auth.user.name ?? "" } : null;
    },
  };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
