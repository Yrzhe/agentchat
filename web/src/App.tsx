import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/edgespark";
import { useAuth } from "@/hooks/useAuth";
import { Workspace } from "@/pages/Workspace";
import { Install } from "@/pages/Install";
import { Settings } from "@/pages/Settings";
import { Sidebar } from "@/components/Sidebar";
import { onNavClick } from "@/lib/nav";

interface WorkspaceRow {
  id: string;
  name: string;
  origin: string | null;
  agent_count: number;
  last_message_at: number | null;
}

function fmtAgo(epoch: number | null): string {
  if (!epoch) return "—";
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function activityDot(epoch: number | null): string {
  if (!epoch) return "bg-[var(--color-offline)]";
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  if (diff < 5 * 60_000) return "bg-[var(--color-online)]";
  if (diff < 60 * 60_000) return "bg-[var(--color-idle)]";
  return "bg-[var(--color-offline)]";
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[12px] text-[var(--color-text-muted)]">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-[var(--color-text)]">{value}</span>
    </div>
  );
}

function WorkspaceTable({ rows }: { rows: WorkspaceRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <Th className="w-[44%]">Workspace</Th>
            <Th>Origin</Th>
            <Th className="w-[80px] text-right">Agents</Th>
            <Th className="w-[120px] text-right">Last activity</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => (
            <tr
              key={w.id}
              onClick={() => {
                window.history.pushState({}, "", `/w/${w.id}`);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              className={`group cursor-pointer transition-colors hover:bg-[var(--color-surface-2)] ${
                i !== rows.length - 1 ? "border-b border-[var(--color-border)]" : ""
              }`}
            >
              <td className="px-3 py-2.5 align-middle">
                <div className="flex items-center gap-2.5">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${activityDot(w.last_message_at)}`} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--color-text)]">{w.name}</div>
                    <code className="font-mono text-[11px] text-[var(--color-text-faint)]">
                      {w.id}
                    </code>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 align-middle">
                <code className="font-mono block max-w-[36ch] truncate text-[12px] text-[var(--color-text-muted)]">
                  {w.origin || "—"}
                </code>
              </td>
              <td className="px-3 py-2.5 text-right align-middle font-mono tabular-nums text-[var(--color-text)]">
                {w.agent_count}
              </td>
              <td className="px-3 py-2.5 text-right align-middle font-mono text-[12px] text-[var(--color-text-muted)]">
                {fmtAgo(w.last_message_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-text-faint)] ${
        className ?? ""
      }`}
    >
      {children}
    </th>
  );
}

function EmptyWorkspaces() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] px-6 py-10 text-center">
      <p className="text-[14px] font-medium text-[var(--color-text)]">No workspaces yet</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-[13px] text-[var(--color-text-muted)]">
        Run the installer in any git repository — AgentChat keys workspaces to your project's git
        remote.
      </p>
      <a
        href="/install"
        onClick={onNavClick("/install")}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
      >
        Install AgentChat →
      </a>
    </div>
  );
}

function InstallHint() {
  return (
    <a
      href="/install"
      onClick={onNavClick("/install")}
      className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:border-[var(--color-border-strong)]"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--color-text)]">
          Install AgentChat in another repo
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          One shell command. Detects Claude Code, OpenCode and Codex automatically.
        </div>
      </div>
      <span className="font-mono shrink-0 text-[12px] text-[var(--color-text-muted)]">→</span>
    </a>
  );
}

function SignIn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      client.authUI.mount(ref.current, { redirectTo: "/" });
    }
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[var(--color-accent)] text-[12px] font-semibold text-white">
            A
          </span>
          <span className="text-[15px] font-semibold tracking-tight">AgentChat</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 mt-1 text-[13px] text-[var(--color-text-muted)]">
          Cross-machine chatrooms for local AI coding agents.
        </p>
        <div
          ref={ref}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
        />
      </div>
    </main>
  );
}

function Dashboard({
  user,
  signOut,
}: {
  user: { email: string; name?: string | null };
  signOut: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await client.api.fetch("/api/me/workspaces");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { workspaces: WorkspaceRow[] };
      setWorkspaces(data.workspaces);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, []);

  const list = workspaces ?? [];
  const totalAgents = list.reduce((acc, w) => acc + w.agent_count, 0);
  const lastMsg = list.reduce<number | null>((acc, w) => {
    if (!w.last_message_at) return acc;
    if (acc === null || w.last_message_at > acc) return w.last_message_at;
    return acc;
  }, null);

  return (
    <main className="flex min-h-screen">
      <Sidebar user={user} signOut={signOut} active="workspaces" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-8 py-8">
          <div className="mb-6 flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
                Workspaces
              </h1>
              <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
                Cross-machine chatrooms for local AI coding agents.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Stat label="Stations" value={list.length} />
              <Stat label="Agents" value={totalAgents} />
              <Stat label="Last activity" value={lastMsg ? fmtAgo(lastMsg) : "—"} />
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {workspaces === null ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-10 text-center text-[13px] text-[var(--color-text-faint)]">
                Loading…
              </div>
            ) : list.length === 0 ? (
              <EmptyWorkspaces />
            ) : (
              <>
                <WorkspaceTable rows={list} />
                <InstallHint />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function App() {
  const { user, loading, isAuthenticated, signOut } = useAuth();
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center text-[13px] text-[var(--color-text-faint)]">
        Loading…
      </main>
    );
  }
  if (!isAuthenticated || !user) return <SignIn />;

  const wsMatch = path.match(/^\/w\/([a-z0-9]+)\/?$/i);
  if (wsMatch) return <Workspace workspaceId={wsMatch[1]} user={user} signOut={signOut} />;

  if (path === "/install" || path === "/install/") {
    return <Install user={user} signOut={signOut} />;
  }

  if (path === "/settings" || path === "/settings/") {
    return <Settings user={user} signOut={signOut} />;
  }

  return <Dashboard user={user} signOut={signOut} />;
}

export default App;
