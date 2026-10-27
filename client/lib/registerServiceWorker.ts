/**
 * Register the service worker as soon as the app loads.
 *
 * It used to be registered inside usePushNotifications, which only runs on the
 * Notifications page. A member who never opened that page had no worker at
 * all — so no push could be delivered to them and the home-screen badge never
 * moved while the app was closed, whatever they had agreed to. Registration
 * has to happen for everyone, whether or not they ever ask for notifications.
 *
 * Registering does not prompt for anything and does not subscribe them to
 * anything. It installs the worker that makes those possible later.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  // After load, so it never competes with the first paint on a phone on 4G at
  // a rehearsal hall.
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      // Private browsing and some locked-down configurations refuse. The app
      // works without it; only push and the badge are lost.
      console.warn("[SW] registration failed:", err);
    });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/**
 * Is this running as an app from the home screen, rather than in a browser tab?
 *
 * iOS only allows push for an installed app, and only Safari sets
 * `navigator.standalone`; everywhere else it is the display-mode media query.
 */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

/** iPhone or iPad, including the iPads that claim to be Macs. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
