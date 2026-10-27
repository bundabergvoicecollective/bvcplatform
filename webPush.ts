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
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  if (!userIds.length) return;
  await deliver(payload, inArray(pushSubscriptions.userId, userIds));
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  await deliver(payload, undefined);
}

async function deliver(payload: PushPayload, where: SQL | undefined): Promise<void> {
  if (!ENV.vapidPublicKey || !ENV.vapidPrivateKey) {
    console.warn("[WebPush] VAPID keys not configured — skipping push");
    return;
  }

  const subs = where
    ? await db.select().from(pushSubscriptions).where(where)
    : await db.select().from(pushSubscriptions);
  if (!subs.length) return;
  const json = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subs.map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        json,
      ),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  console.log(`[WebPush] ${sent}/${subs.length} delivered — ${JSON.stringify(payload.title)}`);

  // Remove subscriptions that are no longer valid (410 Gone)
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const err = result.reason as { statusCode?: number };
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.endpoint, subs[i].endpoint));
      }
    }
  }
}
