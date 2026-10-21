// GitHub Pages lets a browser keep index.html for up to 10 minutes, so a fresh
// deploy can go unseen. Every build writes version.json; when the one online
// is newer than this page, refresh the cached page and reload, but only while
// nothing is going on (no race, no friend in a room).
declare const __BUILD__: string;

const EVERY = 60; // s between checks

export function watchForUpdates(idle: () => boolean) {
  if (import.meta.env.DEV) return;
  const check = async () => {
    try {
      const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
      const { build } = (await res.json()) as { build?: string };
      if (!build || build === __BUILD__ || !idle()) return;
      // Once per build: if the server still hands out the old page, don't loop.
      if (sessionStorage.getItem('reloadedFor') === build) return;
      sessionStorage.setItem('reloadedFor', build);
      await fetch(location.href, { cache: 'reload' }).catch(() => {});
      location.reload();
    } catch { /* offline, or private mode without storage: try again later */ }
  };
  void check();
  setInterval(check, EVERY * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
}
