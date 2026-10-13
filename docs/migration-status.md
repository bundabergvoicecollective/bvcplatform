# BVC migration — where things stand

Last updated 13 Oct 2026. Written so a session starting cold can pick this up
without the preceding conversation.

## The short version

The platform is live, the member data is clean, the thing that blocked
everything — password set-up emails — works, and the Manus catch-up has been
applied. What is left is a handful of member-record fixes, two reconciliations
that need a human decision, and testing attendance before it is relied on.

**Live at https://members.bundabergvoicecollective.com.au**

The `run.app` host (`https://bvc-production-aoxblokwyq-ts.a.run.app`) still
serves the same app and still works. It is simply not what members are told.
Note the two are **separate cookie scopes**: signing in on one does not sign you
in on the other, which has caused confusing "Admins only" errors more than once.

## Verified working

- Sign-in, as admin and as member
- Admin dashboard on real data (76 members, 13 rehearsals, 83 library items)
- Password set-up / reset email, end to end, link opened and password set
- Gallery upload to R2
- The public website and `www` — unaffected by the DNS move, 200 throughout

## Not yet tested

- **Attendance marking.** The core of a rehearsal night, and nobody has marked a
  single person present on the live site. The 6 October marks were inserted by
  the importer, which does not exercise this path at all. The code is at `routers.ts:472` and
  handles pass deduction, un-marking and restore, but it has never been run.
- Music Library upload, and Rehearsal Recordings upload (the chunked path —
  `init` → `chunk` → `complete`, 5 MB a chunk). Different routes from Gallery.
- Square is not configured, so online pass purchase and the shop will not work.
  Cash and manual pass recording are unaffected.

## The data gap — closed 13 Oct

Everything used to stop on **29 September 2026**. The catch-up ran that morning
from Actions (**Database audit → `manus`**, with `apply` ticked) against an
export taken 12 Oct 21:41 UTC, and wrote 44 rows: both missing rehearsals, 33
attendance marks for 6 October, 9 pass orders and 33 pass balances. The
importer re-read every active balance afterwards and reported them all matching
Manus; the `recency` audit agreed from the other side — 15 rehearsals, 485
attendance marks, 109 pass orders, 64 active passes.

Running it again is harmless and reports nothing to do, which is how to check
this rather than trusting the paragraph above.

Two things it deliberately did not do:

- **The activity log still stops on 29 September.** Attendance was inserted
  directly, and that is precisely what makes the import safe: a direct insert
  deducts nothing, so each balance set from Manus is counted exactly once, and
  tonight's marking through the UI deducts the next one. The cost is that those
  33 marks have no activity-log entry. Nothing reads the log to work out a
  balance; it is a history view.
- **Nothing was invented for a pass Manus does not list.** One remains: a
  member holds 1 of 10 here and no active pass in Manus. They attended 6
  October on a pass, so Manus almost certainly took them to zero and closed it
  — and their $140 10-pass order has sat `pending` since 29 September. This is
  the 378th outstanding session against the export's 377. Run the `manus` audit
  to see who; it is masked in the log because this repository is public.

### The financial item

**27 pass orders sit `pending`, totalling $3,090**, against 82 paid totalling
$2,779. Of the pending, **$700 is one member**, who placed six $140 orders
inside eight minutes on 6 October — five `pending`, one `paid`. That is a
double-click on the pay button, not six purchases, and their balance reads 22
of 20, which came across from Manus as it stood.

Reconcile the rest against Manus before anything else — attendance can be
corrected next week, money is harder to reconstruct.

## Before inviting the members

The `users` table holds 76 rows, but 4 of them are the denied sign-ups below,
so **72 is the number of people to invite**.

Checked 12 Oct against the live database:

| | |
| --- | --- |
| **4 rows are `denied`, and none is a choir member** | Checked 13 Oct: all four have zero attendance, zero passes and no first name, and joined between 19 May and 2 June — one on an Apple private-relay address, one on a property-business domain. They are stray sign-ups from Manus's public registration, denied at the time, whose status came across with the import. **Do not approve them.** Leave them denied and keep them out of the invite list. An earlier version of this file said to approve them, which would have let four strangers into the site. Checked 13 Oct: the code refuses them anyway, in three independent places — `getAllMembers` excludes them from Admin → Members, `/api/auth/forgot` sends nothing to a `denied` user, and `BVCLayout` blocks them from the app. There is no bulk-invite procedure, so the recipient list is whatever is pasted into a mail tool; including one of these by hand is harmless. Note `/api/auth/forgot` refuses `denied` but not `pending`, and `/api/auth/register` makes new public sign-ups `pending` — so a future stray would get a link and then the holding screen. |
| **8 members have no `firstName`** | `BVCLayout` force-redirects them to `/profile`, so their first sight of the site is a form rather than their dashboard. The 4 above are among these 8. |
| 0 members have no email address | Everyone can be contacted. |
| 0 duplicate addresses | No member's history is split across two rows. |

