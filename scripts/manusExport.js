/**
 * Pulls the post-snapshot delta out of Manus, for scripts/importManusDelta.ts.
 *
 * Manus has no export and no API key. Its admin UI is a tRPC client, though,
 * so the same procedures it calls can be called from its own console, where
 * the session cookie already exists. Nothing here writes: every procedure
 * used is a query.
 *
 * To run it: sign in to the Manus admin, open DevTools (Cmd+Option+J), paste
 * the whole file, press Enter. It downloads manus-delta.json. Hand that file
 * to importManusDelta.ts.
 *
 * The cutoffs below are the dates this database was already current to on
 * 29 September 2026. Widen them (earlier dates) to re-export more; the
 * importer skips anything it already has, so overlap is harmless.
 */
const CUTOFFS = {
  sessions: "2026-09-30", // newest rehearsal already imported: 29 Sep
  orders: "2026-09-26", // newest pass order already imported: 26 Sep
  members: "2026-09-15", // newest member already imported: 15 Sep
};

(async () => {
  const call = async (proc, input) => {
    const q = encodeURIComponent(JSON.stringify({ json: input ?? null }));
    const r = await fetch(`/api/trpc/${proc}?input=${q}`, { credentials: "include" });
    if (!r.ok) throw new Error(`${proc} returned ${r.status}`);
    const j = await r.json();
    return j?.result?.data?.json ?? j?.result?.data ?? j;
  };
  const after = (iso, cutoff) => new Date(iso) > new Date(`${cutoff}T00:00:00Z`);

  const allSessions = await call("sessions.list");
  const sessions = allSessions.filter((s) => after(s.sessionDate, CUTOFFS.sessions));

  const attendance = [];
  for (const s of sessions) {
    for (const a of await call("attendance.forSession", { sessionId: s.id })) {
      if (!a.attended) continue;
      attendance.push({
        sessionId: a.sessionId, userEmail: a.userEmail, userName: a.userName,
        attended: a.attended, passUsed: a.passUsed, sessionType: a.sessionType, markedAt: a.markedAt,
      });
    }
  }

  const orders = (await call("payments.allOrders"))
    .filter((o) => after(o.createdAt, CUTOFFS.orders))
    .map((o) => ({
      manusId: o.id, userEmail: o.userEmail, paymentSessionId: o.paymentSessionId,
      passType: o.passType, sessionCount: o.sessionCount, amountCents: o.amountCents,
      currency: o.currency, status: o.status, paymentMethod: o.paymentMethod,
      notes: o.notes, createdAt: o.createdAt,
    }));

  const allMembers = await call("members.list");
  const members = allMembers
    .filter((m) => after(m.createdAt, CUTOFFS.members))
    .map((m) => ({ email: m.email, name: m.name, firstName: m.firstName, lastName: m.lastName,
      voicePart: m.voicePart, memberSince: m.memberSince, status: m.status, createdAt: m.createdAt }));

  // Every active pass, not just new ones: a pass issued in August was still
  // being deducted in October, so its balance here is the one that matters.
  const activePasses = [];
  for (const m of allMembers) {
    const p = await call("passes.activeForUser", { userId: m.id });
    if (!p?.assignedAt) continue;
    activePasses.push({ userEmail: m.email, totalSessions: p.totalSessions,
      remainingSessions: p.remainingSessions, assignedAt: p.assignedAt, active: !!p.active });
  }

  const delta = { source: "manus:bundavoice-k8a8akbx", exportedAt: new Date().toISOString(),
    cutoffs: CUTOFFS, sessions: sessions.map((s) => ({ manusId: s.id, title: s.title,
      sessionDate: s.sessionDate, notes: s.notes, createdAt: s.createdAt })),
    attendance, orders, members, activePasses };

  const url = URL.createObjectURL(new Blob([JSON.stringify(delta, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "manus-delta.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  console.log("manus-delta.json", { sessions: sessions.length, attendance: attendance.length,
    orders: orders.length, members: members.length, activePasses: activePasses.length });
})();
