import { normalizeOrigin } from "./util/normalize-origin";

export async function deriveWorkspaceId(origin: string, alias: string | null): Promise<string> {
  const normalized = normalizeOrigin(origin);
  const seed = normalized ? `origin:${normalized}` : alias ? `alias:${alias.toLowerCase()}` : null;
  if (!seed) throw new Error("Either origin or alias is required to derive workspace_id");
  const hash = await sha256Hex(seed);
  return hash.slice(0, 16);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
