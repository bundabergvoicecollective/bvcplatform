/**
 * Why did a member's online pass purchase fail?
 *
 * payments.createCheckout asks Square for a payment link and only then writes
 * a pending pass_order. So the presence of a row says which half broke:
 *
 *   no row at all      Square refused the link. Credentials, location, or
 *                      Square itself. The member saw an error immediately.
 *   a pending row      the link was made and the payment was not completed,
 *                      or it was completed and the webhook never arrived.
 *   a paid row         it worked; the complaint is about something else.
 *
 * It then asks Square directly whether our token and location are still
 * good, because "the secret is set" and "the secret works" are different
 * things and only one of them can be seen from the deploy log.
 *
 * Read-only by default: listing a location changes nothing. --probe also
 * creates one real payment link to prove the exact call works — no money
 * moves and nobody is charged, but it does make an order object in Square,
 * so it is off unless asked for.
 *
 * Amounts, statuses and dates only; members as ids and initials. Public log.
 *
 * Usage: DATABASE_URL=… SQUARE_ACCESS_TOKEN=… SQUARE_LOCATION_ID=… \
 *          tsx scripts/checkoutAudit.ts [--days=3] [--probe]
 */
import mysql from "mysql2/promise";
import { SquareClient, SquareEnvironment } from "square";

