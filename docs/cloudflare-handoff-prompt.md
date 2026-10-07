# Brief for the Claude for Chrome extension

Paste everything below the line into a Claude conversation in the Chrome window
that is signed in to Cloudflare. It is self-contained — it does not need any of
this repository's context.

Watch it work. It stops before the irreversible step on purpose.

---

I'm signed in to Cloudflare in this browser. Please set up DNS for the zone
`bundabergvoicecollective.com.au`, which I have already added to my Cloudflare
account.

**Context, so the choices make sense.** This is a community choir. The zone's
website is hosted by GoDaddy Websites + Marketing and must keep working exactly
as it does today. The choir's members platform runs on Google Cloud Run and is
being moved onto `members.bundabergvoicecollective.com.au`. Outbound email
(password set-up and reset links for 76 members) goes through Resend and depends
on three of the records below.

## Create these eight DNS records

If a record of the same type and name already exists — Cloudflare's import may
have made some — **edit it to match rather than creating a duplicate**.

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | `@` | `13.248.243.5` | **DNS only** (grey cloud) |
| CNAME | `www` | `bundabergvoicecollective.com.au` | **DNS only** (grey cloud) |
| CNAME | `send` | `send.forge.rmta.net` | **DNS only** (grey cloud) |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | **DNS only** (grey cloud) |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com` | **DNS only** (grey cloud) |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | n/a |
| TXT | `resend._domainkey` | the long string below | n/a |
| CNAME | `members` | `bvc-production-aoxblokwyq-ts.a.run.app` | **Proxied** (orange cloud) |

TTL: leave on Auto for all of them.

### The DKIM value for `resend._domainkey`

One unbroken string. No spaces, no line breaks, nothing trimmed from either end:

```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDVe3mZDGihcCQGM2VhgptoGEboffap5/t2/S0/DiRcKir+4IamRJEdLXaeeXTExJIv/VewVpiv+geiZu0Rx1jmWq7sQHbVKL96whBTg9/qvKQ2w3egbR7yS4NlJA6X9o2D8hyCia0q4104Lxh1+V99MkjuwGO1j/q+Mao0YFM4BQIDAQAB
```

After saving it, read it back and confirm it starts `p=MIGfMA0GCSqG` and ends
`YFM4BQIDAQAB`. If one character of this is wrong, the choir's password set-up
emails stop working and nothing visibly fails.

## Rules

- **Only `members` is proxied (orange).** Every other record is DNS only (grey).
  Proxying the website or the mail records would break them.
- **Do not create `NS` or `SOA` records.** Cloudflare provides its own. Copying
  the old ones would point the zone back at GoDaddy.
- **Do not delete anything.** If you find records I have not listed, leave them
  alone and tell me what they are.
- **There are no `MX` records on this zone and none should be added.** This
  domain receives no email; the choir uses a Gmail address.

## Then create one Origin Rule

Cloud Run routes requests by its own hostname, so without this the proxied
`members` record returns 404.

**Rules → Origin Rules → Create rule**

- Rule name: `members to Cloud Run`
- When incoming requests match: **Hostname** · **equals** ·
  `members.bundabergvoicecollective.com.au`
- Then: **Host Header** → Rewrite to → `bvc-production-aoxblokwyq-ts.a.run.app`
- Deploy

If Origin Rules is not available on this account's plan, stop and tell me rather
than improvising something else.

## Then stop

**Do not change the nameservers, at GoDaddy or anywhere else.** That is the
irreversible step and I will do it myself.

When you are finished, list back every DNS record now on the zone — type, name,
content, and proxy status — plus whether the Origin Rule deployed, so I can check
it against my own list.
