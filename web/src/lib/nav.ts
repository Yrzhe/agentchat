/**
 * Tiny SPA navigation helper. We use pushState + a synthetic popstate
 * event so App.tsx's path listener picks up the change without a full
 * page reload.
 */
export function navigate(href: string): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === href) return;
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function onNavClick(href: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let cmd/ctrl-click and middle-click open in new tab as expected.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navigate(href);
  };
}
