/**
 * Copies the files the 29 September migration left behind.
 *
 * That import brought the rows across and not the objects they point at, so
 * every library item, gallery photo, document, performance image and member
 * avatar on the new site is a row whose file is still sitting in Manus's
 * storage. scripts/mediaAudit.ts is how that was established: 126 of 127
 * keys are absent from our bucket.
 *
 * The rows already carry the key. Manus serves the same key at
 * /manus-storage/<key> on its own host, so this fetches each one from there
 * and puts it into our bucket under the identical key — which is what
 * server/storageProxy.ts already looks for. Nothing in the database changes;
 * the paths that are there today start working.
 *
 * Reports by default. Writes only with --apply, and only ever writes objects
 * that are not already in the bucket, so re-running it after a partial run
 * picks up where it stopped.
 *
 * This cannot run in the Claude container — the network policy refuses the
 * Manus host. It runs in Actions, where the runner has open internet and the
 * R2 secrets are available.
 *
 * Manus does not serve all of it the same way. Avatars, performance images
 * and documents come back to anyone who asks; library and gallery answer 403
 * without a session, which is Manus being careful about member-only material
 * rather than anything being wrong. For those, put a signed-in Manus cookie
 * header in the MANUS_COOKIE secret. A run that is only short of a cookie
 * says so and still succeeds — it has copied everything it could.
 *
 * Usage:
 *   DATABASE_URL=... R2_* =... MANUS_HOST=https://…manus.space \
 *     tsx scripts/mediaBackfill.ts [--apply] [--only=library_items]
 */
import mysql from "mysql2/promise";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

/** table → URL column, key column (null = the key is inside the URL), label */
const MEDIA: [table: string, urlColumn: string, keyColumn: string | null, label: string][] = [
  ["users", "avatarUrl", null, "member avatars"],
  ["library_items", "fileUrl", "fileKey", "library items"],
  ["gallery_posts", "imageUrl", "imageKey", "gallery posts"],
  ["gallery_media", "mediaUrl", "mediaKey", "gallery media"],
  ["events", "imageUrl", "imageKey", "performances (images)"],
  ["rehearsal_recordings", "fileUrl", "fileKey", "rehearsal recordings"],
  ["documents", "fileUrl", "fileKey", "documents"],
];

