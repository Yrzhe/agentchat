import { Sidebar } from "@/components/Sidebar";

interface SettingsProps {
  user: { email: string; name?: string | null; id?: string };
  signOut: () => void;
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0 sm:grid-cols-[180px_1fr] sm:items-baseline sm:gap-4">
      <div>
        <div className="text-[13px] font-medium text-[var(--color-text)]">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{hint}</div>
        )}
      </div>
      <div className="text-[13px] text-[var(--color-text-soft)]">{value}</div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5">
        <h2 className="text-[13px] font-semibold text-[var(--color-text)]">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{description}</p>
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Settings({ user, signOut }: SettingsProps) {
  const navLang = typeof navigator !== "undefined" ? navigator.language || "en" : "en";
  const isZh = navLang.toLowerCase().startsWith("zh");
  const tz = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

  return (
    <main className="flex min-h-screen">
      <Sidebar user={user} signOut={signOut} active="settings" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-8">
          <div className="mb-6">
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-text)]">
              Settings
            </h1>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              Account and preferences. Token management is per-machine and lives in{" "}
              <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
                ~/.agentchat/credentials.json
              </code>
              .
            </p>
          </div>

          <div className="space-y-5">
            <Card title="Account">
              <Row
                label="Name"
                value={user.name || <span className="text-[var(--color-text-faint)]">— not set</span>}
              />
              <Row label="Email" value={<code className="font-mono">{user.email}</code>} />
              {user.id && (
                <Row
                  label="User ID"
                  value={<code className="font-mono text-[12px]">{user.id}</code>}
                  hint="Stable identifier used for workspace membership"
                />
              )}
            </Card>

            <Card title="Preferences" description="Auto-detected from your browser; not yet customizable">
              <Row
                label="Agent prompt language"
                value={isZh ? "中文 (zh)" : "English (en)"}
                hint="Used by the prompt you copy on the Install page"
              />
              <Row
                label="Timezone"
                value={<code className="font-mono">{tz}</code>}
                hint="All timestamps render in this timezone"
              />
            </Card>

            <Card
              title="Tokens"
              description="Per-machine bearer tokens, minted by the install flow"
            >
              <div className="px-4 py-3 text-[13px] text-[var(--color-text-soft)]">
                Tokens are stored locally on each machine that ran the installer. They are bound to{" "}
                <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
                  audience
                </code>{" "}
                +{" "}
                <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
                  workspace:&lt;id&gt;
                </code>{" "}
                so a leaked token can't be replayed against a different workspace.
                <p className="mt-2 text-[var(--color-text-muted)]">
                  To rotate or revoke: re-run the installer with{" "}
                  <code className="font-mono rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
                    --uninstall
                  </code>{" "}
                  on the source machine, then run the installer again. Centralized listing/revocation lands in v2.
                </p>
              </div>
            </Card>

            <Card title="Session" description="Browser session for this dashboard">
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="text-[13px] text-[var(--color-text-soft)]">
                  Sign out of this browser. Your tokens on each installed machine remain valid until you uninstall there.
                </div>
                <button
                  onClick={signOut}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-soft)] transition-colors hover:border-[var(--color-error)]/40 hover:text-[var(--color-error)]"
                >
                  Sign out
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </main>
  );
}
