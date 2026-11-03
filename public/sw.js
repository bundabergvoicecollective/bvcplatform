// BVC Service Worker — Web Push notifications and the home-screen icon badge.

/**
 * Put the unread count on the app icon.
 *
 * The push itself cannot carry the number: sendPushToAll broadcasts one
 * payload to every subscription, so it has no idea who is reading it. The
 * worker therefore asks on its own behalf — a same-origin fetch here carries
 * the member's session cookie, so the server answers for the right person.
 *
 * On any failure the badge is left exactly as it was. A stale number is worse
 * than no change, and the notification itself has already told them something
 * happened.
 */
async function refreshBadge() {
  if (!self.navigator || typeof self.navigator.setAppBadge !== "function") return;
  try {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: null } }));
    const res = await fetch(`/api/trpc/notifications.unread?batch=1&input=${input}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const body = await res.json();
    const slot = Array.isArray(body) ? body[0] : body;
    // superjson wraps the payload; unwrap defensively so a transformer change
    // does not silently start badging zero.
    const rows = slot?.result?.data?.json ?? slot?.result?.data;
    if (!Array.isArray(rows)) return;
    if (rows.length > 0) await self.navigator.setAppBadge(rows.length);
    else await self.navigator.clearAppBadge();
  } catch {
    // Offline, signed out, or a platform that only pretends to support this.
  }
}

/**
 * Take over straight away.
 *
 * Without these, a new worker sits in "waiting" until every tab using the old
 * one is closed — and a Home Screen app is never closed, it is suspended. A
 * fix to the push or badge handling below would reach a member weeks after it
 * shipped, or never.
 *
 * Safe here because this worker controls no fetches and serves nothing from a
 * cache: there is no half-updated state for a new version to inherit.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Bundaberg Voice Collective", body: event.data.text() };
  }

  const title = data.title || "Bundaberg Voice Collective";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
  };

  // Both, not one after the other: the notification must appear even if the
  // badge lookup is slow or fails.
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), refreshBadge()]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // The app will set the exact figure once it loads; this keeps the icon from
  // showing a stale number while it starts up.
  event.waitUntil(refreshBadge());
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
