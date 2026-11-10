import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { isIOS, isInstalled } from "@/lib/registerServiceWorker";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * navigator.serviceWorker.ready never resolves if no worker was ever
 * registered — it waits, silently, for one that is not coming. Awaiting it
 * bare left `loading` true for good, which is a button greyed out with no
 * message and no way back short of closing the app.
 */
function workerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("The app's background service did not start. Close BVC completely and open it again.")),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Where this particular person turns notifications back on.
 *
 * Once a browser has been told no, it will never ask again — the only way
 * back is the settings app, and where that is differs per platform. "Enable
 * it in your browser settings" is true everywhere and useful nowhere.
 */
export function howToUnblock(): string {
  if (isIOS()) {
    return isInstalled()
      ? "Open the Settings app → Notifications → BVC, and allow them."
      : "Open the Settings app → Apps → Safari → Notifications, and allow them for this site.";
  }
  // Chrome and the Samsung browser both put it behind the icon to the left
  // of the address bar.
  return "Tap the padlock or ⓘ next to the web address, then Permissions or Site settings, and allow Notifications.";
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  /** iPhone or iPad that has not been added to the home screen yet. */
  const [needsInstall, setNeedsInstall] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: vapidKey } = trpc.push.vapidPublicKey.useQuery();
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const unsubscribeMutation = trpc.push.unsubscribe.useMutation();

  useEffect(() => {
    const isSupported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(isSupported);
    // Safari exposes none of the push API in a normal tab, so on an iPhone an
    // unsupported result usually means "not installed yet" rather than "never
    // going to work" — and that has a fix the member can follow.
    setNeedsInstall(isIOS() && !isInstalled());
    if (isSupported) {
      setPermission(Notification.permission);
      // Check if already subscribed
      workerReady()
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setSubscribed(!!sub))
        // No worker, no subscription. Not knowing is not an error worth
        // putting in front of anybody.
        .catch(() => setSubscribed(false));
    }
  }, []);

  // Somebody who was blocked goes to their settings, allows notifications and
  // comes back to a page still insisting they are blocked, because
  // Notification.permission was read once at mount. Re-read it when they
  // return, or the instructions we just gave them appear not to work.
  useEffect(() => {
    if (!("Notification" in window)) return;
    const recheck = () => {
      if (document.visibilityState === "visible") setPermission(Notification.permission);
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, []);

  // Registration moved to client/lib/registerServiceWorker.ts, called at app
  // start. Doing it here meant anyone who never opened this page had no
  // worker, so push could not reach them and the badge never moved.

  const subscribe = async () => {
    if (needsInstall) {
      toast.error("Add BVC to your Home Screen first — then open it from there.");
      return;
    }
    if (!supported) {
      toast.error("This browser cannot show notifications.");
      return;
    }

    // ASK FIRST, BEFORE ANY await.
    //
    // A browser only shows the permission prompt while it still considers
    // itself to be handling the tap. The old order awaited
    // serviceWorker.ready first, which ends that window: on the stricter
    // browsers the request was then refused without a prompt ever appearing,
    // and the member saw nothing happen. It is the reason this worked on some
    // phones and not others.
    let perm: NotificationPermission = Notification.permission;
    if (perm !== "granted") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        perm = Notification.permission;
      }
    }
    setPermission(perm);
    if (perm === "denied") {
      toast.error(`Notifications are blocked for BVC. ${howToUnblock()}`, { duration: 12_000 });
      return;
    }
    if (perm !== "granted") {
      // Dismissed rather than refused: asking again later is allowed.
      toast("No answer given, so nothing changed. Tap Turn on again when you are ready.");
      return;
    }

    setLoading(true);
    try {
      // Checked here rather than in a silent early return: the button did
      // nothing at all while this query was still in flight, which looks
      // exactly like a broken button.
      if (!vapidKey) {
        toast.error("Notifications are not ready yet — wait a moment and tap Turn on again.");
        return;
      }
      const reg = await workerReady();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      await subscribeMutation.mutateAsync({ endpoint: json.endpoint, keys: json.keys });
      setSubscribed(true);
      toast.success("Push notifications enabled!");
    } catch (err: any) {
      console.error("[Push] Subscribe error:", err);
      toast.error("Could not enable push notifications: " + (err?.message ?? "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await workerReady();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await unsubscribeMutation.mutateAsync({ endpoint: sub.endpoint });
      }
      setSubscribed(false);
      toast.success("Push notifications disabled.");
    } catch (err: any) {
      console.error("[Push] Unsubscribe error:", err);
      toast.error("Could not disable push notifications.");
    } finally {
      setLoading(false);
    }
  };

  return { supported, permission, subscribed, loading, needsInstall, subscribe, unsubscribe };
}
