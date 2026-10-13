# Exporting member addresses for a mail merge

For sending the invitation yourself — the platform has no bulk email, so the
list has to come out and go into Gmail, Mailchimp or whatever you send with.

**It has to come out through your own browser.** This repository is public and
so are its Actions logs, so no workflow here may print member addresses; the
audits mask them for that reason. The snippet below runs in your signed-in
admin session, asks the site for the member list, and saves a CSV to your
Downloads folder. Nothing is sent anywhere.

## Do this

1. Open **https://members.bundabergvoicecollective.com.au** and sign in as admin
2. **F12** (Windows) or **⌥⌘I** (Mac) → the **Console** tab
3. Paste the whole block, press Enter
4. `bvc-members.csv` lands in Downloads

```js
(async () => {
  // members.list is an adminProcedure, so this only works signed in as admin.
  const input = encodeURIComponent(JSON.stringify({ 0: { json: null } }));
  const res = await fetch(`/api/trpc/members.list?batch=1&input=${input}`, { credentials: "include" });
  if (!res.ok) throw new Error(`members.list → HTTP ${res.status}`);
  const body = await res.json();
  const slot = Array.isArray(body) ? body[0] : body;
  const rows = slot?.result?.data?.json ?? slot?.result?.data ?? [];
  if (!Array.isArray(rows) || !rows.length) throw new Error("No members came back.");

  // getAllMembers already excludes pending and denied, so this is the people
  // to write to and nobody else.
  const people = rows.filter((m) => m.email && m.email.trim());
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    "email,firstName,lastName,name,hasPassword",
    ...people.map((m) =>
      [m.email.trim(), m.firstName ?? "", m.lastName ?? "", m.name ?? "", m.passwordHash ? "yes" : "no"]
        .map(esc)
        .join(","),
    ),
  ].join("\n");

  const missingName = people.filter((m) => !m.firstName).length;
  console.log(`${people.length} members with an address. ${missingName} have no first name.`);

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "bvc-members.csv";
  a.click();
})();
```

## What you get

| Column | Use |
| --- | --- |
| `email` | the merge field to send to |
| `firstName` | for "Hi Margaret" — **a few are blank**, so give the merge a fallback like "there", or the email opens with "Hi ," |
| `lastName`, `name` | for checking the list reads like the choir you know |
| `hasPassword` | `no` for nearly everyone. The few `yes` rows have already set one |

The count should be **72**, not 76. The four denied rows are stray public
sign-ups, not members, and `getAllMembers` leaves them out — see
`docs/migration-status.md`.

## When you send it

- **BCC, always.** 72 addresses in the To or CC field shows every member every
  other member's address, which is a privacy breach you cannot take back.
- Tell them to go to the site and use **"Set up / forgot password"** — do not
  try to send them a link yourself. Each member's link expires in an hour and
  works once, so a link mailed at 8pm is dead by morning. Them requesting it
  starts their own clock.
- There is a two-minute limit per member on requesting a link, and the page
  says the same thing whether or not it sent, so "I didn't get it" means check
  spam first.
