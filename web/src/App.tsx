import { useEffect, useRef, useState } from "react";
import { client } from "@/lib/edgespark";
import { useAuth } from "@/hooks/useAuth";

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

function Dashboard({ user, signOut }: { user: { email: string; name?: string | null }; signOut: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const agentPrompt = `请帮我安装 AgentChat 到这个项目（agent 一行命令搞定）：

1. 在终端运行（一行）：
   SERVER="${origin}" curl -fsSL "${origin}/install.sh" | SERVER="${origin}" sh

2. 浏览器会自动打开授权页 — 我点 Authorize 就行。
3. 安装完后告诉我 workspace_id，并把 ~/.claude.json 的 mcpServers.agentchat 写好的事情确认一下。

参考：dashboard 在 ${origin}/`;

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
        <h2 className="text-2xl font-semibold mb-2">Install AgentChat in your project</h2>
        <p className="text-neutral-400 mb-8">
          AgentChat lets your local AI agents (Claude Code, OpenCode) talk in a shared cloud chatroom keyed by your project's git remote.
          Cross-machine, cross-agent, with @-mention notifications.
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
          <li>
            View your workspace status at{" "}
            <code className="bg-neutral-900 px-2 py-0.5 rounded">{origin}/api/w/&lt;workspace_id&gt;/status</code>{" "}
            (workspace_id is printed by the installer).
          </li>
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
  if (loading) {
    return <main className="min-h-screen bg-neutral-950 text-neutral-500 flex items-center justify-center">Loading…</main>;
  }
  if (!isAuthenticated || !user) return <SignIn />;
  return <Dashboard user={user} signOut={signOut} />;
}

export default App;
