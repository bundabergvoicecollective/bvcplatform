/**
 * The number on the home-screen app icon.
 *
 * Only an installed app has an icon to badge, so on a normal browser tab every
 * call here does nothing — which is why nothing checks for installation: the
 * browser already knows, and asking would only be a second way to get it wrong.
 *
 * The API is not in lib.dom for every TypeScript version, so it is declared
 * rather than reached through `any`. Both calls return promises that reject on
 * platforms that half-support them, so both are caught: a badge is a nicety
 * and must never put an error in front of a member.
 */
type BadgingNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function isBadgingSupported(): boolean {
  return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

/** Shows `count` on the icon, or takes the badge off when it is zero. */
export function updateAppBadge(count: number): void {
  const nav = navigator as BadgingNavigator;
  try {
    if (count > 0) {
      void nav.setAppBadge?.(count).catch(() => {});
    } else {
      void nav.clearAppBadge?.().catch(() => {});
    }
  } catch {
    // Older Safari throws rather than rejecting. Nothing to do either way.
  }
}
