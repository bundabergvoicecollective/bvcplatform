/**
 * Pick up a new version without anyone being told to.
 *
 * An app on a Home Screen is not a frozen copy — it loads from the server
 * every time it genuinely starts, and nothing here is cached, so a deploy
 * reaches members on their next cold start with no reinstalling.
 *
 * The problem is that phones rarely cold-start anything. iOS suspends a Home
 * Screen app and resumes it exactly as it was, for days. A member who tapped
 * the icon last week is still running last week's bundle, and the only way
 * out is to swipe the app away — which nobody will do, and which is not a
 * thing to teach seventy people who were walked through installing it once
 * already.
 *
 * So: when the app comes back to the foreground, ask the server which bundle
 * it is serving now. If it is a different one, reload.
 *
 * WHY THE COMPARISON WORKS. Vite names the entry bundle with a hash of its
 * contents — /assets/index-DsESNVD3.js — so the filename changes if and only
 * if the code did. `import.meta.url` is this module's own URL, which is that
 * bundle. Comparing it against the one in the freshly-fetched HTML asks
 * exactly the right question, with no version file to maintain and nothing
 * to forget to bump.
 *
 * WHEN IT RELOADS. Only on returning to a backgrounded app. Never on a timer
 * while somebody is using it: a reload in the middle of typing a message or
 * marking a roll would lose their work, and a stale tab in active use is a
 * far smaller problem than that.
 */

/** The bundle this code was loaded from, e.g. "index-DsESNVD3.js". */
function runningBundle(): string | null {
  try {
    return new URL(import.meta.url).pathname.split("/").pop() ?? null;
  } catch {
    return null;
  }
}

/** The entry bundle the server is serving right now, or null if unknown. */
async function servedBundle(): Promise<string | null> {
  try {
    const res = await fetch("/", {
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.match(/\/assets\/(index-[^"']+\.js)/)?.[1] ?? null;
  } catch {
    // Offline, or the server is cold and slow. Not knowing is fine; it will
    // be asked again the next time they come back.
    return null;
  }
}

export function startAutoUpdate(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const running = runningBundle();
  // In dev the entry is /client/main.tsx and there is no hashed bundle to
  // compare, so there is nothing sensible to do.
  if (!running || !running.startsWith("index-")) return;

  let checking = false;

  const check = async () => {
    if (checking || document.visibilityState !== "visible") return;
    checking = true;
    try {
      const served = await servedBundle();
      if (!served || served === running) return;

      // One reload per new version, not a loop. If the reload somehow lands
      // back on the old bundle — a stale edge cache, a proxy — reloading
      // again would spin forever and the member would see a flickering app
      // they cannot use.
      const key = "bvc:reloaded-for";
      if (sessionStorage.getItem(key) === served) return;
      sessionStorage.setItem(key, served);

      console.log(`[Update] ${running} → ${served}, reloading`);
      window.location.reload();
    } catch {
      // Never let an update check put an error in front of anybody.
    } finally {
      checking = false;
    }
  };

  // Coming back to a backgrounded app: the moment that matters, and the one
  // moment a reload costs nothing because they have not started anything yet.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });

  // iOS fires pageshow with persisted=true when a page is restored from the
  // back-forward cache, where visibilitychange may not fire at all.
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) void check();
  });
}
