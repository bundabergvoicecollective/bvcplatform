# Getting the data out, without screenshots or paging

The app's API is tRPC, and the procedure names are known from `routers.ts`. So
rather than scraping rendered pages, ask the API for everything in one go. The
request carries your existing session cookie, so being signed in is all the
authentication needed.

Confirmed on 13 Oct 2026: the Manus copy at `bundavoice-k8a8akbx.manus.space`
runs this same codebase — its network traffic shows the same tRPC procedures
(`auth.me`, `sessions.list`, `notifications.unread`) — so these calls apply to it
unchanged.

## Do this

1. Open the Manus site and **sign in as an admin** (several of these procedures
   are admin-only)
2. **F12** (or **⌥⌘I**) → **Console** tab
3. Paste the whole block below and press Enter
4. Wait — it fetches every rehearsal's attendance one at a time and logs its
   progress
5. It downloads `bvc-export.json`. Attach that here

```js
(async () => {
  const enc = (o) => encodeURIComponent(JSON.stringify(o));

  // tRPC queries go over GET as ?batch=1&input={"0":{"json":<input>}}, and the
  // superjson transformer wraps the reply the same way. Unwrap defensively, so
  // a different transformer setting still yields something usable.
  const get = async (proc, input) => {
    const url = `/api/trpc/${proc}?batch=1&input=${enc({ 0: { json: input ?? null } })}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`${proc} → HTTP ${res.status}`);
    const body = await res.json();
    const slot = Array.isArray(body) ? body[0] : body;
    if (slot?.error) throw new Error(`${proc} → ${slot.error?.json?.message ?? "error"}`);
    return slot?.result?.data?.json ?? slot?.result?.data ?? slot;
  };

  const out = { takenAt: new Date().toISOString(), origin: location.origin };

  try {
    console.log("members…");
    out.members = await get("members.list");

    console.log("rehearsals…");
    out.sessions = await get("sessions.list");

    console.log("pass orders…");
    out.passOrders = await get("payments.allOrders");

    out.attendance = {};
    for (const s of out.sessions ?? []) {
      console.log(`attendance for #${s.id} — ${s.title ?? ""}`);
      out.attendance[s.id] = await get("attendance.forSession", { sessionId: s.id });
    }

    console.log(
      `done: ${out.members?.length ?? 0} members, ${out.sessions?.length ?? 0} rehearsals, ` +
        `${out.passOrders?.length ?? 0} pass orders`,
    );
  } catch (err) {
    console.error("STOPPED:", err.message);
    out.error = err.message;
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bvc-export.json";
  a.click();
})();
```

Nothing is sent anywhere — the fetches go to the site you are already on, and
the file saves to your Downloads folder.

## If it stops

- **`HTTP 401` or `403`** — not signed in as an admin on that origin, or that
  copy does not expose these procedures
- **`HTTP 404`** — the API is not at `/api/trpc` on that host. Find the real
  path: DevTools → **Network** → **Fetch/XHR** → reload → click any request
  whose name contains a dot (like `auth.me,sessions.list`) → **Headers** →
  **Request URL**. Send me that URL and I will adjust the snippet.
- **Anything else** — paste the console output here.

It downloads the file either way, including whatever it managed to collect
before stopping, so a partial result is still worth attaching.

## What happens next

Attached here, the file gets diffed against the live database: which rehearsals
are missing, who attended each, and which pass orders differ in status. The
output is a worked checklist with anything already recorded filtered out.

Attendance still goes in through the admin UI rather than straight into the
database — marking someone present deducts a pass session and writes an activity
log entry (`routers.ts:472`), and inserting rows skips both. But that becomes
ticking a prepared list rather than reading two systems at once.
