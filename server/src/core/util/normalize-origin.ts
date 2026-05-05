/**
 * Normalize a git remote URL to "host/owner/repo" lowercase.
 * Returns null if input is empty or unparseable.
 */
export function normalizeOrigin(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // git@host:owner/repo[.git]
  const sshShort = s.match(/^git@([^:]+):([^\s]+?)(?:\.git)?$/);
  if (sshShort) return `${sshShort[1]}/${sshShort[2]}`.toLowerCase();

  // ssh://[user@]host[:port]/owner/...repo[.git]
  // https://host/owner/...repo[.git]
  // http://...
  const m = s.match(/^(?:ssh:\/\/(?:[^@]+@)?|https?:\/\/)([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?$/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const path = m[2].toLowerCase().replace(/\/+$/, "");
  if (!path.includes("/")) return null;
  return `${host}/${path}`;
}
