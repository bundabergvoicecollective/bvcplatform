/**
 * Ask Resend what became of one message.
 *
 * `[Email] accepted` in the application log means our SMTP conversation was
 * accepted, nothing more. Whether the message then reached a mailbox, bounced
 * or was marked as spam is only knowable from Resend, and only by id.
 *
 * Resend's SMTP password is an API key, so the SMTP_PASS secret is the same
 * credential the REST API wants. Nothing is sent and nothing is changed — this
 * is a GET.
 *
 * NOTHING FROM THE BODY IS PRINTED. A password-setup or invite message carries
 * a working token in its link, and this runs in Actions on a public
 * repository: printing the html or text would hand anyone reading the log a
 * live invite. Addresses are masked for the same reason.
 *
 * Usage: SMTP_PASS=… tsx scripts/resendLookup.ts --id=<resend message id>
 */
// This file imports nothing — fetch is global — and a TypeScript file with
// no import or export is a script, not a module, so its `main` would collide
// with every other script's in the same compile. The empty export makes it a
// module. (manusProcedures.ts was committed broken for exactly this reason.)
export {};

const ID = process.argv.find((a) => a.startsWith("--id="))?.slice("--id=".length);

/** a.mclucas@example.com → a.m•••@e•••.com */
function mask(addr: string): string {
  const m = /^([^@]+)@(.+)$/.exec(addr.trim());
  if (!m) return "(not an address)";
  const [, local, domain] = m;
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${local.slice(0, 2)}•••@${domain.slice(0, 1)}•••${tld}`;
}

async function main() {
  if (!ID) throw new Error("Pass --id=<resend message id>.");
  const key = process.env.SMTP_PASS?.trim();
  if (!key) throw new Error("SMTP_PASS is not set — that secret holds the Resend API key.");
  if (!key.startsWith("re_")) {
    console.log("Note: SMTP_PASS does not look like a Resend API key (re_…). If this 401s, that is why.\n");
  }

  const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(ID)}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 404) {
    console.log(`Resend has no message with id ${ID}.`);
    console.log("Either the id is not one of theirs, or it has aged out of their retention.");
    process.exit(0);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Resend refused the key (HTTP ${res.status}). SMTP_PASS is not a valid API key for this account.`);
  }
  if (!res.ok) throw new Error(`Resend answered HTTP ${res.status}.`);

  const body = (await res.json()) as {
    id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    created_at?: string;
    last_event?: string;
  };

  const to = Array.isArray(body.to) ? body.to : body.to ? [body.to] : [];
  console.log(`id        ${body.id ?? ID}`);
  console.log(`to        ${to.map(mask).join(", ") || "(none recorded)"}`);
  console.log(`from      ${body.from ? mask(body.from) : "(none recorded)"}`);
  console.log(`subject   ${body.subject ?? "(none recorded)"}`);
  console.log(`created   ${body.created_at ?? "(none recorded)"}`);
  console.log(`status    ${body.last_event ?? "(none recorded)"}`);

  const verdict: Record<string, string> = {
    delivered: "It reached the mailbox. If nobody can find it, it is in spam or was deleted.",
    bounced: "The receiving server rejected it. The address is wrong, full, or blocking us.",
    complained: "It arrived and was marked as spam. Do not resend to this address.",
    delivery_delayed: "Still being retried. Not a failure yet, but it has not landed.",
    sent: "Handed to the receiving server, no delivery confirmation yet.",
    queued: "Accepted by Resend and not yet sent.",
  };
  const note = verdict[body.last_event ?? ""];
  if (note) console.log(`\n${note}`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
