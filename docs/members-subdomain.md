# Putting the members site on `members.bundabergvoicecollective.com.au`

## The rule that governs all of this

`bundabergvoicecollective.com.au` — the bare domain and `www` — is the GoDaddy
website. **Nothing here changes the `@` or `www` records.** Every step below
touches only a new `members` record. If an instruction ever seems to ask you to
edit `@` or `www`, stop.

## Why Cloudflare, and why not the alternatives

| Option | Why not |
| --- | --- |
| Cloud Run domain mapping | Not offered in `australia-southeast1`. |
| GoDaddy domain forwarding | Forwards to the site root and **drops the path and query string**, so every password reset link would arrive with its token stripped. |
| Firebase Hosting | Its Cloud Run rewrite needs the paid Blaze plan. |
| GCP load balancer | A forwarding rule is a standing monthly charge. |

Cloudflare's free plan does it for nothing. The cost is that Cloudflare has to
host the whole DNS zone, so the nameservers move from GoDaddy to Cloudflare.
That is the only genuinely risky step, because the zone carries the MX records
the choir's email depends on. Cloudflare imports existing records
automatically; check them against GoDaddy before flipping the nameservers, and
keep the GoDaddy DNS page open in another tab so you can compare.

## Step 1 — add the zone to Cloudflare

1. Sign up at dash.cloudflare.com (free plan).
2. **Add a site** → `bundabergvoicecollective.com.au` → Free.
3. Cloudflare scans and shows the records it found. **Before continuing**,
   compare that list against GoDaddy's DNS page, record by record. The ones that
   matter most:
   - `MX` records — email. If these are missing or wrong, email stops.
   - `@` and `www` — the website.
   - any `TXT` records (SPF, DKIM, domain verification). Resend's verification
     for `bundabergvoicecollective.com.au` lives here; losing it stops all
     outbound email from the members site.
4. Add anything missing by hand before moving on.
5. Set `@` and `www` to **DNS only** (grey cloud) for now. That keeps the
   website's traffic flowing exactly as it does today instead of routing it
   through Cloudflare on day one. Only the `members` record needs to be proxied.
6. Cloudflare gives you two nameservers. Put those into GoDaddy under
   **Domain Settings → Nameservers → Change → I'll use my own**.

Propagation is usually minutes, sometimes hours. The website and email should
be unaffected throughout, because the records are identical — that is the point
of step 3.

## Step 2 — point `members` at Cloud Run

Cloud Run routes requests by the `run.app` hostname in the `Host` header. A
plain CNAME is therefore not enough: the request would arrive with
`Host: members.bundabergvoicecollective.com.au`, match no service, and 404.
Something has to rewrite the `Host` header.

### Preferred: a proxied CNAME plus an Origin Rule (no code)

1. **DNS → Add record**
   - Type `CNAME`, Name `members`,
     Target `bvc-production-aoxblokwyq-ts.a.run.app`
   - Proxy status **Proxied** (orange cloud). This one must be proxied; that is
     what puts Cloudflare in the path so the rule below can apply.
2. **Rules → Origin Rules → Create rule**
   - When incoming requests match: Hostname equals
     `members.bundabergvoicecollective.com.au`
   - Then: **Host Header** → Rewrite to
     `bvc-production-aoxblokwyq-ts.a.run.app`
   - Deploy.

Check Origin Rules is available on your plan — Cloudflare moves features
between plans, so trust the dashboard over this document. If Host Header
Override is not offered, use the Worker below instead; it does the same job.

### Fallback: a Worker

Keep the same proxied `members` CNAME, then **Workers & Pages → Create Worker**,
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
attribute, so the browser scopes it to whichever host it asked — the subdomain —
which is what we want.

## Step 3 — move `APP_URL`

`APP_URL` is the origin for every emailed link: password set-up, reset and
invites. Once the subdomain answers, it has to change, or members will keep
being sent to the `run.app` host.

Add a GitHub **Actions secret** (the Secrets tab, not Variables — see CLAUDE.md)
named `APP_URL` with the value:

```
https://members.bundabergvoicecollective.com.au
```

`.github/workflows/deploy.yml` already reads `secrets.APP_URL` and falls back to
the `run.app` host, so adding the secret and re-running the deploy is the whole
change. Confirm it took effect in the deploy log's `Runtime vars set:` line.

**Everyone gets signed out once.** The session cookie is scoped to the host that
set it, so a cookie issued by the `run.app` origin is not sent to the subdomain.
Expect to sign in again, and expect members mid-rollout to do the same. This is
a reason to finish the domain before inviting the choir, not after.

## Step 4 — verify

In order, on the new host:

- [ ] the sign-in page loads, with styling and no console 404s — this proves the
      `/assets/*` paths are being proxied, not just the HTML
- [ ] signing in works, and a refresh keeps you signed in — this proves the
      cookie is being set and returned
- [ ] the admin dashboard shows real numbers — this proves `/api/trpc` is
      reaching the server through the proxy
- [ ] a gallery photo upload succeeds — this proves multipart POSTs survive
- [ ] a reset email's link points at `members.…` and opens the reset page
- [ ] **the main website at `bundabergvoicecollective.com.au` and `www` still
      loads, and email still sends and receives**

That last one is the one to check first thing the next morning too.

## Upload sizes — checked, not a problem

Cloudflare's free plan caps a request body at 100 MB, which is worth knowing
because `/api/upload/recording` accepts up to 500 MB. Nothing hits it:

- `client/pages/RehearsalRecordings.tsx` uploads through the chunked path
  (`/api/upload/recording/init` → `/chunk` → `/complete`) at **5 MB a chunk**.
  The 500 MB single-shot route exists but no client calls it.
- Library and document uploads cap at 50 MB (`server/index.ts`, `memUpload`).

If a future change ever posts a whole recording in one request, this cap becomes
real.

## Redirecting the old Manus site

The old address is `https://bundavoice-k8a8akbx.manus.space/`, and the hostname
decides what is possible: `manus.space` is Manus's domain, not ours. We cannot
set a real 301 there, and no DNS record of ours can reach it. Only Manus can,
through a redirect feature in their product or a support request.

What works instead: replace that app's landing page with `manus-redirect.html`
in this folder. Browsers follow it from a bookmark or a home-screen icon just as
they would a 301, so members do not have to change anything to get in.

Two limits to hold in mind:

- It lives only while the Manus app stays deployed. Switch Manus off and the URL
  stops answering, redirect and all. So it buys members a window to move across;
  it does not remove the need to tell them the new address.
- If a member installed the old site to their home screen as a standalone app,
  iOS may open the redirect in Safari rather than in that window. It still
  works; they just want to re-add the new site to their home screen to get the
  tidy version back.

Deploy it **after** the subdomain answers, with the URL in that file pointing at
`https://members.bundabergvoicecollective.com.au/`. Sending members to the
`run.app` host now and the subdomain later redirects them twice.

A note on "permanent": browsers cache a 301 hard and for a long time. For
retiring a dead address for good that is what you want — but it is moot here,
since this cannot be a 301 anyway.
