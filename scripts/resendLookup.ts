/**
 * Ask Resend what became of one message.
 *
 * `[Email] accepted` in the application log means our SMTP conversation was
 * accepted, nothing more. Whether the message then reached a mailbox, bounced
 * or was marked as spam is only knowable from Resend, and only by id.
 *
 * Resend's SMTP password is an API key, so SMTP_PASS is the same credential
 * the REST API wants — but ours is a Sending-access key, and Resend answers
 * `restricted_api_key` to any read. A Full-access key in RESEND_API_KEY is
 * used in preference when one exists. Nothing is sent and nothing is changed
 * — this is a GET.
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
  const key = (process.env.RESEND_API_KEY ?? process.env.SMTP_PASS)?.trim();
  if (!key) throw new Error("Neither RESEND_API_KEY nor SMTP_PASS is set.");
  console.log(`Using ${process.env.RESEND_API_KEY?.trim() ? "RESEND_API_KEY" : "SMTP_PASS"}.\n`);
  if (!key.startsWith("re_")) {
    console.log("Note: that value does not look like a Resend API key (re_…). If this 401s, that is why.\n");
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
    // Resend says which of the two it is, and they have different fixes: a
    // key that is wrong, or a sending-only key that cannot read. Their error
    // body names neither the key nor any address, so it is safe to print.
    const why = await res.text().catch(() => "");
    console.log(`Resend refused the key (HTTP ${res.status}).`);
    if (why) console.log(`Its reason: ${why.slice(0, 300)}`);
    console.log(
      "\nA Resend key is either Full access or Sending access. Sending-access keys\n" +
      "can post a message and cannot read one back, which is what this needs. If\n" +
      "that is the reason, the fix is a second Full-access key saved as the\n" +
      "RESEND_API_KEY secret — not a change to SMTP_PASS, which is doing its job.",
    );
    process.exit(1);
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
