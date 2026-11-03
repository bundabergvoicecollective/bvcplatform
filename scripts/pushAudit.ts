/**
 * Has anyone actually got notifications working?
 *
 * Everything about Web Push is invisible from the outside. The code can be
 * perfect, the VAPID keys present, the service worker registered — and if no
 * member ever completed the opt-in, not one notification will ever arrive and
 * nothing anywhere will say so. The subscription count is the only honest
 * measure of whether this feature exists for the people it is for.
 *
 * The endpoint host tells us the platform without storing anything about the
 * device: Apple's push service means an iPhone or iPad added to a Home
 * Screen, because Safari allows no other kind. Google's means Android or
 * desktop Chrome. If the Apple count is zero, the iOS instructions are not
 * working, whatever the code does.
 *
 * --send --user=<id> posts one real notification to that member and nobody
 * else, which is the only way to prove the chain end to end: our key, their
 * subscription, their platform's push service, their handset, the service
 * worker, the badge.
 *
 * Read-only without --send. Member ids and initials only; endpoints are
 * secrets in their own right — anyone holding one can push to that device —
 * so only the host is ever printed.
 *
 * Usage: DATABASE_URL=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… \
 *          tsx scripts/pushAudit.ts [--send --user=123]
 */
import mysql from "mysql2/promise";
import webpush from "web-push";

const SEND = process.argv.includes("--send");
const USER = process.argv.find((a) => a.startsWith("--user="))?.slice(7);

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
};

/** Apple, Google, Mozilla or other — from the endpoint host alone. */
function service(endpoint: string): string {
  try {
    const host = new URL(endpoint).host;
    if (host.endsWith("push.apple.com")) return "Apple (iPhone/iPad, Home Screen)";
    if (host.includes("googleapis.com") || host.includes("google.com")) return "Google (Android/Chrome)";
    if (host.includes("mozilla")) return "Mozilla (Firefox)";
    if (host.includes("windows.com") || host.includes("microsoft")) return "Microsoft (Edge)";
    return host;
  } catch {
    return "(unreadable endpoint)";
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  const subs = await q<{
    id: number; userId: number; endpoint: string; p256dh: string; auth: string;
    d: string; firstName: string | null; lastName: string | null; name: string | null;
  }[]>(
    `SELECT s.id, s.userId, s.endpoint, s.p256dh, s.auth,
            DATE_FORMAT(DATE_ADD(s.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS d,
            u.firstName, u.lastName, u.name
       FROM push_subscriptions s LEFT JOIN users u ON u.id = s.userId
      ORDER BY s.createdAt DESC`,
  );

  const [members] = await q<{ n: number }[]>("SELECT count(*) AS n FROM users WHERE status = 'active'");

  console.log(`${subs.length} push subscription(s) across ${new Set(subs.map((s) => s.userId)).size} member(s), of ${members.n} active.\n`);

  if (!subs.length) {
    console.log("Nobody is subscribed, so no notification can reach anyone — whatever");
    console.log("the code does. The opt-in is the thing to fix, not the sending.\n");
    console.log("On an iPhone the app must be opened from the Home Screen icon before");
    console.log("Safari will even offer the permission prompt; in a browser tab the");
    console.log("button cannot appear at all.");
  } else {
    const byService = new Map<string, number>();
    for (const s of subs) byService.set(service(s.endpoint), (byService.get(service(s.endpoint)) ?? 0) + 1);
    for (const [name, n] of [...byService].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${name}`);
    }
    console.log("");
    for (const s of subs) {
      console.log(`  #${String(s.userId).padEnd(8)} ${initials(s.firstName, s.lastName, s.name).padEnd(6)} subscribed ${s.d}  ${service(s.endpoint)}`);
    }
    const apple = subs.filter((s) => service(s.endpoint).startsWith("Apple")).length;
    if (!apple) {
      console.log("\n  No Apple subscriptions. Either no iPhone member has completed the");
      console.log("  Home Screen steps, or something in those steps does not work.");
    }
  }

  if (!SEND) {
    await conn.end();
    console.log("\nRead-only. Pass --send --user=<id> to post one real notification.");
    process.exit(0);
  }

  if (!USER) throw new Error("--send needs --user=<id>, so it goes to one person and not the choir.");
  const mine = subs.filter((s) => s.userId === Number(USER));
  if (!mine.length) {
    console.log(`\nMember #${USER} has no subscription — there is nothing to send to.`);
    await conn.end();
    process.exit(1);
  }

  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must both be set.");
  webpush.setVapidDetails(`mailto:${process.env.VAPID_EMAIL ?? "admin@bundabergvoicecollective.com.au"}`, pub, priv);

  console.log(`\nSending one notification to member #${USER} (${mine.length} device(s)):`);
  const payload = JSON.stringify({
    title: "BVC test notification",
    body: "If you can read this, notifications are working. Nothing to do.",
    url: "/notifications",
  });

  let delivered = 0;
  for (const s of mine) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      delivered++;
      console.log(`  ok    ${service(s.endpoint)}`);
    } catch (err) {
      const e = err as { statusCode?: number; body?: string };
      console.log(`  FAIL  ${service(s.endpoint)} — HTTP ${e.statusCode ?? "?"} ${String(e.body ?? "").slice(0, 120)}`);
      // 410 Gone means the device threw the subscription away: the app was
      // deleted, or permission was revoked. Worth saying, not worth deleting
      // from a read-mostly audit.
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.log("        That device has discarded the subscription. They need to turn it on again.");
      }
    }
  }

  console.log(`\n${delivered} of ${mine.length} accepted by the push service.`);
  console.log("Accepted means their platform took it, not that the handset showed it.");
  console.log("Only the person holding the phone can confirm the last step.");

  await conn.end();
  process.exit(delivered ? 0 : 1);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
