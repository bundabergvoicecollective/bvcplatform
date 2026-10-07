/**
 * Creates the DNS records for bundabergvoicecollective.com.au in Cloudflare.
 *
 * Written because this repo's sessions run in a cloud container with no browser
 * and a network policy that denies dash.cloudflare.com — but a GitHub runner has
 * open internet, so the work can be done through Cloudflare's API instead of by
 * hand. That matters most for the DKIM record: it is a 216-character unbroken
 * string, and mistyping one character of it stops the members site sending
 * password set-up emails, silently.
 *
 * The record set is the one captured in docs/dns-before-move.md, agreed by two
 * independent sources — GoDaddy's own record list and a dig against the
 * authoritative nameservers — and since confirmed by GoDaddy support.
 *
 * Idempotent: a record that already matches is left alone, one that differs is
 * updated, one that is missing is created. Nothing is ever deleted, so a record
 * this script does not know about survives untouched.
 *
 * It does NOT create the Origin Rule that rewrites the Host header. That is
 * three fields in the dashboard, and the API token permission it needs is one I
 * would be guessing at — see docs/members-domain.md for the clicks.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=... tsx scripts/cloudflareDns.ts            # report
 *   CLOUDFLARE_API_TOKEN=... tsx scripts/cloudflareDns.ts --apply    # write
 *
 * The token needs Zone:Read and DNS:Edit on this zone, and nothing else.
 */

const APPLY = process.argv.includes("--apply");
const ZONE = process.env.CLOUDFLARE_ZONE ?? "bundabergvoicecollective.com.au";
const API = "https://api.cloudflare.com/client/v4";

type Desired = {
  type: "A" | "CNAME" | "TXT";
  /** Bare label, or "@" for the zone apex. */
  name: string;
  content: string;
  proxied?: boolean;
  why: string;
};

/**
 * Only `members` is proxied. Everything else stays DNS-only so the website and
 * Resend keep behaving exactly as they do today, with Cloudflare out of the
 * path — the website in particular is GoDaddy's to serve, not ours to front.
 */
const DESIRED: Desired[] = [
  {
    type: "A",
    name: "@",
    content: "13.248.243.5",
    proxied: false,
    why: "the website — the single address GoDaddy support named for Websites + Marketing under external DNS",
  },
  {
    type: "CNAME",
    name: "www",
    content: "bundabergvoicecollective.com.au",
    proxied: false,
    why: "the website",
  },
  {
    type: "CNAME",
    name: "send",
    content: "send.forge.rmta.net",
    proxied: false,
    why: "Resend — outbound email",
  },
  {
    type: "CNAME",
    name: "rsend",
    content: "rsend-apne1.forge.rmta.net",
    proxied: false,
    why: "Resend — outbound email",
  },
  {
    type: "CNAME",
    name: "_domainconnect",
    content: "_domainconnect.gd.domaincontrol.com",
    proxied: false,
    why: "GoDaddy automation; inert off their nameservers, carried over for fidelity",
  },
  {
    type: "TXT",
    name: "_dmarc",
    content:
      "v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;",
    why: "deliverability policy",
  },
  {
    type: "TXT",
    name: "resend._domainkey",
    content:
      "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDVe3mZDGihcCQGM2VhgptoGEboffap5/t2/S0/DiRcKir+4IamRJEdLXaeeXTExJIv/VewVpiv+geiZu0Rx1jmWq7sQHbVKL96whBTg9/qvKQ2w3egbR7yS4NlJA6X9o2D8hyCia0q4104Lxh1+V99MkjuwGO1j/q+Mao0YFM4BQIDAQAB",
    why: "Resend DKIM — the members site cannot send password set-up emails without this",
  },
  {
    type: "CNAME",
    name: "members",
    content: "bvc-production-aoxblokwyq-ts.a.run.app",
    proxied: true,
    why: "the members site — must be proxied so the Origin Rule can rewrite the Host header",
  },
];

const fqdn = (name: string) => (name === "@" ? ZONE : `${name}.${ZONE}`);

type CfRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
};

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set.");

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as {
    success: boolean;
    result: T;
    errors?: { code: number; message: string }[];
  };
  if (!body.success) {
    const why = (body.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
    throw new Error(`Cloudflare API ${init.method ?? "GET"} ${path} failed: ${why || res.status}`);
  }
  return body.result;
}

async function main() {
  console.log(`Zone : ${ZONE}`);
  console.log(`Mode : ${APPLY ? "APPLY — records will be written" : "report only"}\n`);

  const zones = await cf<{ id: string; name: string; status: string }[]>(
    `/zones?name=${encodeURIComponent(ZONE)}`,
  );
  const zone = zones[0];
  if (!zone) {
    throw new Error(
      `No zone named "${ZONE}" on this account. Add the domain in the Cloudflare dashboard first — that part needs a person.`,
    );
  }
  console.log(`Zone id: ${zone.id}  (status: ${zone.status})\n`);

  const existing = await cf<CfRecord[]>(`/zones/${zone.id}/dns_records?per_page=200`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const want of DESIRED) {
    const full = fqdn(want.name);
    const have = existing.find((r) => r.type === want.type && r.name === full);

    // Cloudflare hands TXT content back with surrounding quotes; strip them so a
    // matching record is not rewritten on every run.
    const haveContent = have?.content.replace(/^"(.*)"$/s, "$1");
    const proxied = want.proxied ?? false;
    const matches =
      have && haveContent === want.content && (have.proxied ?? false) === proxied;

    const label = `${want.type.padEnd(5)} ${want.name.padEnd(18)}`;

    if (matches) {
      console.log(`  ok      ${label} already correct`);
      unchanged++;
      continue;
    }

    const payload = {
      type: want.type,
      name: full,
      content: want.content,
      ttl: 1, // 1 means "automatic"
      ...(want.type === "TXT" ? {} : { proxied }),
      comment: want.why.slice(0, 100),
    };

    if (!have) {
      console.log(`  create  ${label} ${want.content.slice(0, 48)}${want.content.length > 48 ? "…" : ""}`);
      if (APPLY) await cf(`/zones/${zone.id}/dns_records`, { method: "POST", body: JSON.stringify(payload) });
      created++;
    } else {
      console.log(`  update  ${label} was: ${(haveContent ?? "").slice(0, 40)}…`);
      if (APPLY) {
        await cf(`/zones/${zone.id}/dns_records/${have.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      updated++;
    }
  }

  console.log(
    `\n${created} to create, ${updated} to update, ${unchanged} already correct.` +
      (APPLY ? " Done." : " Re-run with --apply to write them."),
  );

  // Records on this zone that this script does not manage. Reported so nothing
  // carried over by Cloudflare's own import is quietly forgotten about — and
  // never touched, because deleting someone's DNS is not this script's business.
  const managed = new Set(DESIRED.map((d) => `${d.type} ${fqdn(d.name)}`));
  const extra = existing.filter((r) => !managed.has(`${r.type} ${r.name}`));
  if (extra.length) {
    console.log("\nAlso on this zone, left untouched:");
    for (const r of extra) console.log(`  ${r.type.padEnd(5)} ${r.name}`);
  }

  console.log(
    "\nStill to do by hand: the Origin Rule rewriting the Host header for\n" +
      `members.${ZONE} to bvc-production-aoxblokwyq-ts.a.run.app,\n` +
      "and the nameserver change at GoDaddy. See docs/members-domain.md.",
  );
}

main().catch((err) => {
  console.error("\nCloudflare DNS setup FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
