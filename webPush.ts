/**
 * Web Push notifications using the `web-push` library.
 * Stores subscriptions in the push_subscriptions table.
 */
import webpush from "web-push";
import { db } from "./db";
import { pushSubscriptions } from "./drizzle/schema";
import { eq, inArray, type SQL } from "drizzle-orm";
import { ENV } from "./_core/env";

// Configure VAPID keys if set
if (ENV.vapidPublicKey && ENV.vapidPrivateKey) {
  webpush.setVapidDetails(
    `mailto:${ENV.vapidEmail}`,
    ENV.vapidPublicKey,
    ENV.vapidPrivateKey,
  );
}

type SubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function savePushSubscription(
  userId: number,
  sub: SubscriptionInput,
): Promise<void> {
  // Upsert: if the endpoint exists update keys, else insert
  const [existing] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, sub.endpoint))
    .limit(1);

  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh: sub.keys.p256dh, auth: sub.keys.auth, userId })
      .where(eq(pushSubscriptions.endpoint, sub.endpoint));
  } else {
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    });
  }
}

export async function deletePushSubscription(
  _userId: number,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

/**
 * What a push attempt actually did.
 *
 * deliver() used to return nothing, so every caller could say "sent" and
 * none could say whether anything left the building. That is the house
 * failure: a step that reports success and does nothing. Nobody in a choir
 * of seventy-four had notifications working for weeks and no screen said so.
 *
 * `accepted` is the push service taking the message, which is the furthest
 * any server can see — whether the handset then showed it is between the
 * phone and the person holding it.
 */
export type PushResult = {
  /** Subscriptions we tried. One person can have several devices. */
  devices: number;
  /** Distinct members behind those devices. */
  members: number;
  accepted: number;
  failed: number;
  /** Subscriptions the platform said are dead (410/404), now deleted. */
  removed: number;
  /** Why nothing was attempted, when devices is 0. */
  reason?: "no-vapid-keys" | "nobody-subscribed";
};

/**
 * Push to specific members.
 *
 * sendPushToAll could not do this, so the one thing it was wired to —
 * announcements — notified the admin who had just written it, on their own
 * phone, a second after they pressed the button. Anything that excludes its
 * author has to be able to say who it is for.
 *
 * An empty list sends nothing rather than everything: a targeting bug should
 * be silence, never a broadcast to seventy people.
 */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<PushResult> {
  if (!userIds.length) return { devices: 0, members: 0, accepted: 0, failed: 0, removed: 0, reason: "nobody-subscribed" };
  return deliver(payload, inArray(pushSubscriptions.userId, userIds));
}

export async function sendPushToAll(payload: PushPayload): Promise<PushResult> {
  return deliver(payload, undefined);
}

/** How many devices a push to everyone would reach, without sending one. */
export async function countPushSubscriptions(): Promise<{ devices: number; members: number }> {
  const rows = await db.select({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  return { devices: rows.length, members: new Set(rows.map((r) => r.userId)).size };
}

async function deliver(payload: PushPayload, where: SQL | undefined): Promise<PushResult> {
  const empty = { devices: 0, members: 0, accepted: 0, failed: 0, removed: 0 };
  if (!ENV.vapidPublicKey || !ENV.vapidPrivateKey) {
    console.warn("[WebPush] VAPID keys not configured — skipping push");
    return { ...empty, reason: "no-vapid-keys" };
  }

  const subs = where
    ? await db.select().from(pushSubscriptions).where(where)
    : await db.select().from(pushSubscriptions);
  if (!subs.length) return { ...empty, reason: "nobody-subscribed" };
  const json = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        json,
      ),
    ),
  );

  const accepted = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[WebPush] ${accepted}/${subs.length} accepted — ${JSON.stringify(payload.title)}`);

  // Remove subscriptions that are no longer valid (410 Gone)
  let removed = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const err = result.reason as { statusCode?: number; body?: string };
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subs[i].endpoint));
        removed++;
      } else {
        // Anything else is ours to look at: a bad key, a rejected VAPID
        // claim, the push service refusing us. Silence here is how a broken
        // integration passes for a quiet one.
        console.error(
          `[WebPush] refused by ${new URL(subs[i].endpoint).host}:`,
          err?.statusCode ?? "?",
          String(err?.body ?? "").slice(0, 200),
        );
      }
    }
  }

  return {
    devices: subs.length,
    members: new Set(subs.map((s) => s.userId)).size,
    accepted,
    failed: subs.length - accepted,
    removed,
  };
}
