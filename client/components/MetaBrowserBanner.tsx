import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";

/**
 * Detects Meta in-app browsers (Facebook, Instagram, Messenger) on Android
 * and shows a prominent banner asking the user to open in Chrome.
 *
 * Meta's WebView has known bugs with virtual keyboard layout — the keyboard
 * overlaps fixed/sticky input bars and cannot be reliably fixed in CSS/JS.
 * The only reliable solution is to use a real browser.
 */
function isMetaInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Meta in-app browsers inject one of these tokens into the UA string
  return (
    ua.includes("FBAN") ||      // Facebook App
    ua.includes("FBAV") ||      // Facebook App (older)
    ua.includes("FBIOS") ||     // Facebook iOS
    ua.includes("Instagram") || // Instagram
    ua.includes("Messenger") || // Messenger
    ua.includes("FB_IAB") ||    // Facebook in-app browser
    ua.includes("FBDV")         // Facebook device
  );
}

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

export default function MetaBrowserBanner() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only show on Android Meta browsers — iOS handles keyboard differently
    if (isAndroid() && isMetaInAppBrowser()) {
      setShow(true);
    }
  }, []);

  if (!show || dismissed) return null;

  const currentUrl = window.location.href;

  const openInChrome = () => {
    // Android intent URL to force-open in Chrome
    // Falls back to a regular link if Chrome isn't installed
    const intentUrl = `intent://${currentUrl.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
    window.location.href = intentUrl;
  };

  return (
    <div
      className="fixed inset-x-0 top-0 z-[9999] flex items-start gap-3 p-4 shadow-lg"
      style={{
        background: "oklch(0.22 0.07 240)",
        borderBottom: "2px solid oklch(0.78 0.17 75)",
      }}
    >
      <ExternalLink
        className="w-5 h-5 shrink-0 mt-0.5"
        style={{ color: "oklch(0.78 0.17 75)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: "#f3f4f6" }}>
          For the best experience, open in Chrome
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
          This app doesn't work correctly inside Facebook or Messenger. Tap below to open in Chrome.
        </p>
        <button
          onClick={openInChrome}
          className="mt-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity active:opacity-70"
          style={{ background: "oklch(0.78 0.17 75)", color: "#0a0a0a" }}
        >
          Open in Chrome
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 p-1 rounded-md transition-opacity active:opacity-70"
        style={{ color: "#9ca3af" }}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
