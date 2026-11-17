/**
 * Read-only: who would the "pass has run out" email go to right now?
 *
 * Calls the same getMultipassEmptyAudience() the Email tab uses, so this is
 * the real list, not a reimplementation of the rule. Run it before a first
 * campaign to see who is in and why, and to check nobody is there who only
 * ever pays by the session.
 *
 * Member ids and initials only — the Actions log is public. No addresses.
 *
 * db.ts opens a connection pool at import, which keeps the process alive, so
 * every path out exits explicitly.
 *
 * Usage: DATABASE_URL=… tsx scripts/campaignAudience.ts
 */
import { getMultipassEmptyAudience } from "../db";

const initials = (first: string | null, last: string | null, name: string | null) => {
  const parts = [first, last].filter(Boolean) as string[];
  const src = parts.length ? parts : (name ?? "").split(/\s+/).filter(Boolean);
  return src.map((p) => `${p[0].toUpperCase()}.`).join("") || "—";
};

async function main() {
  const rows = await getMultipassEmptyAudience();
  const reachable = rows.filter((r) => !r.optedOut);
  console.log(`${reachable.length} member(s) would get the email; ${rows.length - reachable.length} unsubscribed.\n`);
  for (const r of rows) {
    const why = r.boughtMulti > 0 ? `bought a multi-pass (${r.boughtMulti} order(s))` : `held a ${r.biggestPass}-session pass, no order`;
    console.log(
      `  #${String(r.id).padEnd(8)} ${initials(r.firstName, r.lastName, r.name).padEnd(7)} ${why}` +
        `${r.lastPassAt ? ` · last pass ${r.lastPassAt}` : ""}` +
        `${r.lastEmailedAt ? ` · emailed ${r.lastEmailedAt}` : ""}` +
        `${r.optedOut ? "  UNSUBSCRIBED" : ""}`,
    );
  }
  const noOrder = rows.filter((r) => r.boughtMulti === 0).length;
  if (noOrder) {
    console.log(`\n${noOrder} are in because they held a pass of 5+ sessions with no order behind it —`);
    console.log("passes assigned by hand, or paper cards carried over. Untick any who shouldn't be.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
