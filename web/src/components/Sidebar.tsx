import { onNavClick } from "@/lib/nav";

export type NavKey = "workspaces" | "install" | "settings";

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

const items: NavItem[] = [
  { key: "workspaces", label: "Workspaces", href: "/" },
  { key: "install", label: "Install", href: "/install" },
  { key: "settings", label: "Settings", href: "/settings" },
];

interface SidebarProps {
  user: { email: string; name?: string | null };
  signOut: () => void;
  active: NavKey;
  /**
   * Optional extra block shown between the nav and the user card. Used by the
   * workspace page to show the currently-open workspace.
   */
  belowNav?: React.ReactNode;
}

export function Sidebar({ user, signOut, active, belowNav }: SidebarProps) {
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();
  return (
    <aside className="flex h-screen w-[200px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-4">
      <a href="/" onClick={onNavClick("/")} className="mb-5 flex items-center gap-2 px-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--color-accent)] text-[11px] font-semibold text-white">
          A
        </span>
        <span className="text-[14px] font-semibold tracking-tight text-[var(--color-text)]">
          AgentChat
        </span>
      </a>
      <nav className="space-y-0.5">
        {items.map((it) => {
          const isActive = it.key === active;
          const cls = isActive
            ? "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
            : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] border border-transparent";
          return (
            <a
              key={it.key}
              href={it.href}
              onClick={onNavClick(it.href)}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition-colors ${cls}`}
            >
              <span>{it.label}</span>
            </a>
          );
        })}
      </nav>
      {belowNav && <div className="mt-4">{belowNav}</div>}
      <div className="mt-auto flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-[10px] font-semibold text-[var(--color-text-soft)]">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-[var(--color-text)]">
            {user.name || user.email}
          </div>
          <button
            onClick={signOut}
            className="text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
