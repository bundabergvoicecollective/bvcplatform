import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smartphone, BellOff } from "lucide-react";
import { usePushNotifications, howToUnblock } from "@/hooks/usePushNotifications";
import NotificationList, {
  NotificationBulkActions,
  useNotificationActions,
} from "@/components/NotificationList";

export default function Notifications() {
  const actions = useNotificationActions();
  const { unreadCount } = actions;
  const push = usePushNotifications();
  const blocked = push.permission === "denied";

  return (
    <BVCLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Notifications
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up!"}
            </p>
          </div>
          <NotificationBulkActions actions={actions} />
        </div>

        {/* On an iPhone, Safari exposes no push API at all in a normal tab, so
            this card used to be hidden from exactly the people who needed
            telling what to do about it. It now shows the way in instead. */}
        {push.needsInstall && (
          <Card className="border-0 shadow-sm" style={{ background: "oklch(0.97 0.02 185)" }}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "oklch(0.35 0.10 185)" }}>
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                    Add BVC to your Home Screen to get notifications
                  </p>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                    On an iPhone or iPad, Apple only allows notifications once the
                    app is saved to your Home Screen. It takes a moment:
                  </p>
                  <ol className="text-xs mt-2 space-y-1 list-decimal pl-4" style={{ color: "oklch(0.35 0.04 240)" }}>
                    <li>Tap the <strong>Share</strong> button at the bottom of Safari — the square with an arrow pointing up.</li>
                    <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                    <li>Tap <strong>Add</strong>.</li>
                    <li>Open BVC from the new icon on your Home Screen, come back here, and tap <strong>Turn on</strong>.</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Push notification opt-in card.

            The Turn on button used to be disabled whenever the browser had
            been told no, with nothing on screen to say why. Members reported
            it as a button that would not work — which is exactly what a
            greyed-out button with no message is. A control nobody can press
            and nobody can explain is worse than no control.

            So the blocked case gets words and the steps for THIS phone
            instead of a dead button, and the button is never disabled for a
            reason the member cannot see. */}
        {push.supported && !push.needsInstall && (
          <Card className="border-0 shadow-sm" style={{ background: blocked ? "oklch(0.97 0.03 60)" : "oklch(0.97 0.02 185)" }}>
            <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: blocked ? "oklch(0.50 0.13 60)" : "oklch(0.35 0.10 185)" }}
                >
                  {blocked ? <BellOff className="w-4 h-4 text-white" /> : <Smartphone className="w-4 h-4 text-white" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                    {blocked
                      ? "Notifications are blocked on this phone"
                      : push.subscribed
                        ? "Push notifications are on"
                        : "Enable push notifications"}
                  </p>
                  <p className="text-xs mt-0.5 leading-snug" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {blocked
                      ? <>Your phone was told no at some point, and it will not ask again. {howToUnblock()} Then come back here — this page notices by itself.</>
                      : push.subscribed
                        ? "You'll be notified even when the app is closed."
                        : "New music, announcements, performances and documents — even when the app is closed."}
                  </p>
                </div>
              </div>
              {!blocked && (
                <Button
                  size="sm"
                  variant={push.subscribed ? "outline" : "default"}
                  // Only ever disabled while a tap is actually being handled.
                  disabled={push.loading}
                  onClick={push.subscribed ? push.unsubscribe : push.subscribe}
                  style={push.subscribed ? {} : { background: "oklch(0.35 0.10 185)", color: "white" }}
                >
                  {push.loading ? "Working…" : push.subscribed ? "Turn off" : "Turn on"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <NotificationList actions={actions} />

      </div>
    </BVCLayout>
  );
}