function keyFromUrl(url: string | null, storedKey: string | null): string | null {
  if (storedKey) return storedKey;
  if (!url) return null;
  const m = /^\/(?:manus-storage|r2-storage)\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** A key is a file path and this log is public, so only its shape is printed. */
function shape(key: string): string {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const ext = dot > slash ? key.slice(dot) : "";
  return `${key.slice(0, slash + 1)}…${ext}`;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set.");

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not set — nothing can be read from or written to the bucket.");
  }
  const bucket = process.env.R2_BUCKET_NAME ?? "bvc-storage";

  const host = (process.env.MANUS_HOST ?? "").replace(/\/+$/, "");
  if (!host) throw new Error("MANUS_HOST is not set — there is nowhere to fetch the files from.");
  const cookie = process.env.MANUS_COOKIE ?? "";

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const conn = await mysql.createConnection(dbUrl);
  const query = async <T>(sql: string): Promise<T> => (await conn.query(sql))[0] as T;

  console.log(APPLY ? "APPLYING — files will be written to the bucket.\n" : "Dry run. Nothing will be written.\n");
  console.log(`Source: ${host}/manus-storage/<key>${cookie ? "  (with the MANUS_COOKIE session)" : "  (no cookie)"}`);
  console.log(`Target: bucket \`${bucket}\`, same key\n`);

  let totalMissing = 0;
  let totalCopied = 0;
  let totalFailed = 0;
  let totalNeedsAuth = 0;
  const failures: string[] = [];
  const needsAuthIn = new Set<string>();

  for (const [table, urlCol, keyCol, label] of MEDIA) {
    if (ONLY && ONLY !== table) continue;

    let rows: { u: string | null; k: string | null }[];
    try {
      rows = await query<{ u: string | null; k: string | null }[]>(
        `SELECT \`${urlCol}\` AS u, ${keyCol ? `\`${keyCol}\`` : "NULL"} AS k FROM \`${table}\`
          WHERE \`${urlCol}\` IS NOT NULL AND \`${urlCol}\` <> ''`,
      );
    } catch (err) {
      console.log(`${label}: could not read (${(err as Error).message.slice(0, 60)})`);
      continue;
    }

    const keys = [...new Set(rows.map((r) => keyFromUrl(r.u, r.k)).filter((k): k is string => !!k))];
    if (!keys.length) {
      console.log(`${label}: nothing to do`);
      continue;
    }

    let present = 0;
    let copied = 0;
    let failed = 0;
    let needsAuth = 0;
    const missing: string[] = [];

    for (const key of keys) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        present++;
      } catch {
        missing.push(key);
      }
    }
    totalMissing += missing.length;

    if (!missing.length) {
      console.log(`${label}: ${present}/${keys.length} already in the bucket — nothing to do`);
      continue;
    }

    console.log(`${label}: ${present}/${keys.length} present, ${missing.length} to fetch`);

    // The dry run still reaches for one file. Whether Manus will serve these
    // at all, and whether it needs a session to do it, is the thing most
    // worth knowing before a run that writes 126 objects.
    const toDo = APPLY ? missing : missing.slice(0, 1);

    for (const key of toDo) {
      const url = `${host}/manus-storage/${key.split("/").map(encodeURIComponent).join("/")}`;
      try {
        const res = await fetch(url, {
          redirect: "follow",
          headers: cookie ? { cookie } : {},
          // Without this a single unanswered request stalls the whole run.
          signal: AbortSignal.timeout(120_000),
        });
        if (res.status === 401 || res.status === 403) {
          // Not a fault: Manus will not serve this without a session. Counted
          // apart from real failures so a run that is only short of a cookie
          // does not read as a broken one.
          needsAuth++;
          needsAuthIn.add(label);
          continue;
        }
        if (!res.ok) {
          failed++;
          failures.push(`${shape(key)} — HTTP ${res.status}`);
          continue;
        }
        const body = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";

        if (!body.length) {
          failed++;
          failures.push(`${shape(key)} — empty response`);
          continue;
        }
        // An HTML body where an image should be is a sign-in page, not a file.
        if (contentType.includes("text/html")) {
          failed++;
          failures.push(`${shape(key)} — got HTML, not a file (a sign-in page? set MANUS_COOKIE)`);
          continue;
        }

        if (!APPLY) {
          console.log(`  probe ${shape(key)} — ${res.status}, ${contentType}, ${body.length} bytes: reachable`);
          continue;
        }

        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
        );
        copied++;
        if (copied % 10 === 0) console.log(`  ${copied}/${missing.length}…`);
      } catch (err) {
        failed++;
        failures.push(`${shape(key)} — ${(err as Error).message.slice(0, 70)}`);
      }
    }

    totalCopied += copied;
    totalFailed += failed;
    totalNeedsAuth += needsAuth;
    if (APPLY) {
      console.log(
        `  copied ${copied}` +
          (needsAuth ? `, ${needsAuth} need a Manus session` : "") +
          (failed ? `, ${failed} failed` : ""),
      );
    } else if (needsAuth) {
      console.log(`  probe ${shape(missing[0])} — refused without a Manus session`);
    }
  }

  console.log("");
  if (APPLY) {
    console.log(`${totalCopied} file(s) copied into the bucket` + (totalFailed ? `, ${totalFailed} failed.` : "."));
    if (totalCopied) {
      console.log("The paths already in the database now resolve. No row was changed.");
    }
  } else {
    console.log(`${totalMissing} file(s) are missing from the bucket.`);
    console.log("Nothing was written. Re-run with `apply` ticked to copy them.");
  }

  if (totalNeedsAuth || (!APPLY && needsAuthIn.size)) {
    console.log(
      `\nManus will not serve ${[...needsAuthIn].join(" or ")} without a session.\n` +
        "Sign in to the Manus admin, copy the Cookie header from any request in\n" +
        "DevTools → Network, and save it as the MANUS_COOKIE repository secret.\n" +
        "Then run this again — it skips everything already copied.",
    );
  }

  if (failures.length) {
    console.log(`\nWhat went wrong (${failures.length}):`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
    if (failures.length > 20) console.log(`  …and ${failures.length - 20} more`);
  }

  await conn.end();
  // A missing cookie is a thing to go and get, not a broken run. Only an
  // unexpected failure turns the job red.
  if (APPLY && totalFailed) process.exit(1);
}

main().catch((err) => {
  console.error("\nMedia backfill FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
