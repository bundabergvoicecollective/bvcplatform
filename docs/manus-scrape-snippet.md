# Getting data out of Manus without screenshots

Two routes. Try the first — if it works it gets everything in one go.

## Route 1: find the data behind the page (fastest)

Most apps of this kind fetch their rows as JSON and render them. If Manus does,
you can take the JSON directly instead of scraping tables.

1. On the Manus attendance (or payments) page, press **F12** — or
   **⌥⌘I** — to open DevTools
2. Click the **Network** tab
3. Tick **Fetch/XHR** to filter
4. **Reload the page** (⌘R)
5. Look down the list for a request whose name sounds like the data —
   `attendance`, `sessions`, `members`, `orders`, `payments`, or something
   under `/api/`
6. Click it, then the **Response** tab. If you see rows of JSON, that's it
7. Right-click the request → **Copy** → **Copy response**
8. Paste into a file and attach it here

**The trick that collapses "too many pages":** once you can see the request URL,
it usually has a paging parameter — `?page=1&limit=25` or similar. Open that URL
in a new tab with a much bigger limit (`&limit=1000`) and you'll often get every
row in one response.

## Route 2: scrape the tables from the page

If there's no obvious JSON, this collects tables as you click through the pages
and downloads the lot at the end. Nothing is sent anywhere; it all stays in your
browser until you download it.

Open DevTools → **Console** tab. Paste this **once per page**, after the table
has loaded:

```js
(() => {
  const rows = [];
  document.querySelectorAll("table").forEach((table) => {
    table.querySelectorAll("tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("th,td")].map((c) =>
        c.innerText.replace(/\s+/g, " ").trim(),
      );
      if (cells.some(Boolean)) rows.push(cells);
    });
  });
  const all = JSON.parse(localStorage.getItem("__bvc_scrape") || "[]");
  all.push({ url: location.href, at: new Date().toISOString(), rows });
  localStorage.setItem("__bvc_scrape", JSON.stringify(all));
  console.log(`captured ${rows.length} rows from this page; ${all.length} page(s) so far`);
})();
```

Click to the next page, paste again. Repeat. It tells you the running total each
time.

When you have been through every page, paste this **once** to download it:

```js
(() => {
  const all = JSON.parse(localStorage.getItem("__bvc_scrape") || "[]");
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "manus-export.json";
  a.click();
  console.log(`downloaded ${all.length} page(s)`);
})();
```

That puts `manus-export.json` in your Downloads folder. Attach it here.

To start over:

```js
localStorage.removeItem("__bvc_scrape");
```

## What is actually needed

Only two things, so don't capture more than this:

1. **The 6 October rehearsal** — who attended, and whether each used a pass, a
   single, or a complimentary session
2. **Payments since 26 September** — member, amount, method, date

Member names as Manus shows them are fine; they get matched to the 76 member
rows on this side.

## Then

Attach the file (or the JSON) here and the rest is automatic: it gets matched
against what is already in the database, and anything already present is left
alone rather than duplicated.

Attendance still goes in through the admin UI rather than straight into the
database — marking someone present deducts a pass session and writes an activity
log entry (`routers.ts:472`), and writing rows directly skips both. But with the
data in hand that becomes a checklist to work through, not a transcription job.
