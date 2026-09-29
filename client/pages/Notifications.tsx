import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, CheckCheck, CreditCard, Megaphone, Info, Music2, FileText, CalendarDays, Smartphone } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const TYPE_CONFIG = {
  pass_low: {
    icon: CreditCard,
    bg: "oklch(0.97 0.02 27)",
    text: "oklch(0.577 0.245 27.325)",
    label: "Pass Alert",
  },
  announcement: {
    icon: Megaphone,
    bg: "oklch(0.94 0.06 185)",
    text: "oklch(0.35 0.10 185)",
    label: "Announcement",
  },
  general: {
    icon: Info,
    bg: "oklch(0.94 0.01 240)",
    text: "oklch(0.35 0.04 240)",
    label: "General",
  },
  library: {
    icon: Music2,
    bg: "oklch(0.94 0.04 280)",
    text: "oklch(0.35 0.10 280)",
    label: "Music Library",
  },
  document: {
    icon: FileText,
    bg: "oklch(0.94 0.03 60)",
    text: "oklch(0.40 0.10 60)",
    label: "New Document",
  },
  event: {
    icon: CalendarDays,
    bg: "oklch(0.94 0.04 145)",
    text: "oklch(0.35 0.10 145)",
    label: "New Event",
  },
};

export default function Notifications() {
  const { data: notifications, isLoading, refetch } = trpc.notifications.list.useQuery();
  const utils = trpc.useUtils();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      refetch();
      utils.notifications.unread.invalidate();
    },
  });

  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      refetch();
      utils.notifications.unread.invalidate();
      toast.success("All notifications marked as read");
    },
  });

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;
  const push = usePushNotifications();

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
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 text-sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="w-4 h-4" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Push notification opt-in card — only shown on Android/PWA where it's supported */}
        {push.supported && (
          <Card className="border-0 shadow-sm" style={{ background: "oklch(0.97 0.02 185)" }}>
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "oklch(0.35 0.10 185)" }}>
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="font-medium text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                    {push.subscribed ? "Push notifications are on" : "Enable push notifications"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {push.subscribed
                      ? "You'll be notified even when the app is closed."
                      : "Get notified about announcements even when the app is closed."}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant={push.subscribed ? "outline" : "default"}
                disabled={push.loading || push.permission === "denied"}
                onClick={push.subscribed ? push.unsubscribe : push.subscribe}
                style={push.subscribed ? {} : { background: "oklch(0.35 0.10 185)", color: "white" }}
              >
                {push.loading ? "..." : push.subscribed ? "Turn off" : "Turn on"}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <BellOff className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No notifications</p>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                You'll be notified when your pass is running low or there are new updates.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {notifications.map((n) => {
              const config = TYPE_CONFIG[n.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.general;
              const Icon = config.icon;
              return (
                <Card
                  key={n.id}
                  className="border-0 shadow-sm transition-all"
                  style={!n.read ? { borderLeft: "4px solid oklch(0.55 0.14 185)" } : {}}
                >
                  <CardContent className="p-4 flex items-start gap-4">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: config.bg }}
                    >
                      <Icon className="w-4 h-4" style={{ color: config.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="font-semibold text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                          {n.title}
                        </p>
                        <Badge
                          className="text-xs"
                          style={{ background: config.bg, color: config.text }}
                        >
                          {config.label}
                        </Badge>
                        {!n.read && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ background: "oklch(0.55 0.14 185)" }}
                          />
                        )}
                      </div>
                      <p className="text-sm" style={{ color: "oklch(0.35 0.04 240)" }}>
                        {n.message}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                        {format(new Date(n.createdAt), "d MMM yyyy · h:mm a")}
                      </p>
                    </div>
                    {!n.read && (
                      <button
                        onClick={() => markRead.mutate({ notificationId: n.id })}
                        className="shrink-0 text-xs px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
                        style={{ color: "oklch(0.55 0.14 185)" }}
                      >
                        Mark read
                      </button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </BVCLayout>
  );
}