const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 3);
const PROBE = process.argv.includes("--probe");

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "?";
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const conn = await mysql.createConnection(url);
  const q = async <T>(sql: string, p: unknown[] = []): Promise<T> => (await conn.query(sql, p))[0] as T;

  // ── What the database saw ───────────────────────────────────────────────
  console.log(`Pass orders of every status in the last ${DAYS} day(s):\n`);
  const orders = await q<{
    id: number; d: string; status: string; method: string; channel: string | null;
    passType: string; cents: number; provider: string | null; ref: string | null;
    firstName: string | null; lastName: string | null; name: string | null;
  }[]>(
    `SELECT o.id,
            DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS d,
            o.status, o.paymentMethod AS method, o.paymentChannel AS channel,
            o.passType, o.amountCents AS cents, o.paymentProvider AS provider,
            o.paymentSessionId AS ref,
            u.firstName, u.lastName, u.name
       FROM pass_orders o LEFT JOIN users u ON u.id = o.userId
      WHERE o.createdAt >= DATE_SUB(now(), INTERVAL ? DAY)
      ORDER BY o.createdAt DESC`,
    [DAYS],
  );

  if (!orders.length) {
    console.log("  none at all — no order row was written, for any member, in that window.");
    console.log("  If a member tried to buy a pass, Square refused the link before we");
    console.log("  got as far as recording anything.\n");
  } else {
    for (const o of orders) {
      console.log(
        `  #${String(o.id).padEnd(8)} ${o.d}  ${o.status.padEnd(9)} ${o.passType.padEnd(16)}` +
        ` $${(Number(o.cents) / 100).toFixed(2).padStart(7)}  ${(o.channel ?? o.method).padEnd(13)}` +
        ` ${initials(o.firstName, o.lastName, o.name).padEnd(6)}${o.ref ? ` ref ${String(o.ref).slice(0, 12)}…` : " no square ref"}`,
      );
    }
    const pending = orders.filter((o) => o.status === "pending");
    if (pending.length) {
      console.log(`\n  ${pending.length} pending. The link was created and the payment never`);
      console.log("  completed — or it completed and the webhook never reached us.");
    }
    console.log("");
  }

  // Every pending order ever, because one stuck from tonight looks the same
  // as one stuck for a month until you count them.
  const allPending = await q<{
    id: number; d: string; passType: string; cents: number; ref: string | null;
    firstName: string | null; lastName: string | null; name: string | null;
  }[]>(
    `SELECT o.id, DATE_FORMAT(DATE_ADD(o.createdAt, INTERVAL 10 HOUR), '%Y-%m-%d %H:%i') AS d,
            o.passType, o.amountCents AS cents, o.stripeSessionId AS ref,
            u.firstName, u.lastName, u.name
       FROM pass_orders o LEFT JOIN users u ON u.id = o.userId
      WHERE o.status = 'pending'
      ORDER BY o.createdAt DESC`,
  );
  console.log(`Every pending order, newest first — ${allPending.length} in total:`);
  for (const o of allPending) {
    console.log(
      `  #${String(o.id).padEnd(8)} ${o.d}  ${o.passType.padEnd(16)} $${(Number(o.cents) / 100).toFixed(2).padStart(7)}` +
      `  ${initials(o.firstName, o.lastName, o.name).padEnd(6)}` +
      `${o.ref ? ` ref ${String(o.ref).slice(0, 14)}…` : "  NO SQUARE REF — sync cannot look this one up"}`,
    );
  }
  const noRef = allPending.filter((o) => !o.ref).length;
  if (noRef) {
    console.log(`\n  ${noRef} of them carry no Square reference. syncPendingOrders only`);
    console.log("  considers orders that have one, so those can never be resolved by Sync.");
  }
  console.log("");

  await conn.end();

  // ── What Square says ────────────────────────────────────────────────────
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
  const locationId = process.env.SQUARE_LOCATION_ID?.trim();
  if (!token || !locationId) {
    console.log("SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID is not set in this job — skipped.");
    process.exit(0);
  }

  const client = new SquareClient({
    token,
    environment:
      (process.env.SQUARE_ENVIRONMENT ?? "production") === "sandbox"
        ? SquareEnvironment.Sandbox
        : SquareEnvironment.Production,
  });

  let locationsOk = true;
  console.log(`Asking Square (${process.env.SQUARE_ENVIRONMENT || "production"}) whether our credentials still work:`);
  try {
    const res = await client.locations.get({ locationId });
    const loc = (res as { location?: { name?: string; status?: string; currency?: string; country?: string } }).location;
    console.log(`  ok    location ${locationId} — ${loc?.name ?? "(unnamed)"}, ${loc?.status ?? "?"}, ${loc?.currency ?? "?"} ${loc?.country ?? ""}`);
  } catch (err) {
    const e = err as { statusCode?: number; errors?: { code?: string; detail?: string }[]; message?: string };
    console.log(`  FAIL  Square refused: HTTP ${e.statusCode ?? "?"}`);
    for (const detail of e.errors ?? []) console.log(`        ${detail.code}: ${detail.detail}`);
    if (!e.errors?.length && e.message) console.log(`        ${e.message}`);
    console.log("\n  That call needs MERCHANT_PROFILE_READ. A token scoped only for");
    console.log("  checkout refuses it and still creates payment links perfectly well, so");
    console.log("  this alone does NOT prove purchases are broken. --probe settles it.");
    locationsOk = false;
  }

  if (!PROBE) {
    console.log(
      locationsOk
        ? "\n  Re-run with --probe to create one real payment link and prove the exact\n  call the checkout makes. No money moves."
        : "\n  Re-run with --probe to find out whether checkout itself still works.",
    );
    process.exit(locationsOk ? 0 : 1);
  }

  console.log("\nCreating one payment link, the same call the checkout makes:");
  try {
    const res = await client.checkout.paymentLinks.create({
      idempotencyKey: `audit-${Date.now()}`,
      quickPay: {
        name: "BVC 10-Session Pass",
        priceMoney: { amount: BigInt(14000), currency: "AUD" },
        locationId,
      },
      checkoutOptions: { redirectUrl: "https://members.bundabergvoicecollective.com.au/payments?success=1", askForShippingAddress: false },
      paymentNote: "audit probe — not a real purchase",
    });
    const link = (res as { paymentLink?: { url?: string; orderId?: string } }).paymentLink;
    if (link?.url) {
      console.log(`  ok    Square returned a link (order ${link.orderId}).`);
      console.log("        Nobody was charged. The link can be left to expire.");
      console.log(
        locationsOk
          ? "\n  Checkout works. A purchase failing is not Square refusing us."
          : "\n  Checkout works despite the 401 above, so the token is simply scoped\n" +
            "  for payments and not for reading the merchant profile. Purchases are\n" +
            "  NOT broken by that — look elsewhere for why one failed.",
      );
    } else {
      console.log("  FAIL  Square returned no link.");
      process.exit(1);
    }
  } catch (err) {
    const e = err as { statusCode?: number; errors?: { code?: string; detail?: string }[]; message?: string };
    console.log(`  FAIL  HTTP ${e.statusCode ?? "?"}`);
    for (const detail of e.errors ?? []) console.log(`        ${detail.code}: ${detail.detail}`);
    if (!e.errors?.length && e.message) console.log(`        ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
