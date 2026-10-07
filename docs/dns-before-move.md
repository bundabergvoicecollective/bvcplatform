# `bundabergvoicecollective.com.au` — DNS as it stands before the Cloudflare move

Captured 7 Oct 2026 from two independent sources: GoDaddy's own DNS record list,
and a `dig` against the authoritative nameservers (`ns27`/`ns28.domaincontrol.com`)
run by `.github/workflows/dns-snapshot.yml`.

The two agree, with one exception worth knowing about: the `dig` snapshot **missed
`rsend`**, because that name was not in its guess list and DNS offers no way to
enumerate a zone. GoDaddy's list is what caught it. Keep treating the registrar's
list as the authority.

## What is actually here

Ten records. **There are no MX records** — this domain receives no email. The
choir's mailbox is a Gmail address, entirely outside this zone, so moving the
zone cannot break inbound mail. Outbound is a different matter; see below.

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | GoDaddy "WebsiteBuilder Site" → `76.223.105.230`, `13.248.243.5` |
| NS | `@` | `ns27.domaincontrol.com.` |
| NS | `@` | `ns28.domaincontrol.com.` |
| SOA | `@` | `ns27.domaincontrol.com. dns.jomax.net. 2026092901 …` |
| CNAME | `www` | `bundabergvoicecollective.com.au.` |
| CNAME | `send` | `send.forge.rmta.net.` |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net.` |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com.` |
| TXT | `resend._domainkey` | the DKIM key, in full below |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |

There is no SPF `TXT` at the apex. Resend's setup here is the CNAME kind, which
is why `send` and `rsend` matter as much as the DKIM key.

### The DKIM value, in full

Copy this exactly. It is one unbroken string — no spaces, no line breaks. This is
the single record most likely to be corrupted by a careless paste, and corrupting
it stops the members site sending password set-up and reset emails.

```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDVe3mZDGihcCQGM2VhgptoGEboffap5/t2/S0/DiRcKir+4IamRJEdLXaeeXTExJIv/VewVpiv+geiZu0Rx1jmWq7sQHbVKL96whBTg9/qvKQ2w3egbR7yS4NlJA6X9o2D8hyCia0q4104Lxh1+V99MkjuwGO1j/q+Mao0YFM4BQIDAQAB
```

## What to build in Cloudflare

| Type | Name | Value | Proxy | Why |
| --- | --- | --- | --- | --- |
| A | `@` | `13.248.243.5` | **DNS only** | the website — the address GoDaddy support named |
| CNAME | `www` | `bundabergvoicecollective.com.au` | **DNS only** | the website |
| CNAME | `send` | `send.forge.rmta.net` | **DNS only** | Resend — outbound email |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | **DNS only** | Resend — outbound email |
| TXT | `resend._domainkey` | the key above | — | Resend DKIM |
| TXT | `_dmarc` | the DMARC string above | — | deliverability policy |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com` | **DNS only** | GoDaddy automation; stops working off their nameservers anyway, so optional |
| CNAME | `members` | `bvc-production-aoxblokwyq-ts.a.run.app` | **Proxied** | **new** — the members site |

**`NS` and `SOA` are not copied.** Cloudflare issues its own; copying GoDaddy's
would point the zone back at the registrar.

**Only `members` is proxied.** Everything else stays grey so the website and
Resend behave exactly as they do today, with Cloudflare out of the path.

## The apex address, and the risk GoDaddy confirmed

The apex `A` record is not an address in GoDaddy's interface — it reads
"WebsiteBuilder Site", a managed pointer they resolve on your behalf. Asked what
it should become under external DNS, GoDaddy support answered on 7 Oct 2026:

> * A record for @ → 13.248.243.5
> * CNAME for www → bundabergvoicecollective.com.au
>
> Those are the right targets for your current GoDaddy Websites + Marketing
> setup. They're generally meant to be stable, but they are still platform
> endpoints, so GoDaddy can change them later. If that happens, you'd need to
> update them at the external DNS provider.

**Use only `13.248.243.5`.** A lookup on the same day also returned
`76.223.105.230`, but support named one address, and two `A` records round-robin:
if the unnamed one is ever retired, half of all visitors would hit a dead address
while the site looked fine from your desk.

The caveat in their last sentence is the lasting cost of this move, and it does
not go away. Nothing would announce such a change — the website would simply stop
loading. `.github/workflows/site-health.yml` checks the site every morning for
exactly this reason and fails the run if it is down, so GitHub emails about it
rather than a choir member noticing weeks later.

Re-run the snapshot workflow (Actions → **DNS snapshot**) just before the switch
to confirm the address has not already moved.

## After the move, confirm

- `bundabergvoicecollective.com.au` and `www` still load
- Resend dashboard still shows the domain **Verified**
- `/api/admin/email-check?send=1`, as admin, still arrives

Inbound mail needs no check — there is none to break.
