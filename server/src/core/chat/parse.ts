const MENTION_RE = /(?:^|[\s\(\[])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;
const BROADCAST_KEYWORDS = /(^|[^A-Za-z0-9_])@(all|everyone)\b/i;

export function parseMentions(body: string): string[] {
  const stripped = body.replace(/`[^`]*`/g, "");
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(stripped)) !== null) {
    const handle = m[1];
    if (handle.toLowerCase() === "all" || handle.toLowerCase() === "everyone") continue;
    if (!seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

export function containsBroadcastKeyword(body: string): boolean {
  const stripped = body.replace(/`[^`]*`/g, "");
  return BROADCAST_KEYWORDS.test(stripped);
}
