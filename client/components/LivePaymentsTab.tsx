import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Smartphone, Globe, Banknote, ExternalLink, RefreshCw, Clock3 } from "lucide-react";
import { toast } from "sonner";

/**
 * Live payments — Square's record, as it lands.
 *
 * Asks Square every ten seconds while this tab is open and the screen is on;
 * stops when the tab is closed or the phone is locked, so it is not quietly
 * polling Square all night from a forgotten browser. A new payment slides in
 * highlighted and raises a toast, so on a rehearsal night the person at the
 * door sees a tap land without refreshing anything.
 *
 * Each payment says what the platform has made of it. "Recorded" names the
 * member and the pass. "Not recorded yet" is a card tap the platform could not
 * match by itself — usually because the reader collected no email — and says
 * what it most likely bought and where to record it. This screen never
 * credits anything on its own: deciding whose tap it was is for a person,
 * from the member's row, where the duplicate check lives.
 */

const NAVY = "oklch(0.22 0.07 240)";
const MUTED = "oklch(0.52 0.03 240)";
const POLL_MS = 10_000;

const PASS_LABEL: Record<string, string> = { "single": "single session", "5-pass": "5-pass", "10-pass": "10-pass" };
const HOW_LABEL: Record<string, string> = {
  checkout: "paid through the app",
  matched: "matched by email automatically",
  "by hand": "recorded by an admin",
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const brisTime = (iso: string, withDate: boolean) =>
  new Date(iso).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    ...(withDate ? { weekday: "short", day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });

function secondsAgo(iso: string | undefined, now: number) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

export default function LivePaymentsTab() {
  const [days, setDays] = useState<1 | 7>(1);
  const [now, setNow] = useState(Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  const q = trpc.payments.liveSquare.useQuery(
    { days },
    {
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  );

  // A ticking clock for "updated 4s ago", without refetching anything.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Spot payments that were not there last time. The first load only fills
  // the memory — announcing every payment of the day on opening the tab would
  // make the alert mean nothing.
  useEffect(() => {
    const list = q.data?.payments;
    if (!list) return;
    if (seen.current === null) {
      seen.current = new Set(list.map((p) => p.id));
      return;
    }
    const arrived = list.filter((p) => !seen.current!.has(p.id));
    if (!arrived.length) return;
    for (const p of arrived) seen.current.add(p.id);
    setFresh(new Set(arrived.map((p) => p.id)));
    for (const p of arrived.slice(0, 3)) {
      const what = p.status === "COMPLETED" ? "New Square payment" : `Square payment ${p.status.toLowerCase()}`;
      toast(`${what} — ${money(p.amountCents)}`, {
        description: p.match ? p.match.memberName : p.status === "COMPLETED" ? "Not recorded yet" : undefined,
      });
    }
    const t = setTimeout(() => setFresh(new Set()), 8000);
    return () => clearTimeout(t);
  }, [q.data]);

  // Switching range starts the memory again.
  useEffect(() => {
    seen.current = null;
  }, [days]);

  const data = q.data;
  const rows = data?.payments ?? [];

  return (
    <div className="space-y-4">
      {/* Header: live indicator and range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2.5">
            {!q.error && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60 motion-safe:animate-ping" />}
            <span className={`relative inline-flex size-2.5 rounded-full ${q.error ? "bg-red-500" : "bg-emerald-500"}`} />
          </span>
          <p className="text-sm font-semibold" style={{ color: NAVY }}>
            {q.error ? "Not connected to Square" : "Live from Square"}
          </p>
          {data && !q.error && (
            <span className="text-xs" style={{ color: MUTED }}>
              · updated {secondsAgo(data.fetchedAt, now)}
            </span>
          )}
          {q.isFetching && <RefreshCw className="size-3.5 animate-spin" style={{ color: MUTED }} />}
        </div>
        <div className="inline-flex rounded-full p-1 bg-[oklch(0.94_0.006_250)]">
          {([1, 7] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`h-9 px-4 rounded-full text-sm font-medium transition-colors ${days === d ? "bg-white shadow-sm" : ""}`}
              style={{ color: days === d ? NAVY : MUTED }}
            >
              {d === 1 ? "Today" : "Last 7 days"}
            </button>
          ))}
        </div>
      </div>

      {q.error && (
        <Card className="border-0">
          <CardContent className="py-4 text-sm" style={{ color: "oklch(0.45 0.15 27)" }}>
            {q.error.message} — it will keep trying every ten seconds.
          </CardContent>
        </Card>
      )}

      {/* Totals */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card className="border-0 py-0 gap-0">
            <CardContent className="p-4">
              <p className="text-[1.6rem] leading-none font-bold tabular-nums" style={{ color: NAVY }}>{money(data.totals.completedCents)}</p>
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                taken in Square {days === 1 ? "today" : "in 7 days"}
              </p>
            </CardContent>
          </Card>
          <Card className="border-0 py-0 gap-0">
            <CardContent className="p-4">
              <p className="text-[1.6rem] leading-none font-bold tabular-nums" style={{ color: NAVY }}>{data.totals.completedCount}</p>
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>completed payment{data.totals.completedCount === 1 ? "" : "s"}</p>
            </CardContent>
          </Card>
          <Card className="border-0 py-0 gap-0 col-span-2 sm:col-span-1" style={data.totals.needsRecording ? { background: "oklch(0.97 0.04 80)" } : undefined}>
            <CardContent className="p-4">
              <p className="text-[1.6rem] leading-none font-bold tabular-nums" style={{ color: data.totals.needsRecording ? "oklch(0.45 0.13 70)" : NAVY }}>
                {data.totals.needsRecording}
              </p>
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>not recorded on the platform yet</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* The feed */}
      {q.isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl shimmer bg-gray-100" />)}</div>
      ) : !rows.length && !q.error ? (
        <Card className="border-0">
          <CardContent className="py-12 text-center">
            <Clock3 className="size-9 mx-auto mb-3" style={{ color: "oklch(0.78 0.17 75)" }} />
            <p className="font-medium" style={{ color: NAVY }}>No Square payments {days === 1 ? "yet today" : "in the last 7 days"}</p>
            <p className="text-sm mt-1" style={{ color: MUTED }}>Leave this open — a payment appears here within ten seconds of Square taking it.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((p) => {
            const done = p.status === "COMPLETED";
            const isFresh = fresh.has(p.id);
            const ChannelIcon = p.channel === "reader" ? Smartphone : p.channel === "online" ? Globe : Banknote;
            const channelLabel =
              p.channel === "reader" ? "Tapped on the reader" : p.channel === "online" ? "Paid online" : p.channel === "cash" ? "Cash in Square" : "Other";
            return (
              <Card
                key={p.id}
                className={`border-0 py-0 gap-0 overflow-hidden ${isFresh ? "ring-2 ring-emerald-400 motion-safe:animate-slide-up" : ""}`}
              >
                <CardContent className="p-4 flex gap-3.5">
                  <div
                    className="size-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: done ? "oklch(0.95 0.04 160)" : "oklch(0.95 0.01 250)" }}
                  >
                    <ChannelIcon className="size-5" style={{ color: done ? "oklch(0.45 0.11 160)" : MUTED }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-lg font-bold tabular-nums" style={{ color: done ? NAVY : MUTED }}>
                        {money(p.amountCents)}
                      </span>
                      <span className="text-sm" style={{ color: MUTED }}>{brisTime(p.createdAt, days > 1)}</span>
                      {!done && (
                        <Badge variant="outline" style={{ color: p.status === "FAILED" || p.status === "CANCELED" ? "oklch(0.5 0.18 25)" : MUTED }}>
                          {p.status === "FAILED" ? "Declined" : p.status === "CANCELED" ? "Cancelled" : p.status.toLowerCase()}
                        </Badge>
                      )}
                      {isFresh && <Badge className="bg-emerald-500 text-white border-0">New</Badge>}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                      {channelLabel}
                      {p.cardBrand && p.last4 ? ` · ${p.cardBrand.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} •••• ${p.last4}` : ""}
                      {p.buyerEmail ? ` · ${p.buyerEmail}` : ""}
                    </p>

                    {/* What the platform has made of it */}
                    {done && p.match && p.match.status === "paid" && (
                      <p className="mt-2 text-sm flex items-start gap-1.5" style={{ color: "oklch(0.40 0.11 160)" }}>
                        <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                        <span>
                          Recorded for <strong>{p.match.memberName}</strong> — {PASS_LABEL[p.match.detail] ?? p.match.detail}, {HOW_LABEL[p.match.how]}
                        </span>
                      </p>
                    )}
                    {done && p.match && p.match.status !== "paid" && (
                      <p className="mt-2 text-sm flex items-start gap-1.5" style={{ color: "oklch(0.45 0.13 70)" }}>
                        <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                        <span>
                          Paid in Square, but {p.match.memberName}'s order still says <strong>{p.match.status}</strong>. It usually
                          catches up within a minute; if it doesn't, use <strong>Sync pending orders</strong> on Pass Payments.
                        </span>
                      </p>
                    )}
                    {done && !p.match && (
                      <div className="mt-2 rounded-xl px-3 py-2 text-sm" style={{ background: "oklch(0.97 0.04 80)", color: "oklch(0.40 0.11 70)" }}>
                        <p className="flex items-start gap-1.5 font-semibold">
                          <AlertTriangle className="size-4 mt-0.5 shrink-0" /> Not recorded on the platform yet
                        </p>
                        <p className="mt-1 leading-snug">
                          {p.looksLike ? <>Looks like a <strong>{PASS_LABEL[p.looksLike]}</strong>. </> : null}
                          Record it from the member's row: <strong>Members → Record Payment → Card / EFTPOS on the Square reader</strong>.
                        </p>
                      </div>
                    )}
                  </div>

                  {p.receiptUrl && (
                    <Button asChild variant="ghost" size="icon-sm" className="shrink-0 -mr-1" aria-label="Open the Square receipt">
                      <a href={p.receiptUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs" style={{ color: MUTED }}>
        Straight from Square, refreshed every ten seconds while this tab is open. Times are Brisbane.
        This screen never records a payment itself.
      </p>
    </div>
  );
}
