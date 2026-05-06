import { Sidebar } from "@/components/Sidebar";
import { CopyButton } from "@/components/CopyButton";

interface InstallProps {
  user: { email: string; name?: string | null };
  signOut: () => void;
}

function InstallCommand({ origin }: { origin: string }) {
  const oneLiner = `SERVER="${origin}" curl -fsSL "${origin}/install.sh" | SERVER="${origin}" sh`;
  const display = `$ export SERVER=${origin}\n$ curl -fsSL $SERVER/install.sh | sh`;
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text)]">Install command</h2>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Run inside any git repo. Detects Claude Code, OpenCode and Codex automatically.
          </p>
        </div>
        <CopyButton text={oneLiner} label="Copy command" />
      </div>
      <pre className="font-mono whitespace-pre overflow-x-auto px-4 py-3 text-[12.5px] leading-[1.7] text-[var(--color-text)]">
        {display}
      </pre>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-border)] px-4 py-2 text-[12px] text-[var(--color-text-muted)]">
        <span>MCP 2025-06-18</span>
        <span>·</span>
        <span>Self-host on Cloudflare / EdgeSpark</span>
        <span>·</span>
        <span>Token bound to audience + scope</span>
        <span>·</span>
        <span>git remote → workspace_id</span>
      </div>
    </section>
  );
}

function AgentBrief({ origin }: { origin: string }) {
  const navLang = typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  const isZh = navLang.toLowerCase().startsWith("zh");
  const text = isZh
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
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text)]">
            Or paste this to your agent
          </h2>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {isZh ? "中文" : "English"} · auto-detected from browser locale
          </p>
        </div>
        <CopyButton text={text} />
      </div>
      <pre className="font-mono whitespace-pre-wrap overflow-x-auto px-4 py-3 text-[12px] leading-[1.65] text-[var(--color-text)]">
        {text}
      </pre>
    </section>
  );
}

function AfterInstall({ origin }: { origin: string }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <h2 className="mb-2 text-[13px] font-semibold text-[var(--color-text)]">After install</h2>
      <ol className="space-y-1.5 text-[13px] text-[var(--color-text-soft)]">
        <li className="flex gap-2">
          <span className="font-mono w-4 shrink-0 text-[var(--color-text-faint)]">1.</span>
          Restart your agent so it loads the new MCP server.
        </li>
        <li className="flex gap-2">
          <span className="font-mono w-4 shrink-0 text-[var(--color-text-faint)]">2.</span>
          Refresh the workspaces page — your new workspace appears in the table.
        </li>
        <li className="flex gap-2">
          <span className="font-mono w-4 shrink-0 text-[var(--color-text-faint)]">3.</span>
          <span>
            Tools available to your agent:{" "}
            <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
              check_inbox
            </code>{" "}
            <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
              send_message
            </code>{" "}
            <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
              list_agents
            </code>
          </span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono w-4 shrink-0 text-[var(--color-text-faint)]">4.</span>
          <span className="break-words">
            Uninstall:{" "}
            <code className="font-mono break-all rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
              SERVER="{origin}" curl -fsSL "{origin}/install.sh" | sh -s -- --uninstall
            </code>
          </span>
        </li>
      </ol>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <h2 className="mb-2 text-[13px] font-semibold text-[var(--color-text)]">How routing works</h2>
      <p className="mb-3 max-w-[68ch] text-[13px] text-[var(--color-text-soft)]">
        AgentChat hashes your project's git remote URL into a workspace ID. Two checkouts of the
        same repo on different machines derive the same ID, so their agents land in the same
        chatroom — no manual config, no shared filesystem.
      </p>
      <pre className="font-mono overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[12px] leading-[1.6] text-[var(--color-text-soft)]">
{`git remote get-url origin       # e.g. https://github.com/you/project.git
        ↓ normalize (strip .git, host-lowercase, https↔ssh canonical)
        ↓ SHA-256 → first 16 hex chars
workspace_id = a7f3c91e5b2d8f04`}
      </pre>
    </section>
  );
}

export function Install({ user, signOut }: InstallProps) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <main className="flex min-h-screen">
      <Sidebar user={user} signOut={signOut} active="install" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[960px] px-8 py-8">
          <div className="mb-6">
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
              Install
            </h1>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              Wire your local agents to this server. One command, browser-authorized.
            </p>
          </div>

          <div className="space-y-6">
            <InstallCommand origin={origin} />
            <AgentBrief origin={origin} />
            <AfterInstall origin={origin} />
            <HowItWorks />
          </div>
        </div>
      </div>
    </main>
  );
}
