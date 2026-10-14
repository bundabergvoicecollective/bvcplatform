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

14 October 2026: the 24 files Manus serves openly — 19 avatars, 3 performance
images, 2 documents — are in the bucket, and the member photos load. The 102
library and gallery files are still only on Manus, waiting on the cookie, as
are the 27 library rows that were never imported at all.

## The deadline that matters

All of this is fetched from Manus. **Every file still only exists there until
it is copied.** The day that site is switched off, anything not yet in our
bucket is gone for good — there is no other copy. Finish the library and
gallery before retiring Manus.
