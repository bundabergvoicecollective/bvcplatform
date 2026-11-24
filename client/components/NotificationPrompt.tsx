import { useState } from "react";
import { Bell, BellOff, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications, howToUnblock } from "@/hooks/usePushNotifications";

/**
 * The one tap that cannot be done for them.
 *
 * No site can turn notifications on for somebody: the permission dialog has
 * to come from a tap by the person holding the phone, and no update, server
 * or service worker can grant it. So the only lever is where the tap lives,
 * and until now it lived on a page with no route — which is why nobody in a
 * choir of seventy-four had ever enabled it.
 *
 * It sits above every page, for anyone signed in who has not turned it on.
 *
 * Dismissible, because a banner that cannot be closed is one people learn to
 * scroll past and resent. It comes back in a week: one tap is worth asking
 * for more than once, and not worth asking for daily.
 *
 * Three states, because the right thing to say depends entirely on why they
 * cannot be notified:
 *
 *   iPhone, not installed   Safari offers no push in a tab at all, so there
 *                           is no button to press. Show the way in instead.
 *   blocked                 The browser will never prompt again. A button
 *                           would do nothing, so say where the setting is.
 *   otherwise               One button.
 */

const DISMISSED_KEY = "bvc:notif-prompt-dismissed";
const ASK_AGAIN_AFTER_DAYS = 7;

function dismissedRecently(): boolean {
  try {
    const at = localStorage.getItem(DISMISSED_KEY);
    if (!at) return false;
    const days = (Date.now() - new Date(at).getTime()) / 86_400_000;
    return days < ASK_AGAIN_AFTER_DAYS;
  } catch {
    // Private browsing, or storage blocked. Asking again is the safer error.
    return false;
  }
}

export default function NotificationPrompt() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(dismissedRecently);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    } catch {
      // Not being able to remember the dismissal only means it returns sooner.
    }
    setDismissed(true);
  };

  if (dismissed || push.subscribed) return null;
  // A browser with no push at all, and not an iPhone that merely needs
  // installing first: there is nothing to offer.
  if (!push.supported && !push.needsInstall) return null;

  const blocked = push.permission === "denied";

  return (
    // A card inside the page rather than a slab across the top of it: same
    // words, same buttons, but it reads as a prompt from the app instead of a
    // warning bolted on above it.
    <div
      className="mx-4 mt-4 sm:mx-6 sm:mt-6 flex items-start gap-3 px-4 py-3.5 rounded-2xl border [box-shadow:var(--shadow-card)] animate-fade-in"
      style={{
        background: blocked ? "oklch(0.975 0.012 240)" : "oklch(0.97 0.035 80)",
        borderColor: blocked ? "oklch(0.91 0.015 240)" : "oklch(0.89 0.06 78)",
      }}
    >
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: blocked ? "oklch(0.55 0.03 240)" : "oklch(0.55 0.14 185)" }}
      >
        {blocked ? <BellOff className="w-4 h-4 text-white" /> : <Bell className="w-4 h-4 text-white" />}
      </div>

      <div className="min-w-0 flex-1">
        {push.needsInstall ? (
          <>
            <p className="text-sm font-semibold" style={{ color: "oklch(0.25 0.05 240)" }}>
              Add BVC to your Home Screen to get notifications
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: "oklch(0.40 0.04 240)" }}>
              On an iPhone or iPad, Apple only allows notifications once the app is
              saved to your Home Screen. Tap{" "}
              <Share className="w-3 h-3 inline -mt-0.5" /> <strong>Share</strong> at the
              bottom of Safari, then <strong>Add to Home Screen</strong>, then{" "}
              <strong>Add</strong>. Open BVC from the new icon and this will offer a
              Turn on button.
            </p>
          </>
        ) : blocked ? (
          <>
            <p className="text-sm font-semibold" style={{ color: "oklch(0.25 0.05 240)" }}>
              Notifications are blocked for this app
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: "oklch(0.40 0.04 240)" }}>
              {/* These steps used to be the iPhone ones for everybody, so
                  every Android member was told to open an iOS settings screen
                  that does not exist on their phone. */}
              Your phone was told no at some point, and it will not ask again.{" "}
              {howToUnblock()}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: "oklch(0.25 0.05 240)" }}>
              Turn on notifications
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: "oklch(0.40 0.04 240)" }}>
              Get told about rehearsal changes, new music and announcements — even when
              the app is closed. One tap, and you can turn it off again any time.
            </p>
            <Button
              size="sm"
              className="mt-2 font-semibold"
              disabled={push.loading}
              onClick={push.subscribe}
              style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            >
              {push.loading ? "Turning on…" : "Turn on notifications"}
            </Button>
          </>
        )}
      </div>

      <button
        onClick={dismiss}
        aria-label="Not now"
        className="shrink-0 -mr-1 -mt-1 size-9 rounded-full flex items-center justify-center hover:bg-black/5"
        style={{ color: "oklch(0.50 0.03 240)" }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
