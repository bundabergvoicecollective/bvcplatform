import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BellOff, CheckCheck, CreditCard, Megaphone, Info, Music2, FileText,
  CalendarDays, Trash2, Mail, MailOpen,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

/**
 * One notification list, used everywhere notifications are shown.
 *
 * There were two of these — the Notifications page and a panel on
 * Announcements — rendering the same rows from the same query with slightly
 * different behaviour. Adding delete and unread to both would have made it
 * three copies the next time, which is exactly how the dialog that could not
 * be scrolled survived three private workarounds.
 *
 * WHAT A MEMBER CAN DO WITH ONE
 *
 *   Mark read      — clears it from the bell count without losing it.
 *   Mark unread    — puts it back. Reading one on a phone is often a thumb
 *                    in the wrong place, and marking it unread is the only
 *                    way to keep hold of something you cannot deal with yet.
 *   Delete         — throws it away.
 *   Clear read     — deletes every notification already read, in one go.
 *
 * Only the bulk delete asks first. Deleting one notice is small and obvious;
 * a confirmation on every tap is the kind of thing people learn to dismiss
 * without reading, which is worse than no confirmation at all. Clearing
 * dozens at once is not small, and it names the number before it happens.
 *
 * Clear read never touches an unread one. Whatever somebody has not yet seen
 * is the one thing a tidy-up button must not take away.
 */

const TYPE_CONFIG = {
  pass_low: { icon: CreditCard, bg: "oklch(0.97 0.02 27)", text: "oklch(0.577 0.245 27.325)", label: "Pass Alert" },
  announcement: { icon: Megaphone, bg: "oklch(0.94 0.06 185)", text: "oklch(0.35 0.10 185)", label: "Announcement" },
  general: { icon: Info, bg: "oklch(0.94 0.01 240)", text: "oklch(0.35 0.04 240)", label: "General" },
  library: { icon: Music2, bg: "oklch(0.94 0.04 280)", text: "oklch(0.35 0.10 280)", label: "Music Library" },
  document: { icon: FileText, bg: "oklch(0.94 0.03 60)", text: "oklch(0.40 0.10 60)", label: "New Document" },
  event: { icon: CalendarDays, bg: "oklch(0.94 0.04 145)", text: "oklch(0.35 0.10 145)", label: "New Event" },
};

const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";
const MUTED = "oklch(0.52 0.03 240)";

export function useNotificationActions() {
  const utils = trpc.useUtils();
  const { data: notifications, isLoading, refetch } = trpc.notifications.list.useQuery();

  // Both counts, not just one. The bell reads `unread` and the sidebar
  // badges read `unreadSummary`; refreshing only the first left Announcements
  // and Chat showing numbers that had already been cleared, until the
  // 30-second poll caught up.
  const after = () => {
    refetch();
    utils.notifications.unread.invalidate();
    utils.notifications.unreadSummary.invalidate();
  };

  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: after, onError: (e) => toast.error(e.message) });
  const markUnread = trpc.notifications.markUnread.useMutation({ onSuccess: after, onError: (e) => toast.error(e.message) });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { after(); toast.success("All notifications marked as read"); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.notifications.delete.useMutation({
    onSuccess: () => { after(); toast.success("Notification deleted"); },
    onError: (e) => toast.error(e.message),
  });
  const clearRead = trpc.notifications.clearRead.useMutation({
    onSuccess: (n) => {
      after();
      toast.success(n === 1 ? "1 read notification deleted" : `${n} read notifications deleted`);
    },
    onError: (e) => toast.error(e.message),
  });

  const list = notifications ?? [];
  return {
    notifications: list,
    isLoading,
    unreadCount: list.filter((n) => !n.read).length,
    readCount: list.filter((n) => n.read).length,
    markRead, markUnread, markAll, remove, clearRead,
  };
}

type Actions = ReturnType<typeof useNotificationActions>;

/** Mark all read / Clear read. Rendered above the list by both callers. */
export function NotificationBulkActions({ actions }: { actions: Actions }) {
  const [confirming, setConfirming] = useState(false);
  const { unreadCount, readCount, markAll, clearRead } = actions;
  if (!unreadCount && !readCount) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {unreadCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 text-sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
        >
          <CheckCheck className="w-4 h-4" /> Mark all read
        </Button>
      )}

      {readCount > 0 && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2 text-sm"
            onClick={() => setConfirming(true)}
            disabled={clearRead.isPending}
          >
            <Trash2 className="w-4 h-4" /> Clear read ({readCount})
          </Button>

          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {readCount} read notification{readCount === 1 ? "" : "s"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This cannot be undone. Anything still unread is left alone
                  {unreadCount > 0 ? `, so your ${unreadCount} unread one${unreadCount === 1 ? "" : "s"} will stay` : ""}.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearRead.mutate()}
                  style={{ background: "oklch(0.55 0.18 25)", color: "white" }}
                >
                  Delete them
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

export function NotificationEmpty() {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
        <BellOff className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
        <p className="font-medium" style={{ color: NAVY }}>No notifications</p>
        <p className="text-sm text-center" style={{ color: MUTED }}>
          You'll be notified when your pass is running low or there are new updates.
        </p>
      </CardContent>
    </Card>
  );
}

export default function NotificationList({ actions }: { actions: Actions }) {
  const { notifications, isLoading, markRead, markUnread, remove } = actions;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
      </div>
    );
  }

  if (!notifications.length) return <NotificationEmpty />;

  return (
    <div className="space-y-3">
      {notifications.map((n) => {
        const config = TYPE_CONFIG[n.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.general;
        const Icon = config.icon;
        const busy = markRead.isPending || markUnread.isPending || remove.isPending;

        return (
          <Card
            key={n.id}
            className="border-0 shadow-sm transition-all py-0 gap-0"
            style={!n.read ? { borderLeft: `4px solid ${TEAL}` } : {}}
          >
            <CardContent className="p-4 flex items-start gap-3 sm:gap-4">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: config.bg }}>
                <Icon className="w-4 h-4" style={{ color: config.text }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <p className="font-semibold text-sm" style={{ color: NAVY }}>{n.title}</p>
                  <Badge className="text-xs" style={{ background: config.bg, color: config.text }}>{config.label}</Badge>
                  {!n.read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TEAL }} />}
                </div>
                <p className="text-sm" style={{ color: "oklch(0.35 0.04 240)" }}>{n.message}</p>
                <p className="text-xs mt-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                  {format(new Date(n.createdAt), "d MMM yyyy · h:mm a")}
                </p>

                {/* Under the message rather than beside it: on a phone there
                    is no room for two buttons in a row next to the text, and
                    a 24px icon squeezed into the corner is not something an
                    older member can hit reliably. */}
                <div className="flex items-center gap-1.5 mt-2 -ml-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 px-3 text-sm gap-1.5"
                    style={{ color: TEAL }}
                    disabled={busy}
                    onClick={() =>
                      n.read
                        ? markUnread.mutate({ notificationId: n.id })
                        : markRead.mutate({ notificationId: n.id })
                    }
                  >
                    {n.read
                      ? <><Mail className="w-4 h-4" /> Mark unread</>
                      : <><MailOpen className="w-4 h-4" /> Mark read</>}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 px-3 text-sm gap-1.5"
                    style={{ color: "oklch(0.55 0.18 25)" }}
                    disabled={busy}
                    aria-label={`Delete notification: ${n.title}`}
                    onClick={() => remove.mutate({ notificationId: n.id })}
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
