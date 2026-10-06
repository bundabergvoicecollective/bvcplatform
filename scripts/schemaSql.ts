/**
 * Reads a `drizzle-kit generate` SQL file into table definitions.
 *
 * Kept apart from dbSchema.ts so it can be exercised without a database (and
 * without an entrypoint guard on the script that would risk a silent no-op —
 * the exact failure being fixed here).
 */

export type Unique = { name: string; column: string };

export type Table = {
  name: string;
  createSql: string;
  /** column name → its definition as generate() wrote it, trailing comma stripped */
  columns: Map<string, string>;
  uniques: Unique[];
};

/**
 * generate() writes one CREATE TABLE per statement, one column per line, with
 * table-level constraints as trailing CONSTRAINT lines:
 *
 *   CREATE TABLE `password_resets` (
 *     `id` int AUTO_INCREMENT NOT NULL,
 *     `usedAt` timestamp,
 *     CONSTRAINT `password_resets_id` PRIMARY KEY(`id`),
 *     CONSTRAINT `password_resets_tokenHash_unique` UNIQUE(`tokenHash`)
 *   );
 */
export function parseBaseline(sql: string): Table[] {
  const tables: Table[] = [];
  for (const chunk of sql.split("--> statement-breakpoint")) {
    const body = chunk.trim();
    if (!body.startsWith("CREATE TABLE")) continue;

    const name = body.match(/^CREATE TABLE `([^`]+)`/)?.[1];
    if (!name) throw new Error(`Could not read a table name from:\n${body.slice(0, 120)}`);

    const columns = new Map<string, string>();
    const uniques: Unique[] = [];
    for (const raw of body.split("\n").slice(1)) {
      const line = raw.trim().replace(/,$/, "");
      const column = line.match(/^`([^`]+)` (.+)$/);
      if (column) {
        columns.set(column[1]!, line);
        continue;
      }
      const unique = line.match(/^CONSTRAINT `([^`]+)` UNIQUE\(`([^`]+)`\)$/);
      if (unique) uniques.push({ name: unique[1]!, column: unique[2]! });
    }

    if (!columns.size) throw new Error(`Parsed no columns out of \`${name}\`.`);
    tables.push({ name, createSql: body.replace(/;$/, ""), columns, uniques });
  }

  if (!tables.length) throw new Error("Parsed no tables — is this a drizzle-kit generate file?");
  return tables;
}
