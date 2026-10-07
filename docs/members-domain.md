# Putting the members site on `members.bundabergvoicecollective.com.au`

## What this touches, and why that needs care

`bundabergvoicecollective.com` is parked and not ours — GoDaddy serves a lander
on it with a "Get This Domain" button. So the members site goes on a subdomain of
`bundabergvoicecollective.com.au`, the domain we do own.

That domain's DNS zone carries three things that matter, none of which are the
members site:

1. **the website** — `@` and `www` point at GoDaddy Website Builder
   (`76.223.105.230`, `13.248.243.5`)
2. **the choir's email** — the `MX` records
3. **the Resend sending domain** — the `TXT` records (SPF and DKIM) that verify
   `bundabergvoicecollective.com.au`. Lose these and the members site stops
   sending password set-up and reset emails, which is the thing that just started
   working.

Cloudflare needs the whole zone, so all three come along for the ride. They do
not have to be *changed* — only carried across intact. The procedure below is
built around proving that before anything switches.

**Only one record is added: `members`. Nothing else in the zone is edited.**

## Why Cloudflare at all

A subdomain cannot simply point at Cloud Run. Cloud Run routes by the `run.app`
hostname in the `Host` header, so a plain CNAME arrives as
`Host: members.bundabergvoicecollective.com.au`, matches no service, and 404s.
Something has to rewrite that header.

| Option | Why not |
| --- | --- |
| Cloud Run domain mapping | Not offered in `australia-southeast1`. |
| GoDaddy domain forwarding | Bounces to the site root and **drops the path and query string**, so a reset link arrives with its token stripped. |
| Firebase Hosting | Its Cloud Run rewrite needs the paid Blaze plan. |
| GCP load balancer | A forwarding rule is a standing monthly charge. |

Cloudflare's free plan rewrites the header for nothing.

## The safety property that makes this manageable

**You build the whole zone in Cloudflare and verify it before changing a single
nameserver.** Until you flip the nameservers at GoDaddy, Cloudflare's copy is
inert — it serves nobody. Nothing you do in step 2 can break anything.

So the risk is entirely "did every record come across", and that is checkable in
advance.

## Step 1 — capture what GoDaddy has now

Before opening Cloudflare, go to GoDaddy → Domains → `bundabergvoicecollective.com.au`
→ DNS, and **save the full record list**. Screenshot it, or use GoDaddy's export.

Write down especially:

- every `MX` record, with its **priority**
- every `TXT` record — SPF (`v=spf1 …`), DKIM (often a long one on a name like
  `resend._domainkey`), and any domain-verification strings for Google, Microsoft
  or anyone else
- `@` and `www`
- anything else at all, however obscure

This list is what you check Cloudflare against. Do not skip it — it is the whole
safety net.

## Step 2 — build the zone in Cloudflare (nothing goes live yet)

1. Sign up at dash.cloudflare.com (free plan).
2. **Add a site** → `bundabergvoicecollective.com.au` → Free.
3. Cloudflare scans and imports what it can find. **Now compare its list against
   your step 1 capture, record by record.** Its scan is good but not guaranteed
   complete — DKIM records in particular are sometimes missed.
4. Add anything missing by hand. Match the values byte for byte, and the MX
   priorities exactly.
5. Set `@` and `www` to **DNS only** (grey cloud). That keeps the website's
   traffic going exactly where it goes today rather than routing it through
   Cloudflare on day one. Leave every `MX` and `TXT` alone — mail records are
   never proxied.
6. **Do not change the nameservers yet.**

## Step 3 — add the `members` record

1. **DNS → Add record**
   - Type `CNAME`, Name `members`,
     Target `bvc-production-aoxblokwyq-ts.a.run.app`
   - Proxy status **Proxied** (orange cloud). This one must be proxied — that is
     what puts Cloudflare in the request path so the rule below can apply.
2. **Rules → Origin Rules → Create rule**
   - When incoming requests match: Hostname equals
     `members.bundabergvoicecollective.com.au`
   - Then: **Host Header** → Rewrite to `bvc-production-aoxblokwyq-ts.a.run.app`
   - Deploy.

Check Origin Rules is available on your plan — Cloudflare moves features between
plans, so trust the dashboard over this document. If Host Header Override is not
offered, use the Worker below; it does the same job.

### Fallback: a Worker

Keep the same proxied `members` record, then **Workers & Pages → Create Worker**,
paste this, deploy, and add a route for
`members.bundabergvoicecollective.com.au/*`.

```js
// Proxies members.bundabergvoicecollective.com.au to the Cloud Run service.
//
// Changing the URL's hostname is what rewrites the Host header — Cloud Run
// routes by it, which is why a bare CNAME 404s. Do not try to set the Host
// header directly; fetch() takes it from the URL.
const ORIGIN = "bvc-production-aoxblokwyq-ts.a.run.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = ORIGIN;
    url.port = "";

    // redirect: "manual" so the app's own redirects reach the browser instead
    // of being followed here against the run.app host, which would drop the
    // visitor back onto the ugly URL.
    const response = await fetch(new Request(url, request), {
      redirect: "manual",
      cf: { cacheEverything: false },
    });

    // An absolute Location pointing at run.app would move the browser off the
    // subdomain, and with it the session cookie. Point it back.
    const location = response.headers.get("location");
    if (location && location.includes(ORIGIN)) {
      const fixed = new Headers(response.headers);
      fixed.set("location", location.replaceAll(ORIGIN, new URL(request.url).hostname));
      return new Response(response.body, { status: response.status, headers: fixed });
    }

    return response;
  },
};
```

