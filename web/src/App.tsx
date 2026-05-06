import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/edgespark";
import { useAuth } from "@/hooks/useAuth";
import { Workspace } from "@/pages/Workspace";

interface Workspace {
  id: string;
  name: string;
  origin: string | null;
  agent_count: number;
  last_message_at: number | null;
}

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-neutral-300">{label}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="bg-neutral-900 border border-neutral-800 rounded-lg p-4 text-sm text-neutral-100 whitespace-pre-wrap overflow-x-auto">
        {text}
      </pre>
    </div>
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
    <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="max-w-md w-full px-6 py-8">
        <h1 className="text-3xl font-semibold text-center mb-2">AgentChat</h1>
        <p className="text-neutral-400 text-center mb-8">
          A cloud chatroom for your local AI agents (Claude Code, OpenCode).
        </p>
        <div ref={ref} />
      </div>
    </main>
  );
}

function fmtAgo(epoch: number | null): string {
  if (!epoch) return "never";
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function WorkspaceList({ workspaces }: { workspaces: Workspace[] }) {
  if (workspaces.length === 0) {
    return (
      <div className="border border-dashed border-neutral-800 rounded-lg p-6 text-neutral-400 text-sm">
        You don't have any workspaces yet. Install AgentChat in a project (instructions below) — the installer creates a workspace from your git remote and adds you as the owner.
      </div>
    );
  }
  return (
    <div className="border border-neutral-800 rounded-lg divide-y divide-neutral-800">
      {workspaces.map((w) => (
        <a
          key={w.id}
          href={`/w/${w.id}`}
          className="block px-4 py-3 hover:bg-neutral-900 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-neutral-100 font-medium">{w.name}</div>
              <div className="text-xs text-neutral-500 mt-0.5">
                <code className="text-neutral-400">{w.id}</code>
                {w.origin && <> · {w.origin}</>}
              </div>
            </div>
            <div className="text-right text-xs text-neutral-500">
              <div>{w.agent_count} agent{w.agent_count === 1 ? "" : "s"}</div>
              <div>last msg: {fmtAgo(w.last_message_at)}</div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function Dashboard({ user, signOut }: { user: { email: string; name?: string | null }; signOut: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await client.api.fetch("/api/me/workspaces");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { workspaces: Workspace[] };
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

  // Agent prompt language — default English; switch to Chinese if the
  // browser's primary language starts with "zh". (Codex review LOW #27)
  const navLang = typeof navigator !== "undefined" ? (navigator.language || "en") : "en";
  const isZh = navLang.toLowerCase().startsWith("zh");
  const agentPrompt = isZh
    ? `请帮我安装 AgentChat 到这个项目（agent 一行命令搞定）：

1. 在终端运行（一行）：
   SERVER="${origin}" curl -fsSL "${origin}/install.sh" | SERVER="${origin}" sh

2. 浏览器会自动打开授权页 — 我点 Authorize 就行。
3. 安装完后告诉我 workspace_id，并把 ~/.claude.json 的 mcpServers.agentchat 写好的事情确认一下。

参考：dashboard 在 ${origin}/`
    : `Please install AgentChat into this project (one shell command should do it):

1. Run in the terminal (single line):
   SERVER="${origin}" curl -fsSL "${origin}/install.sh" | SERVER="${origin}" sh

2. A browser tab will open an authorize page — I'll click Authorize.
3. When the install finishes, tell me the workspace_id and confirm that
   ~/.claude.json now has \`mcpServers.agentchat\` wired up.

Reference: dashboard at ${origin}/`;

  const oneLiner = `SERVER="${origin}" curl -fsSL "${origin}/install.sh" | SERVER="${origin}" sh`;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">AgentChat</h1>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-400">{user.name || user.email}</span>
          <button onClick={signOut} className="text-neutral-400 hover:text-white">
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold mb-2">Your workspaces</h2>
        <p className="text-neutral-400 mb-4 text-sm">
          Click any workspace to view its live chat — read messages from agents, send your own messages or @-mention specific agents.
        </p>
        {error && <div className="text-red-400 text-sm mb-3">Error: {error}</div>}
        {workspaces === null ? (
          <div className="text-neutral-500 text-sm">Loading…</div>
        ) : (
          <WorkspaceList workspaces={workspaces} />
        )}

        <h2 className="text-2xl font-semibold mb-2 mt-12">Install in a project</h2>
        <p className="text-neutral-400 mb-8 text-sm">
          AgentChat keys workspaces to your project's git remote, so the same repo on different machines joins the same chatroom.
        </p>

        <h3 className="text-lg font-medium mb-3">Option A — Just paste this to your agent</h3>
        <p className="text-sm text-neutral-400 mb-3">
          Open a Claude Code or OpenCode session inside any git repo and paste the block below. It'll handle install + authorization.
        </p>
        <CopyBox label="Agent prompt" text={agentPrompt} />

        <h3 className="text-lg font-medium mb-3 mt-10">Option B — Install yourself</h3>
        <p className="text-sm text-neutral-400 mb-3">
          Run this from any project directory. It detects Claude Code / OpenCode automatically and writes the MCP config.
        </p>
        <CopyBox label="One-line install" text={oneLiner} />

        <h3 className="text-lg font-medium mb-3 mt-10">After install</h3>
        <ul className="text-sm text-neutral-300 list-disc pl-5 space-y-1">
          <li>Restart your agent (Claude Code / OpenCode) to load the new MCP server.</li>
          <li>Refresh this dashboard — your new workspace will appear in the list above.</li>
          <li>
            Tools available to your agent: <code>check_inbox</code>, <code>send_message</code>, <code>list_agents</code>.
          </li>
          <li>
            Uninstall:{" "}
            <code className="bg-neutral-900 px-2 py-0.5 rounded">
              SERVER="{origin}" curl -fsSL "{origin}/install.sh" | SERVER="{origin}" sh -s -- --uninstall
            </code>
          </li>
        </ul>
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
    return <main className="min-h-screen bg-neutral-950 text-neutral-500 flex items-center justify-center">Loading…</main>;
  }
  if (!isAuthenticated || !user) return <SignIn />;

  const wsMatch = path.match(/^\/w\/([a-z0-9]+)\/?$/i);
  if (wsMatch) return <Workspace workspaceId={wsMatch[1]} />;

  return <Dashboard user={user} signOut={signOut} />;
}

export default App;
