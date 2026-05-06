import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { client } from "@/lib/edgespark";
import { Sidebar } from "@/components/Sidebar";

interface Agent {
  id: string;
  framework: string;
  device_name: string | null;
  host_session_id: string | null;
  status: string;
  last_heartbeat_at: number;
}

interface Message {
  id: string;
  body: string;
  kind: "broadcast" | "direct";
  sender_agent_id: string | null;
  sender_user_id: string | null;
  created_at: number;
  sender_user_name: string | null;
  sender_user_email: string | null;
}

interface Feed {
  workspace: { id: string; name: string; origin: string | null } | null;
  agents: Agent[];
  messages: Message[];
  currentUserId: string;
}

function fmtTime(epoch: number): string {
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtAgo(epoch: number): string {
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusDot(s: string): string {
  if (s === "online") return "bg-[var(--color-online)]";
  if (s === "idle") return "bg-[var(--color-idle)]";
  return "bg-[var(--color-offline)]";
}

function agentInitials(a: Agent | undefined): string {
  if (!a) return "??";
  const src = a.device_name || a.framework || a.id;
  return src.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "??";
}

function parseBody(body: string):
  | { kind: "text"; text: string }
  | { kind: "code"; pre: string; lang: string; code: string; post: string } {
  const m = body.match(/^([\s\S]*?)```([\w+-]*)\n([\s\S]*?)```([\s\S]*)$/);
  if (!m) return { kind: "text", text: body };
  return {
    kind: "code",
    pre: m[1].trim(),
    lang: m[2] || "text",
    code: m[3].replace(/\n$/, ""),
    post: m[4].trim(),
  };
}

interface WorkspaceProps {
  workspaceId: string;
  user: { email: string; name?: string | null };
  signOut: () => void;
}

export function Workspace({ workspaceId, user, signOut }: WorkspaceProps) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const etagRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) headers["If-None-Match"] = etagRef.current;
      const res = await client.api.fetch(`/api/w/${workspaceId}/feed`, { headers });
      if (res.status === 304) {
        setError(null);
        return;
      }
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      if (res.status === 403) {
        setError("You're not a member of this workspace.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newEtag = res.headers.get("etag");
      if (newEtag) etagRef.current = newEtag;
      const data = (await res.json()) as Feed;
      setFeed(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5_000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (!feed?.messages.length) return;
    const newest = feed.messages[0];
    if (lastMessageIdRef.current === newest.id) return;
    lastMessageIdRef.current = newest.id;
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop < 80;
    if (nearBottom) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [feed?.messages]);

  async function send(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await client.api.fetch(`/api/w/${workspaceId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: body.trim(), to: to.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }
      setBody("");
      await refresh();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const onlineCount = useMemo(
    () => (feed?.agents ?? []).filter((a) => a.status === "online").length,
    [feed?.agents],
  );

  if (error && !feed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-center">
          <p className="text-[13px] text-[var(--color-error)]">{error}</p>
          <a
            href="/"
            className="mt-3 inline-block text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            ← Back to workspaces
          </a>
        </div>
      </main>
    );
  }
  if (!feed) {
    return (
      <main className="flex min-h-screen items-center justify-center text-[13px] text-[var(--color-text-faint)]">
        Loading…
      </main>
    );
  }

  function senderInfo(m: Message): {
    initials: string;
    label: string;
    framework: string | null;
    sub: string | null;
    isAgent: boolean;
  } {
    if (m.sender_agent_id) {
      const a = feed!.agents.find((x) => x.id === m.sender_agent_id);
      return {
        initials: agentInitials(a),
        label: a?.framework ?? `agent ${m.sender_agent_id.slice(0, 6)}`,
        framework: a?.framework ?? null,
        sub: a?.device_name ?? m.sender_agent_id.slice(0, 8),
        isAgent: true,
      };
    }
    if (m.sender_user_id) {
      const isMe = m.sender_user_id === feed!.currentUserId;
      const name = m.sender_user_name || m.sender_user_email || m.sender_user_id.slice(0, 8);
      return {
        initials: name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "··",
        label: name,
        framework: null,
        sub: isMe ? "you" : null,
        isAgent: false,
      };
    }
    return { initials: "··", label: "system", framework: null, sub: null, isAgent: false };
  }

  const railBelow = (
    <div>
      <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-text-faint)]">
        Current
      </div>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
        <div className="truncate text-[13px] font-medium text-[var(--color-text)]">
          {feed.workspace?.name ?? "workspace"}
        </div>
        <code className="font-mono mt-0.5 block text-[10px] text-[var(--color-text-faint)]">
          {workspaceId}
        </code>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-online)]" />
          Live · 5s poll
        </div>
      </div>
    </div>
  );

  return (
    <main className="flex h-screen overflow-hidden">
      <Sidebar user={user} signOut={signOut} active="workspaces" belowNav={railBelow} />

      {/* Main */}
      <section className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
                {feed.workspace?.name ?? workspaceId}
              </h1>
              <code className="font-mono rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                {workspaceId}
              </code>
            </div>
            {feed.workspace?.origin && (
              <code className="font-mono mt-0.5 block max-w-[60ch] truncate text-[11px] text-[var(--color-text-faint)]">
                {feed.workspace.origin}
              </code>
            )}
          </div>
          <div className="flex items-center gap-3 text-[12px] text-[var(--color-text-muted)]">
            <span className="font-mono tabular-nums">{feed.messages.length} msgs</span>
            <span className="text-[var(--color-border)]">·</span>
            <span className="font-mono tabular-nums">
              <span className="text-[var(--color-online)]">●</span> {onlineCount}/{feed.agents.length} online
            </span>
          </div>
        </header>

        {/* Agents strip */}
        {feed.agents.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-1.5">
            {feed.agents.map((a) => (
              <div
                key={a.id}
                title={`${a.framework} · ${a.device_name ?? "—"} · last seen ${fmtAgo(a.last_heartbeat_at)}`}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px]"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot(a.status)}`} />
                <span className="font-mono text-[var(--color-text-faint)]">
                  {agentInitials(a)}
                </span>
                <span className="text-[var(--color-text-soft)]">{a.framework}</span>
                {a.device_name && (
                  <span className="font-mono text-[var(--color-text-faint)]">@{a.device_name}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Messages */}
        <div ref={messagesRef} className="flex flex-1 flex-col-reverse overflow-y-auto px-6 py-4">
          {feed.messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-6 py-12 text-center">
              <p className="text-[14px] font-medium text-[var(--color-text)]">No messages yet</p>
              <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-[var(--color-text-muted)]">
                Send the first one below — it lands in any connected agent's inbox immediately.
              </p>
            </div>
          ) : (
            feed.messages.map((m) => {
              const info = senderInfo(m);
              const parsed = parseBody(m.body);
              const isMention = m.kind === "direct";
              return (
                <div
                  key={m.id}
                  className={`group mb-2 flex gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-surface-2)] ${
                    isMention
                      ? "border-l-2 border-[var(--color-mention)] bg-[var(--color-mention-bg)] -ml-[2px]"
                      : ""
                  }`}
                >
                  <span className="font-mono mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-3)] text-[11px] font-semibold text-[var(--color-text-soft)]">
                    {info.initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-[var(--color-text)]">
                        {info.label}
                      </span>
                      {info.sub && (
                        <code className="font-mono text-[11px] text-[var(--color-text-faint)]">
                          {info.sub}
                        </code>
                      )}
                      {isMention && (
                        <span className="rounded bg-[var(--color-mention-bg)] px-1.5 text-[10px] font-medium text-[var(--color-mention)]">
                          mention
                        </span>
                      )}
                      <time className="font-mono ml-auto text-[11px] tabular-nums text-[var(--color-text-faint)]">
                        {fmtTime(m.created_at)}
                      </time>
                    </div>
                    {parsed.kind === "text" ? (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-[var(--color-text)]">
                        {parsed.text}
                      </p>
                    ) : (
                      <div className="mt-1 space-y-2">
                        {parsed.pre && (
                          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-[var(--color-text)]">
                            {parsed.pre}
                          </p>
                        )}
                        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
                          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1">
                            <code className="font-mono text-[10px] uppercase tracking-[0.04em] text-[var(--color-text-faint)]">
                              {parsed.lang}
                            </code>
                          </div>
                          <pre className="font-mono overflow-x-auto px-2.5 py-2 text-[12px] leading-[1.6] text-[var(--color-text)]">
                            {parsed.code}
                          </pre>
                        </div>
                        {parsed.post && (
                          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-[var(--color-text)]">
                            {parsed.post}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <form onSubmit={send} className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-3">
          <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]/50">
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To (optional): @<agent-id-prefix>, blank = broadcast"
              className="font-mono w-full border-b border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none"
            />
            <div className="flex items-end gap-2 px-3 py-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    void send(e);
                  }
                }}
                placeholder="Message agents in this workspace. ⌘/Ctrl-Enter to send."
                rows={2}
                disabled={sending}
                className="flex-1 resize-y bg-transparent text-[13.5px] leading-[1.55] text-[var(--color-text)] placeholder-[var(--color-text-faint)] outline-none"
              />
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-surface-3)] disabled:text-[var(--color-text-faint)]"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
          {sendError && (
            <div className="mt-1.5 text-[12px] text-[var(--color-error)]">{sendError}</div>
          )}
        </form>
      </section>
    </main>
  );
}
