/**
 * Shared constants used by both client and server.
 */

/**
 * Name of the session cookie set by the auth routes.
 * Must be "__session": Firebase Hosting (used for the custom domain in front of
 * Cloud Run) strips every other cookie before forwarding requests.
 */
export const COOKIE_NAME = "__session";

// Error messages used by tRPC middleware and client
export const UNAUTHED_ERR_MSG = "You must be signed in to do that.";
export const PENDING_ERR_MSG = "Your account is pending admin approval.";
export const DENIED_ERR_MSG = "Your account access has been denied.";
export const NOT_ADMIN_ERR_MSG = "Admin access required.";

/** App name shown in the UI. */
export const APP_NAME = "Bundaberg Voice Collective";

/**
 * Return a human-readable display name for a member.
 * Falls back through: "First Last" → name field → email → fallback string.
 */
export function getDisplayName(
  member: {
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    email?: string | null;
  },
  fallback = "Member",
): string {
  const parts = [member.firstName, member.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (member.name) return member.name;
  if (member.email) return member.email;
  return fallback;
}
