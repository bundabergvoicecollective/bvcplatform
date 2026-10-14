# What is still in Manus

Two gaps, easy to confuse, with different fixes. Both are covered here.

| | what is missing | fix |
| --- | --- | --- |
| **Rows** | content Manus has that this database has never seen | `manuscontent` |
| **Files** | objects the rows point at that are not in our bucket | `mediabackfill` |

## The rows

The 29 September import covered rehearsals, attendance, orders, passes and
members. It never touched content, so every content table stops dead on that
date:

| | rows here | newest |
| --- | --- | --- |
| library items | 83 (Manus has 110) | 29 Sep 2026 |
| performances | 5 | 30 Aug 2026 |
| gallery posts | 12 | 12 Sep 2026 |
| announcements | 2 | 8 Sep 2026 |
| documents | 2 | 18 May 2026 |

`scripts/manusContentSync.ts`, via Actions → **Database audit** →
`manuscontent`, reads Manus's own tRPC procedures with a signed-in cookie and
adds what is missing — and copies the files in the same pass, so a new row
never arrives as a broken link. Nothing is updated or deleted; a row that
matches is left alone, so it is safe to re-run.

Matching is on `fileKey` for anything with a file, because that is what an
upload makes unique. Performances and announcements have no file, so they
match on title plus date.

`scripts/manusContentExport.js` does the same read from the browser console
and is the fallback if the cookie route ever stops working.

### About the cookie

Get it by hand and let `gh` read it without echoing:

```
gh secret set MANUS_COOKIE --repo bundabergvoicecollective/bvcplatform
```

No temp file, no shell-history entry, and nothing through a transcript. The
value comes from DevTools → **Application** → Cookies →
`https://bundavoice-k8a8akbx.manus.space`, or Network → any request →
Request Headers → `Cookie` for the whole header string.

Two things that outlive the copying:

- An Actions secret is readable by every workflow run in this repository and
  by anyone with write access. This one is a live admin session for the old
  site. **Delete the secret once the migration is finished**, and sign out of
  Manus once to invalidate it.
- A Manus session cookie expires or rotates on its own schedule. An expired
  one makes every read fail the same quiet way — nothing imported, nothing
  obviously wrong — which is exactly how `drizzle-kit push` reported success
  for weeks while applying nothing. `manusContentSync.ts` therefore treats a
  401, a 403 or an HTML page where JSON was expected as an authentication
  failure, says so as an Actions error, and exits 1. A green tick on that job
  means it really did read Manus.

# The files behind the rows

The 29 September migration brought the database across and left every file
behind. That is why member photos showed a torn-image icon, and why the
library looked full and opened empty.

## How it happened

Rows carry a path like `/manus-storage/library/something.pdf`. That is not a
Manus address — it is a path on *our* site. `server/storageProxy.ts` redirects
it to `/r2-storage/<key>` and presigns that key against our R2 bucket. So a
row pointing at a file that was never copied is indistinguishable, in the
database, from one pointing at a file that was: both are just a string.

Asking the bucket is the only way to tell, which is what
`scripts/mediaAudit.ts` now does when it has R2 credentials.

What it found on 14 October 2026:

| | in the bucket | missing |
| --- | --- | --- |
| member avatars | 1 | 19 |
| library items | 0 | 83 |
| gallery posts | 0 | 12 |
| gallery media | 0 | 7 |
| performances (images) | 0 | 3 |
| documents | 0 | 2 |

The one avatar that worked had been uploaded through the new site.

## Fixing it

`scripts/mediaBackfill.ts`, via Actions → **Database audit** → `mediabackfill`.
It fetches each missing file from Manus and writes it to our bucket under the
same key the row already uses, so **no row changes** — the paths that are
already there simply start resolving. It skips anything present, so it is safe
to re-run and resumes a partial run.

Report-only unless `apply` is ticked. The dry run still fetches one file per
table, because whether Manus will serve them — and whether it needs a session
— is the thing worth knowing before writing 126 objects.

## Manus serves it two ways

| | |
| --- | --- |
| avatars, performance images, documents | served to anyone who asks |
| library, gallery | **403 without a session** |

That is Manus being careful with member-only material, not a fault. For those,
sign in to the Manus admin, copy the `Cookie` header from any request in
DevTools → Network, and save it as the **MANUS_COOKIE** repository secret
(Settings → Secrets and variables → Actions → *Secrets* tab, not Variables).
Then run `mediabackfill` with `apply` again.

A run that is only short of a cookie finishes green and says so. It has
copied everything it could.

## Where it stands

**Done, 14 October 2026.** Verified by asking the bucket, not by trusting the
copier:

| | in the bucket |
| --- | --- |
| member avatars | 20 of 20 |
| library items | 110 of 110 |
| gallery posts | 12 of 12 |
| gallery media | 7 of 7 |
| performances (images) | 4 of 4 |
| documents | 2 of 2 |

