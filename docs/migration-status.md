# BVC migration — where things stand

Last updated 12 Oct 2026. Written so a session starting cold can pick this up
without the preceding conversation.

## The short version

The platform is live, the member data is clean, and the thing that blocked
everything — password set-up emails — works. What is left is a small data
catch-up, a handful of member-record fixes, and testing attendance before it is
relied on.

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
  single person present on the live site. The code is at `routers.ts:472` and
  handles pass deduction, un-marking and restore, but it has never been run.
- Music Library upload, and Rehearsal Recordings upload (the chunked path —
  `init` → `chunk` → `complete`, 5 MB a chunk). Different routes from Gallery.
- Square is not configured, so online pass purchase and the shop will not work.
  Cash and manual pass recording are unaffected.

## The data gap

Everything stops on **29 September 2026** — rehearsals, attendance, passes,
activity log, library, all on the same date. That is a one-time snapshot, not
drift. Nothing has been written since except sign-ins.

So what is missing is small and specific:

- **The 6 October rehearsal**, and its attendance and pass deductions
- Payments since 26 September
- Any members who joined since 15 September

**There is no Manus import tooling in this repository**, and no route to Manus
from a cloud session. Getting this across means one of: a Manus export file,
screenshots read by hand, or typing it into the admin UI while reading Manus.
For one rehearsal, typing it in is faster than building an importer — and it
doubles as the attendance test above.

Do not write attendance rows directly to the database. Marking someone present
deducts a pass session and writes an activity-log entry; bypassing that leaves
balances wrong in ways that surface weeks later.

### The financial item

**21 pass orders sit `pending`, totalling $2,250**, against 79 paid totalling
$2,483. Nearly half the money is unresolved. Each is either genuinely unpaid or
was paid in Manus after the snapshot. Reconcile against Manus before anything
else — attendance can be corrected next week, money is harder to reconstruct.

## Before inviting the 76 members

Checked 12 Oct against the live database:

| | |
| --- | --- |
| **4 members are `pending` or `denied`** | They would set a password, sign in, and hit the "awaiting approval" screen (`client/components/BVCLayout.tsx:96`). To anyone non-technical that reads as "it didn't work". **Fix these first** — Admin → Members, approve them. |
| **8 members have no `firstName`** | `BVCLayout` force-redirects them to `/profile`, so their first sight of the site is a form rather than their dashboard. The 4 above are among these 8. |
| 0 members have no email address | Everyone can be contacted. |
| 0 duplicate addresses | No member's history is split across two rows. |

Members are described as older and not confident with technology, so the
priority order for testing is what would make someone give up:

1. Can they get in at all — the 4 blocked members above
2. The set-up email on a **phone**, including opened from the Facebook app.
   `client/components/MetaBrowserBanner.tsx` exists because Meta's in-app
   browser has a keyboard bug that cannot be fixed in code.
3. Sign out, then sign back in — what everyone does on day two
4. The password rules (8 character minimum) and whether the error reads clearly
5. "I didn't get the email" — there is a two-minute rate limit per member, and
   the endpoint answers identically whether or not it sent
6. Empty states — a member with no pass and no attendance should read as
   "nothing here yet", not broken

Invite 2–3 members first, not 76. Ideally the least confident ones; they find
what the rest would.

## Tooling built for this

All under Actions, all read-only unless stated:

| Workflow | What it does |
| --- | --- |
| **Database audit** → `emails` | Collation, unnormalised addresses, duplicate addresses |
| **Database audit** → `members` | Who is blocked, who lacks a name, who is ready to invite |
| **Database audit** → `recency` | Newest row per table; pass order totals |
| **Database audit** → `schema` | Schema differences, report only |
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

1. Approve the 4 blocked members
2. Reconcile the 21 pending pass orders against Manus
3. Enter the 6 October rehearsal and its attendance
4. Walk the set-up journey on a phone (the test account is password-less and
   ready — `mclucas.andy@gmail.com`)
5. Invite 2–3 members, then the rest
6. Put `docs/manus-redirect.html` on the old Manus app, so bookmarks and
   home-screen icons still reach the new site. It lives only while that app
   stays deployed, so it buys a window rather than being permanent.
7. Optional: Square secrets (passes and shop only), Artifact Registry cleanup
   policy, fill in the 8 missing first names
