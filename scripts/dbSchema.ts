/**
 * Reconcile the live database with drizzle/schema.ts — additively, and without
 * ever asking a question.
 *
 * `drizzle-kit push` cannot be used unattended. On 6 Oct 2026 the deploy log
 * showed it reaching "Do you want to truncate invite_tokens table?" (99 rows),
 * failing on the absent TTY, and then *exiting 0*. Every deploy since the
 * schema gained its first unique constraint had therefore applied nothing while
 * reporting success, which is why `password_resets` did not exist and no
 * password reset email had ever sent.
 *
 * So this script does only what is safe to do without a human watching:
 *
 *   • creates tables that are missing
 *   • adds columns that are missing
 *   • adds a declared UNIQUE index only after proving the column holds no
 *     duplicates
 *
 * It never drops, truncates, renames or retypes anything. Anything it cannot do
 * safely it reports and leaves alone, and it exits non-zero if a statement
 * fails — the failure the old step swallowed.
 *
 * The expected shape is read from a `drizzle-kit generate` SQL file rather than
 * hand-maintained here, so drizzle/schema.ts stays the single source of truth.
 * That file is generated fresh into a temporary directory each time, never
 * committed: an empty out directory makes generate() emit the complete set of
 * CREATE TABLEs for the current schema, so it cannot drift.
 *
 *   rm -rf /tmp/bvc-schema-sql
 *   pnpm exec drizzle-kit generate --name=baseline --out=/tmp/bvc-schema-sql \
 *     --schema=./drizzle/schema.ts --dialect=mysql
 *   pnpm exec tsx scripts/dbSchema.ts --from=/tmp/bvc-schema-sql/0000_baseline.sql
 *
 * (--out on the CLI makes drizzle-kit ignore drizzle.config.ts, so --schema and
 * --dialect have to be repeated there.)
 *
 * Add --apply to execute. Without it the script only reports, so it is safe to
 * point at production at any time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import mysql from "mysql2/promise";
import { parseBaseline } from "./schemaSql";

const APPLY = process.argv.includes("--apply");
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(
  HERE,
  "..",
  process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length) ??
    "drizzle/migrations/0000_baseline.sql",
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const tables = parseBaseline(readFileSync(BASELINE, "utf8"));
  const conn = await mysql.createConnection(url);

  const query = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
    (await conn.query(sql, params))[0] as T;

  const [server] = await query<{ db: string; version: string }[]>(
    "SELECT DATABASE() AS db, VERSION() AS version",
  );
  // Everything below is scoped to DATABASE(), so a URL with no database on the
  // path would quietly compare the schema against nothing and declare every
  // table missing.
  if (!server.db) throw new Error("DATABASE_URL names no database, so there is nothing to compare.");
  console.log(`Connected to \`${server.db}\` (${server.version})`);
  console.log(`Mode: ${APPLY ? "APPLY — statements will be executed" : "report only"}\n`);

  const live = await query<{ TABLE_NAME: string }[]>(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  const liveTables = new Set(live.map((r) => r.TABLE_NAME));

  const planned: string[] = [];
  const skipped: string[] = [];

  for (const table of tables) {
    if (!liveTables.has(table.name)) {
      console.log(`MISSING TABLE  ${table.name} — will be created`);
      planned.push(table.createSql);
      continue;
    }

    const liveColumns = await query<{ COLUMN_NAME: string }[]>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [table.name],
    );
    const have = new Set(liveColumns.map((r) => r.COLUMN_NAME));
    for (const [column, definition] of table.columns) {
      if (have.has(column)) continue;
      console.log(`MISSING COLUMN ${table.name}.${column} — will be added`);
      planned.push(`ALTER TABLE \`${table.name}\` ADD COLUMN ${definition}`);
    }

    // A UNIQUE index is the one thing push refused to decide on its own, and it
    // was right to: adding it to a column holding duplicates fails, and the
    // remedy it offered was to empty the table. Check the data instead.
    for (const unique of table.uniques) {
      if (!have.has(unique.column)) continue; // the ADD COLUMN above covers it

      const [index] = await query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND NON_UNIQUE = 0`,
        [table.name, unique.column],
      );
      if (index.n > 0) continue;

      const [dupes] = await query<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM (
           SELECT \`${unique.column}\` FROM \`${table.name}\`
           WHERE \`${unique.column}\` IS NOT NULL
           GROUP BY \`${unique.column}\` HAVING COUNT(*) > 1
         ) d`,
      );
      if (dupes.n > 0) {
        const note = `${table.name}.${unique.column}: ${dupes.n} duplicated value(s), so UNIQUE cannot be added. Left as it is — the duplicates have to be resolved by hand first.`;
        console.log(`SKIPPED        ${note}`);
        skipped.push(note);
        continue;
      }
      console.log(`MISSING UNIQUE ${table.name}.${unique.column} — no duplicates, will be added`);
      planned.push(
        `ALTER TABLE \`${table.name}\` ADD CONSTRAINT \`${unique.name}\` UNIQUE (\`${unique.column}\`)`,
      );
    }
  }

  // Tables the database has and the schema does not. Reported, never touched.
  const extra = [...liveTables].filter((t) => !tables.some((s) => s.name === t)).sort();
  if (extra.length) console.log(`\nNot in the schema (left alone): ${extra.join(", ")}`);

  if (!planned.length) {
    console.log("\nNothing to do — the database matches the schema.");
  } else if (!APPLY) {
    console.log(`\n${planned.length} statement(s) would run. Re-run with --apply to execute:\n`);
    for (const sql of planned) console.log(`${sql};\n`);
  } else {
    console.log(`\nApplying ${planned.length} statement(s)…`);
    for (const sql of planned) {
      await conn.query(sql);
      console.log(`  ok  ${sql.split("\n")[0].slice(0, 90)}`);
    }
    console.log("Done.");
  }

  await conn.end();

  if (skipped.length) {
    console.log("\nNeeds a human:");
    for (const note of skipped) console.log(`  • ${note}`);
  }
}

main().catch((err) => {
  // The old step's failure mode was a readable error and a zero exit status.
  console.error("\nSchema reconcile FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