Plus 29 rows that had never been imported: 27 library items, the Carols
performance and its announcement.

### The wrong turn, which is the useful part

Avatars, performance images and documents copied on the first attempt.
Library and gallery answered `403 AccessDenied` from CloudFront, and I read
that as Manus protecting member-only material — so the hunt went to session
cookies, then to CloudFront signed cookies, and finally to "the files must be
gone", which would have meant telling the choir its music was lost. One click
on **Download** in the Manus UI disproved that in a second.

The actual cause was in our own code. The backfill rebuilt each fetch URL from
the `fileKey` column, re-encoding every path segment:

```
key.split("/").map(encodeURIComponent).join("/")
```

A no-op for `avatars/9f3c21.jpg`. Not a no-op for
`library/Angels We Have Heard On High - Bass.mp3`. It asked for a key that
does not exist — and **S3 answers a missing key with `AccessDenied`, not
`404`, when the caller cannot list the bucket.** Identical response, opposite
meaning. Same file, same signed URL mechanism, two URLs:

```
rebuilt  → 403 AccessDenied
asStored → 200 audio/mpeg, 6,728,773 bytes
```

Both scripts now fetch the row's own `fileUrl`, which is what the app itself
links to. Worth remembering: `AccessDenied` from S3 means *the key or the
permission*, and nothing in the response says which.

### Two more quiet-failure traps, both fixed

- An expired `MANUS_COOKIE` made every content read fail the same way and the
  job exit 0 — nothing imported, green tick. A login page comes back as **200
  HTML**, which died in the JSON parse and reported as "that procedure does
  not exist", sending you after a renamed endpoint instead of a dead cookie.
  Now an `::error::` and exit 1.
- The backfill read one table, copied its files, read the next. Copying 110
  library files took twenty minutes, TiDB dropped the idle connection, and the
  four tables after the library failed with "connection is in closed state" —
  under a tidy "110 copied" summary and a green tick. Every table is now read
  before anything is fetched, and an unreadable table exits 1.

All three are the `drizzle-kit push` failure in different clothes: a step that
reports success and does nothing. Worth assuming it is the default shape of a
bug here rather than a coincidence.

## The rows, finished

14 October 2026. Everything Manus holds is now here, verified by comparing
every table rather than by trusting any single import:

| | |
| --- | --- |
| library items | 110 / 110 |
| events, gallery posts, documents, sessions, groups, shop products | level |
| live streams | 15 / 15 — "BVC Rehearsal - October 6" was the one missing |
| event RSVPs | Carols 4 → 30, Moncrieff 31 → 37 |
| gallery comments | 3 / 3 |
| attendance | 526 here, 452 there — we have **more**, which is right: Tuesday's 39 marks happened on this site |

### Two things that look like gaps and are not

**Members: 76 here, 73 from `members.list`.** That procedure returns the
approved roll; `members.listAll` includes pending and denied, which our users
table holds. There was never a missing member.

**Moncrieff: 37 here, 38 there.** Two of Manus's RSVP rows resolve to the same
member on our side — a duplicate in theirs, not a loss in ours.

### What the audits taught, which is the part worth keeping

**An id from another system is not an identity.** `scripts/manusCoverage.ts`
compared RSVPs by asking Manus about *our* event ids, which happened to line
up for everything imported in September and did not for the Carols row created
here on the 13th. It reported Carols as having 0 RSVPs in Manus when it had 28.
Match on what a thing *is* — a title and a date, an address — not on a number
another system assigned it. `scripts/manusGapFill.ts` does, which is why it got
the right answer.

**`events.rsvpList` carries no address**, only Manus's own `userId`. Attaching
those by raw id would mean assuming their member numbers equal ours; an RSVP on
the wrong member tells somebody they are singing at a concert they never agreed
to. The bridge goes `their id → their address → our member`, built from
`members.listAll`. Their id identifies the person inside their system; the
address is the thing that crosses between systems.

**Guessing procedure names has a floor.** Six tables read `?` until
`scripts/manusProcedures.ts` pulled the real names out of Manus's public
JavaScript bundle — a tRPC client builds its path from property access, and
minifiers leave property names alone, so `events.rsvpList` and
`payments.allOrders` are sitting there in the file.

### Now delete the secret

`MANUS_COOKIE` is a live admin session for the old site, sitting in a public
repository's secret store where every workflow run and anyone with write
access can read it. The migration is done. **Delete it**, and sign out of
Manus once to invalidate it.

## The deadline that matters

All of this is fetched from Manus. **Every file still only exists there until
it is copied.** The day that site is switched off, anything not yet in our
bucket is gone for good — there is no other copy. Finish the library and
gallery before retiring Manus.