`Set-Cookie` passes through untouched. The app sets `__session` with no `Domain`
attribute, so the browser scopes it to the subdomain, which is what we want.

## Step 4 — flip the nameservers

Only once step 2's comparison is clean. Cloudflare gives you two nameservers;
put them into GoDaddy under **Domain Settings → Nameservers → Change → I'll use
my own**.

Propagation is usually minutes. The website and email should be unaffected
throughout, because the records are identical — that is what step 1 and 2 were
for.

**Within the first few minutes, check in this order:**

- [ ] `bundabergvoicecollective.com.au` still loads
- [ ] `www.bundabergvoicecollective.com.au` still loads
- [ ] **send an email to the choir's address from an outside account — it still
      arrives**
- [ ] **send one from the choir's address — it still goes out**

If mail breaks, the MX records did not come across. Fix them in Cloudflare's DNS;
you do not need to move the nameservers back, and the fix takes effect in
minutes.

## Step 5 — prove the members site sends email, before anyone relies on it

The Resend verification lives in this zone, so re-check it after the move:

- [ ] Resend dashboard → Domains → `bundabergvoicecollective.com.au` still shows
      **Verified**
- [ ] signed in as admin, `/api/admin/email-check` reports `ok: true`
- [ ] `/api/admin/email-check?send=1` arrives in your inbox

Do this before step 6, and certainly before inviting the choir. Password set-up
links are how all 76 members get in; that path has only just started working and
is the one thing here that must not regress.

## Step 6 — move `APP_URL`

`APP_URL` is the origin for every emailed link: password set-up, reset and
invites. Once the subdomain answers it has to change, or members keep being sent
to the `run.app` host.

Add a GitHub **Actions secret** — the Secrets tab, not Variables, see CLAUDE.md —
named `APP_URL`:

```
https://members.bundabergvoicecollective.com.au
```

`.github/workflows/deploy.yml` already reads `secrets.APP_URL` and falls back to
the `run.app` host, so adding the secret and re-running the deploy is the whole
change. Confirm it took in the deploy log's `Runtime vars set:` line.

**Everyone gets signed out once.** The session cookie is scoped to the host that
set it, so a cookie issued by the `run.app` origin is not sent to the subdomain.
This is the reason to finish the domain before inviting the choir rather than
after.

## Step 7 — verify the members site

On `https://members.bundabergvoicecollective.com.au`:

- [ ] the sign-in page loads, styled, with no console 404s — proves `/assets/*`
      is proxied, not just the HTML
- [ ] signing in works, and a refresh keeps you signed in — proves the cookie is
      set and returned
- [ ] the admin dashboard shows real numbers — proves `/api/trpc` reaches the
      server through the proxy
- [ ] a gallery photo upload succeeds — proves multipart POSTs survive
- [ ] a reset email's link points at the subdomain and opens the reset page

## Step 8 — redirect the old Manus site

The old address is `https://bundavoice-k8a8akbx.manus.space/`, and the hostname
decides what is possible: `manus.space` is Manus's domain, not ours. We cannot
set a real 301 there, and no DNS record of ours reaches it. Only Manus can,
through a redirect feature in their product or a support request.

What works instead: replace that app's landing page with `manus-redirect.html`
from this folder. Browsers follow it from a bookmark or a home-screen icon just
as they would a 301, so members do not have to change anything to get in.

Two limits:

- It lives only while the Manus app stays deployed. Switch Manus off and the URL
  stops answering, redirect and all. It buys members a window to move across; it
  does not remove the need to tell them the new address.
- If a member installed the old site to their home screen as a standalone app,
  iOS may open the redirect in Safari rather than in that window. It still works;
  they just want to re-add the new site to get the tidy version back.

Do this after step 7 passes, so members are not sent to a URL still being set up.

## Upload sizes — checked, not a problem

Cloudflare's free plan caps a request body at 100 MB, worth knowing because
`/api/upload/recording` accepts up to 500 MB. Nothing reaches it:

- `client/pages/RehearsalRecordings.tsx` uploads through the chunked path
  (`/api/upload/recording/init` → `/chunk` → `/complete`) at **5 MB a chunk**.
  The 500 MB single-shot route exists but no client calls it.
- Library and document uploads cap at 50 MB (`server/index.ts`, `memUpload`).

If a future change ever posts a whole recording in one request, this cap becomes
real.

## If you would rather not move the zone at all

Nothing here is forced. Staying on the `run.app` URL costs nothing and risks
nothing; it is only ugly. The migration is not blocked by it — members can be
onboarded today on the `run.app` address.

The cost of deferring is that members bookmark one URL now and have to move to
another later, and the Manus redirect would need redoing. That is an
inconvenience, not a problem.
