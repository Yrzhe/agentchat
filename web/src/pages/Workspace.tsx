import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/lib/edgespark";

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
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtAgo(epoch: number): string {
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function Workspace({ workspaceId }: { workspaceId: string }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await client.api.fetch(`/api/w/${workspaceId}/feed`);
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      if (res.status === 403) {
        setError("You're not a member of this workspace.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Feed;
      setFeed(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Auto-scroll to bottom when new messages arrive (and we're already near bottom)
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
      // Don't clear `to` — user might send several directs in a row.
      await refresh();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="max-w-md text-center px-6">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="text-blue-400 hover:text-blue-300">← Back to dashboard</a>
        </div>
      </main>
    );
  }
  if (!feed) {
    return <main className="min-h-screen bg-neutral-950 text-neutral-500 flex items-center justify-center">Loading…</main>;
  }

  function senderLabel(m: Message): string {
    if (m.sender_agent_id) {
      const a = feed!.agents.find((x) => x.id === m.sender_agent_id);
      const dev = a?.device_name ? ` @ ${a.device_name}` : "";
      const fw = a?.framework ? ` (${a.framework})` : "";
      return `agent ${m.sender_agent_id.slice(0, 8)}${dev}${fw}`;
    }
    if (m.sender_user_id) {
      const isMe = m.sender_user_id === feed!.currentUserId;
      return `${m.sender_user_name || m.sender_user_email || m.sender_user_id.slice(0, 8)}${isMe ? " (you)" : ""}`;
    }
    return "system";
  }

  function statusColor(s: string): string {
    if (s === "online") return "bg-green-500";
    if (s === "idle") return "bg-orange-500";
    return "bg-neutral-500";
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <a href="/" className="text-neutral-400 hover:text-white text-sm">← Dashboard</a>
          <div>
            <h1 className="text-lg font-semibold">{feed.workspace?.name ?? workspaceId}</h1>
            <div className="text-xs text-neutral-500">
              <code>{workspaceId}</code>
              {feed.workspace?.origin && <> · {feed.workspace.origin}</>}
            </div>
          </div>
        </div>
        <div className="text-xs text-neutral-500">live · refreshes every 3s</div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_280px] overflow-hidden">
        {/* Messages column */}
        <div className="flex flex-col overflow-hidden">
          <div ref={messagesRef} className="flex-1 overflow-y-auto px-6 py-4 flex flex-col-reverse">
            {feed.messages.length === 0 ? (
              <div className="text-neutral-500 text-sm text-center py-12">
                No messages yet. Send the first one below ↓
              </div>
            ) : (
              feed.messages.map((m) => (
                <div
                  key={m.id}
                  className={`mb-3 px-4 py-2 rounded-lg ${
                    m.kind === "broadcast" ? "bg-neutral-900" : "bg-yellow-950/40 border border-yellow-900/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1 text-xs text-neutral-500">
                    <span>{senderLabel(m)}</span>
                    <span>·</span>
                    <span>{fmtTime(m.created_at)}</span>
                    <span>·</span>
                    <span className="uppercase tracking-wide">{m.kind}</span>
                  </div>
                  <div className="text-sm text-neutral-100 whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              ))
            )}
          </div>

          {/* Send form */}
          <form onSubmit={send} className="border-t border-neutral-800 p-4 bg-neutral-925">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="To (optional): @<agent-id-prefix>, leave blank for broadcast"
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500"
              />
            </div>
            <div className="flex gap-2 items-start">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    void send(e);
                  }
                }}
                placeholder="Message agents in this workspace. Use @<agent-id-prefix> in the body to mention specific agents. ⌘/Ctrl-Enter to send."
                rows={2}
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 resize-y"
                disabled={sending}
              />
              <button
                type="submit"
                disabled={sending || !body.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white px-4 py-2 rounded text-sm font-medium"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
            {sendError && <div className="text-red-400 text-xs mt-2">{sendError}</div>}
          </form>
        </div>

        {/* Sidebar: agents */}
        <aside className="border-l border-neutral-800 overflow-y-auto px-4 py-4 hidden md:block">
          <h2 className="text-sm font-semibold text-neutral-300 mb-3">
            Agents ({feed.agents.length})
          </h2>
          {feed.agents.length === 0 ? (
            <div className="text-xs text-neutral-500">
              No agents registered yet. Run the installer in this project's git repo.
            </div>
          ) : (
            <ul className="space-y-3">
              {feed.agents.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColor(a.status)}`} />
                    <code className="text-xs text-neutral-300">{a.id.slice(0, 8)}</code>
                  </div>
                  <div className="text-xs text-neutral-500 ml-4 mt-0.5">
                    {a.framework}
                    {a.device_name && <> · {a.device_name}</>}
                  </div>
                  <div className="text-xs text-neutral-600 ml-4">
                    last seen {fmtAgo(a.last_heartbeat_at)}
                  </div>
                  {a.host_session_id && (
                    <div className="text-xs text-neutral-600 ml-4 truncate" title={a.host_session_id}>
                      session: <code>{a.host_session_id.slice(0, 12)}</code>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
