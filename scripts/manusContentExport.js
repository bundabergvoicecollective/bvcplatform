/**
 * Pulls the CONTENT out of Manus — performances, announcements, library,
 * gallery, documents — which the September import never covered.
 *
 * scripts/manusExport.js is the other half: it handles rehearsals,
 * attendance, orders, members and passes, all of which are now current. This
 * one is for the things that still stop in August and September, the latest
 * performance among them.
 *
 * Manus has no export and no API key, but its admin UI is a tRPC client, so
 * the same procedures can be called from its own console where the session
 * cookie already is. Every procedure used is a query: nothing here writes.
 *
 * Procedure names are tried from a list rather than assumed. The Manus copy
 * may be an older build of this codebase with different names, and one
 * renamed procedure should cost a line in the report rather than the whole
 * export.
 *
 * To run it: sign in to the Manus admin, open DevTools (Cmd+Option+J on a
 * Mac, F12 on Windows), paste the whole file, press Enter. It downloads
 * manus-content.json and prints what it found.
 */
(async () => {
  const call = async (proc, input) => {
    const q = encodeURIComponent(JSON.stringify({ json: input ?? null }));
    const r = await fetch(`/api/trpc/${proc}?input=${q}`, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j?.error) throw new Error(j.error?.json?.message ?? "error");
    return j?.result?.data?.json ?? j?.result?.data ?? j;
  };

  /** Try each candidate until one answers with an array. */
  const firstThatWorks = async (candidates) => {
    const tried = [];
    for (const proc of candidates) {
      try {
        const data = await call(proc);
        if (Array.isArray(data)) return { proc, data };
        tried.push(`${proc}: not a list`);
      } catch (err) {
        tried.push(`${proc}: ${err.message}`);
      }
    }
    return { proc: null, data: [], tried };
  };

  const WANTED = {
    performances: ["events.list", "events.all", "calendar.events"],
    announcements: ["announcements.list", "announcements.all"],
    library: ["library.list", "library.all", "libraryItems.list"],
    gallery: ["gallery.list", "gallery.feed", "gallery.posts", "gallery.all", "gallery.approved"],
    documents: ["documents.list", "documents.all"],
    liveStreams: ["liveStreams.list"],
    shopProducts: ["shop.products", "shop.list", "shop.listProducts"],
  };

  const out = { source: `manus:${location.host}`, exportedAt: new Date().toISOString(), found: {}, missing: {} };

  for (const [name, candidates] of Object.entries(WANTED)) {
    const { proc, data, tried } = await firstThatWorks(candidates);
    if (proc) {
      out[name] = data;
      out.found[name] = { procedure: proc, count: data.length };
      console.log(`${name}: ${data.length} from ${proc}`);
    } else {
      out.missing[name] = tried;
      console.warn(`${name}: could not fetch —`, tried.join(" | "));
    }
  }

  // The newest few dates of each, so the gap is obvious before the file is
  // even opened.
  for (const [name, rows] of Object.entries(out)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const dates = rows
      .map((r) => r.eventDate ?? r.createdAt ?? r.date ?? null)
      .filter(Boolean)
      .sort()
      .slice(-3);
    if (dates.length) console.log(`  ${name} newest:`, dates.join(", "));
  }

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "manus-content.json";
  a.click();
  console.log("Saved manus-content.json — attach that file.");
})();
