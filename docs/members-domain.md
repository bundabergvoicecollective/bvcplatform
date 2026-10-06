# Putting the members site on `bundabergvoicecollective.com`

## The rule that governs all of this

**Only the `.com` is touched. The `.com.au` is never touched.**

`bundabergvoicecollective.com.au` is the GoDaddy website, and its DNS zone also
carries the MX records the choir's email depends on and the TXT record verifying
the Resend sending domain. Nothing in this document changes anything in that
zone. If a step ever seems to ask you to, stop.

## Why this is safe

The two domains point at different services:

| Domain | Resolves to | What it is |
| --- | --- | --- |
| `bundabergvoicecollective.com.au`, `www` | `76.223.105.230`, `13.248.243.5` | GoDaddy Website Builder — the live site |
| `bundabergvoicecollective.com`, `www` | `3.33.130.190`, `15.197.148.33` | GoDaddy domain forwarding |

So the `.com` is a second domain that currently just forwards to the website. Its
root is free, which is why the members site goes there rather than under a path.

**Confirm two things before starting.** Open `bundabergvoicecollective.com` — it
should bounce you to the `.com.au` site, which is what "forwarding" looks like.
Then, in GoDaddy's DNS for the `.com`, check whether it carries any `MX` records.
It almost certainly does not, since the email is on the `.com.au` — but if it
does, write them down so you can confirm Cloudflare imported them.

## Why Cloudflare

| Option | Why not |
| --- | --- |
| Cloud Run domain mapping | Not offered in `australia-southeast1`. |
| GoDaddy domain forwarding | Forwards to the site root and **drops the path and query string**, so a password reset link would arrive with its token stripped. |
| Firebase Hosting | Its Cloud Run rewrite needs the paid Blaze plan. |
| GCP load balancer | A forwarding rule is a standing monthly charge. |

Cloudflare's free plan does it for nothing.

## Step 1 — move the `.com` zone to Cloudflare

1. Sign up at dash.cloudflare.com (free plan).
2. **Add a site** → `bundabergvoicecollective.com` → Free.
3. Review the records Cloudflare found. For a forwarding-only domain there may be
   very little. Add by hand anything you noted above that is missing.
4. Cloudflare gives you two nameservers. In GoDaddy, change the nameservers **on
   the `.com` only** — Domain Settings → Nameservers → Change → I'll use my own.

**GoDaddy's forwarding stops working the moment the nameservers move.** That is
intended: Cloudflare replaces it, and the root is about to serve the members site
instead. Do not be alarmed when `bundabergvoicecollective.com` briefly does
nothing while this propagates — usually minutes.

## Step 2 — point the root at Cloud Run

Cloud Run routes requests by the `run.app` hostname in the `Host` header. A plain
CNAME is not enough on its own: the request would arrive with
`Host: bundabergvoicecollective.com`, match no service, and 404. Something has to
rewrite that header.

1. **DNS → Add record**, twice:

   | Type | Name | Target | Proxy |
   | --- | --- | --- | --- |
   | CNAME | `@` | `bvc-production-aoxblokwyq-ts.a.run.app` | **Proxied** |
   | CNAME | `www` | `bundabergvoicecollective.com` | **Proxied** |

   A CNAME at the apex is normally illegal; Cloudflare flattens it, which is one
   of the reasons this works at all. Both must be proxied (orange cloud) — that
   is what puts Cloudflare in the path so the rule below can apply.

2. **Rules → Origin Rules → Create rule**
   - When incoming requests match: Hostname **is in**
     `bundabergvoicecollective.com`, `www.bundabergvoicecollective.com`
   - Then: **Host Header** → Rewrite to `bvc-production-aoxblokwyq-ts.a.run.app`
   - Deploy.

Check Origin Rules is on your plan — Cloudflare moves features between plans, so
trust the dashboard over this document. If Host Header Override is not offered,
use the Worker below instead; it does the same job.

### Fallback: a Worker

Keep the same proxied records, then **Workers & Pages → Create Worker**, paste
this, deploy, and add routes for `bundabergvoicecollective.com/*` and
`www.bundabergvoicecollective.com/*`.

```js
// Proxies bundabergvoicecollective.com to the Cloud Run service.
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
    // real domain, and with it the session cookie. Point it back.
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
attribute, so the browser scopes it to whichever host it asked — which is what we
want.

## Step 3 — send `www` to the bare domain

**Rules → Redirect Rules → Create rule**

- When: Hostname equals `www.bundabergvoicecollective.com`
- Then: Dynamic redirect, 301, to
  `concat("https://bundabergvoicecollective.com", http.request.uri.path)`

One canonical host keeps the session cookie in one place. Without this, signing
in on `www` and then visiting the bare domain looks like being signed out.

## Do **not** add a `/members` redirect

It is tempting to make `bundabergvoicecollective.com/members` redirect to the
root. Do not: **`/members` is already a page in the app** — the admin member list
(`client/App.tsx`). A redirect rule there would break it for admins.

Nothing is lost. Anyone who types `/members` lands in the app anyway, and is
asked to sign in like anywhere else.

## Step 4 — move `APP_URL`

`APP_URL` is the origin for every emailed link: password set-up, reset and
invites. Once the domain answers it has to change, or members will keep being
sent to the `run.app` host.

Add a GitHub **Actions secret** — the Secrets tab, not Variables, see CLAUDE.md —
named `APP_URL`:

```
https://bundabergvoicecollective.com
```

`.github/workflows/deploy.yml` already reads `secrets.APP_URL` and falls back to
the `run.app` host, so adding the secret and re-running the deploy is the whole
change. Confirm it took in the deploy log's `Runtime vars set:` line.

**Everyone gets signed out once.** The session cookie is scoped to the host that
set it, so a cookie issued by the `run.app` origin is not sent to the new domain.
Expect to sign in again. This is the reason to finish the domain before inviting
the choir rather than after.

## Step 5 — verify

In order, on `https://bundabergvoicecollective.com`:

- [ ] the sign-in page loads, styled, with no console 404s — proves `/assets/*`
      is being proxied, not just the HTML
- [ ] signing in works, and a refresh keeps you signed in — proves the cookie is
      set and returned
- [ ] the admin dashboard shows real numbers — proves `/api/trpc` reaches the
      server through the proxy
- [ ] a gallery photo upload succeeds — proves multipart POSTs survive
- [ ] `www.bundabergvoicecollective.com` redirects to the bare domain
- [ ] a reset email's link points at the new domain and opens the reset page
- [ ] **the `.com.au` site still loads, and email still sends and receives**

That last one should be nothing to do with any of this — the `.com.au` zone was
never touched — but check it anyway, first thing the next morning too.

## Step 6 — redirect the old Manus site

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

Do this **after** step 5 passes, so members are not sent to a URL that is still
being set up.

## Upload sizes — checked, not a problem

Cloudflare's free plan caps a request body at 100 MB, worth knowing because
`/api/upload/recording` accepts up to 500 MB. Nothing reaches it:

- `client/pages/RehearsalRecordings.tsx` uploads through the chunked path
  (`/api/upload/recording/init` → `/chunk` → `/complete`) at **5 MB a chunk**.
  The 500 MB single-shot route exists but no client calls it.
- Library and document uploads cap at 50 MB (`server/index.ts`, `memUpload`).

If a future change ever posts a whole recording in one request, this cap becomes
real.
