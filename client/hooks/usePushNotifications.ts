import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
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
    if (isSupported) {
      setPermission(Notification.permission);
      // Check if already subscribed
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setSubscribed(!!sub);
        });
      });
    }
  }, []);

  // Register service worker on mount
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });
    }
  }, []);

  const subscribe = async () => {
    if (!supported || !vapidKey) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Notification permission denied. Enable it in your browser settings.");
        return;
      }
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
      const reg = await navigator.serviceWorker.ready;
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

  return { supported, permission, subscribed, loading, subscribe, unsubscribe };
}