Members are described as older and not confident with technology, so the
priority order for testing is what would make someone give up:

1. Can they get in at all — nobody is blocked by status now, but the invite
   list has to exclude the 4 denied rows above
2. The set-up email on a **phone**, including opened from the Facebook app.
   `client/components/MetaBrowserBanner.tsx` exists because Meta's in-app
   browser has a keyboard bug that cannot be fixed in code.
3. Sign out, then sign back in — what everyone does on day two
4. The password rules (8 character minimum) and whether the error reads clearly
5. "I didn't get the email" — there is a two-minute rate limit per member, and
   the endpoint answers identically whether or not it sent
6. Empty states — a member with no pass and no attendance should read as
   "nothing here yet", not broken

Invite 2–3 members first, not all 72. Ideally the least confident ones; they find
what the rest would.

## Tooling built for this

All under Actions, all read-only unless stated:

| Workflow | What it does |
| --- | --- |
| **Database audit** → `emails` | Collation, unnormalised addresses, duplicate addresses |
| **Database audit** → `members` | Who is blocked — named, with their history, so a real member whose status is wrong is distinguishable from a stray sign-up — who lacks a name, who is ready to invite |
| **Database audit** → `recency` | Newest row per table; pass order totals |
| **Database audit** → `schema` | Schema differences, report only |
| **Database audit** → `manus` | The Manus catch-up. Reports unless `apply` is ticked, and safe to re-run. Reads the export from the `MANUS_DELTA_B64` secret, as JSON or gzipped base64 — not a committed file, because this repository is public and the export is member addresses, balances and payments |
| **DNS snapshot** | Live DNS records, from the authoritative nameservers |
| **Site health** | Daily; fails if the website stops answering |
| **Cloudflare DNS** | Creates the zone's records via the API (needs `CLOUDFLARE_API_TOKEN`) |
| **Reset a test member** | Clears one member's password so the first-time journey can be walked |

`scripts/` holds the code each runs.

## How the domain works, so nobody undoes it

`members.bundabergvoicecollective.com.au` is a **proxied CNAME** in Cloudflare
pointing at the `run.app` host, plus a **Worker** (`bvc-members`) on the route
`members.bundabergvoicecollective.com.au/*` that rewrites the `Host` header —
Cloud Run routes by its own hostname and would 404 otherwise.

An Origin Rule would do this without code, but **Host Header rewriting is
Enterprise-only** on Cloudflare; the field is greyed out on Free.

Everything else in the zone is **DNS only (grey cloud)** so the GoDaddy website
and Resend behave exactly as before. The apex `A` record is `13.248.243.5`, the
single address GoDaddy support named for Websites + Marketing under external
DNS — and they warned it is a platform endpoint they may change, which is why
**Site health** runs daily.

`docs/dns-before-move.md` records the zone as it was, including the DKIM value
in full. `docs/members-domain.md` is the full procedure.

## Still to do

1. ~~Approve the 4 blocked members.~~ Settled 13 Oct: none of them is a member.
   Leave them denied; exclude them from the invite. That also means only 4 real
   members lack a first name, not 8 — the other 4 are these rows
2. Mark attendance for the 13 October rehearsal through the admin UI. The
   session row is already there, and this doubles as the first real test of
   attendance marking
3. Void the 5 duplicate pending orders, and settle the member whose pass and
   pending order both need a decision (both named under "The data gap" above)
4. ~~Add the members who joined Manus after the snapshot.~~ Both Carolyn Rose
   and Tarin Dobbie already have accounts here, confirmed 13 Oct once the
   `manus` audit started resolving the export's members list rather than only
   the addresses attached to a pass, order or attendance mark
5. Walk the set-up journey on a phone (the test account is password-less and
   ready — `mclucas.andy@gmail.com`)
6. Invite 2–3 members, then the rest
7. Put `docs/manus-redirect.html` on the old Manus app, so bookmarks and
   home-screen icons still reach the new site. It lives only while that app
   stays deployed, so it buys a window rather than being permanent.
8. Optional: Square secrets (passes and shop only), Artifact Registry cleanup
   policy, fill in the 8 missing first names
