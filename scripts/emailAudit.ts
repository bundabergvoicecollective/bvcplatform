/**
 * Read-only audit of how member email addresses are stored.
 *
 * The same questions /api/admin/email-check?emails=1 answers, run from CI so
 * they can be answered without a browser — the cloud container this repo's
 * sessions run in cannot reach the deployed site.
 *
 * Every lookup by email used to compare exactly, against a lowercased and
 * trimmed input, so an address imported from Manus as "Mclucas.Andy@gmail.com"
 * would not have matched: that member could not sign in, could not get a reset
 * link, and the duplicate checks in registration and admin member-creation
 * missed them, so a second account could be created on the same real address.
 * The lookups now normalise both sides. This reports whether any of it actually
 * happened, and whether any duplicate rows were left behind.
 *
 * It only SELECTs. Nothing here writes.
 *
 * Addresses are masked, because GitHub Actions logs are visible to everyone
 * with read access to the repository and these are members' personal details.
 * The row ids are not masked — they are what you look the member up by.
 *
 * Usage: DATABASE_URL=... tsx scripts/emailAudit.ts
 */
import mysql from "mysql2/promise";

/** andy@gmail.com → a**y@gmail.com. Enough to recognise, not to harvest. */
function mask(address: string | null): string {
  if (!address) return "(none)";
  const at = address.lastIndexOf("@");
  if (at < 1) return "(malformed)";
  const local = address.slice(0, at);
  const domain = address.slice(at);
  if (local.length <= 2) return `${local[0]}*${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local.at(-1)}${domain}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const conn = await mysql.createConnection(url);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  const [server] = await query<{ db: string; version: string }[]>(
    "SELECT DATABASE() AS db, VERSION() AS version",
  );
  console.log(`Connected to \`${server.db}\` (${server.version})\n`);

  const [collation] = await query<{ collation: string | null }[]>(
    `SELECT collation_name AS collation FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'email'`,
  );

  // Whether comparisons on this column ignore case, asked rather than assumed
  // from which engine this is. Comparing the column against an expression
  // derived from it settles it, because the column's own collation governs —
  // a bare 'a' = 'A' would only reveal the connection's.
  //
  //   equalsOwnUppercase  under a _ci collation this is true for every row;
  //                       under a binary one only for rows holding no lowercase
  //   hasLowercase        the same question byte-wise via CAST AS BINARY, so it
  //                       is true regardless of collation. (UPPER of a binary
  //                       string is a no-op, so the cast goes outside it.)
  const [counts] = await query<
    {
      total: number;
      missing: number | null;
      nonEmpty: number | null;
      notNormalised: number | null;
      equalsOwnUppercase: number | null;
      hasLowercase: number | null;
    }[]
  >(
    `SELECT count(*) AS total,
            sum(email IS NULL OR email = '') AS missing,
            sum(email IS NOT NULL AND email <> '') AS nonEmpty,
            sum(email IS NOT NULL AND email <> lower(trim(email))) AS notNormalised,
            sum(email IS NOT NULL AND email <> '' AND email = upper(email)) AS equalsOwnUppercase,
            sum(email IS NOT NULL AND email <> ''
                AND cast(email AS binary) <> cast(upper(email) AS binary)) AS hasLowercase
       FROM users`,
  );

  const total = Number(counts?.total ?? 0);
  const nonEmpty = Number(counts?.nonEmpty ?? 0);
  const notNormalised = Number(counts?.notNormalised ?? 0);
  const withLowercase = Number(counts?.hasLowercase ?? 0);
  const matchedUpper = Number(counts?.equalsOwnUppercase ?? 0);

  console.log(`users.email collation : ${collation?.collation ?? "(unknown)"}`);
  console.log(
    `comparisons ignore case: ${
      withLowercase > 0
        ? matchedUpper === nonEmpty
          ? "yes"
          : "NO — this column compares case-sensitively"
        : "cannot tell (no stored address holds a lowercase letter)"
    }`,
  );
  console.log(`members                : ${total}`);
  console.log(`  without an address   : ${Number(counts?.missing ?? 0)}`);
  console.log(`  not lowercase+trimmed: ${notNormalised}\n`);

  if (notNormalised > 0) {
    const rows = await query<{ id: number; email: string; status: string }[]>(
      `SELECT id, email, status FROM users
        WHERE email IS NOT NULL AND email <> lower(trim(email))
        ORDER BY id LIMIT 200`,
    );
    console.log("Stored unnormalised:");
    for (const r of rows) console.log(`  #${r.id}  ${mask(r.email)}  (${r.status})`);
    console.log();
  }

  // Two member rows on one real address. The duplicate checks compared exactly
  // before the fix, so registering again under a different casing would have
  // made a second account — and passes and attendance stay on whichever row
  // they were written to.
  const duplicates = await query<{ address: string; n: number; ids: string }[]>(
    `SELECT lower(trim(email)) AS address, count(*) AS n,
            group_concat(id ORDER BY id) AS ids
       FROM users
      WHERE email IS NOT NULL AND email <> ''
      GROUP BY lower(trim(email))
     HAVING count(*) > 1
      ORDER BY n DESC`,
  );

  if (!duplicates.length) {
    console.log("Duplicate addresses    : none — every member row has its own address.");
  } else {
    console.log(`Duplicate addresses    : ${duplicates.length} — ACT ON THESE`);
    for (const d of duplicates) {
      console.log(`  ${mask(d.address)}  held by ${d.n} rows: ids ${d.ids}`);
    }
    console.log(
      "\n  These split one person's passes and attendance across two records.\n" +
        "  Merging is a judgement call about whose history is whose, so nothing\n" +
        "  here changes them. Look each id up in the admin Members page.",
    );
  }

  await conn.end();
}

main().catch((err) => {
  console.error("\nEmail audit FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
