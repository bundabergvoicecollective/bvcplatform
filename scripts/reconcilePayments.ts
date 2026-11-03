/**
 * The hourly safety net: activate passes the webhook missed.
 *
 * A pass is normally granted the moment Square posts payment.updated to
 * /api/square/webhook. That is one point of failure — a deploy, a cold start
 * that times out, a Cloudflare hiccup — and when it misses, the member has
 * paid, holds no pass, and nothing happens until somebody notices.
 *
 * This runs the same code the Sync button runs (reconcile.ts), on a schedule,
 * so a missed webhook heals itself within the hour instead of waiting to be
 * found.
 *
 * It never grants a pass on our own records alone: Square has to confirm the
 * order is paid. An order Square will not answer for is reported as
 * unreachable, never assumed either way.
 *
 * Exit codes matter here, because this runs unattended and a green tick that
 * means nothing is worse than a red one:
 *
 *   0  it ran, and either activated something or confirmed there was nothing
 *   1  Square would not answer — the run proved nothing and must not be
 *      mistaken for "all clear"
 *
 * Report-only unless --apply.
 *
 * Usage: DATABASE_URL=… SQUARE_ACCESS_TOKEN=… tsx scripts/reconcilePayments.ts [--apply]
 */
import { reconcilePendingOrders } from "../reconcile";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error("SQUARE_ACCESS_TOKEN is not set.");

  const r = await reconcilePendingOrders({ apply: APPLY, source: APPLY ? "Hourly reconcile" : "Reconcile (report)" });

  console.log(`${r.total} pending order(s) considered.`);
  if (r.notes.length) {
    console.log(APPLY ? "\nActivated:" : "\nWould activate:");
    for (const n of r.notes) console.log(`  ${n}`);
  }
  console.log(
    `\n  activated ${r.activated}` +
      `, not paid ${r.notPaid}` +
      `, no Square reference ${r.noReference}` +
      `, unreachable ${r.unreachable}`,
  );

  if (r.squareUnavailable) {
    console.log("\nSquare would not answer, so nothing was checked and nothing was changed.");
    console.log("This is almost always an expired SQUARE_ACCESS_TOKEN. Until it is replaced,");
    console.log("a member who pays online will not get their pass automatically.");
    process.exit(1);
  }

  if (r.noReference) {
    console.log(`\n${r.noReference} order(s) carry no Square reference and can never be resolved`);
    console.log("this way. They need recording by hand, or closing out with clearpending.");
  }

  if (!APPLY) console.log("\nReport only — nothing written. Pass --apply to activate.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Reconcile failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
