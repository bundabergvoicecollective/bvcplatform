import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Banknote, ChevronDown, ChevronRight, Download, Info } from "lucide-react";
import { Fragment, useState } from "react";
import { format, parseISO } from "date-fns";

/**
 * The books: every payment, in Tuesday-to-Monday weeks.
 *
 * Rehearsal night opens the week rather than closing it, so money taken on a
 * Tuesday and money typed in on the Wednesday after sit together, which is
 * how they are counted.
 */

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dayLabel = (iso: string) => format(parseISO(iso), "d MMM");

/** The columns, in the order they are read. */
const COLUMNS = [
  { key: "cashCents", label: "Cash", tint: "oklch(0.45 0.1 75)" },
  { key: "eftCents", label: "EFT", tint: "oklch(0.45 0.1 275)" },
  { key: "onlineCents", label: "Online", tint: "oklch(0.40 0.12 185)" },
  { key: "otherCents", label: "Other", tint: "oklch(0.45 0.05 300)" },
  { key: "shopCents", label: "Shop", tint: "oklch(0.45 0.1 150)" },
  { key: "unrecordedCents", label: "Unrecorded", tint: "oklch(0.55 0.03 240)" },
] as const;

const CHANNEL_LABEL: Record<string, string> = {
  cash: "Cash",
  eft: "EFT",
  card: "Card",
  online: "Online",
  other: "Other",
  complimentary: "Comp",
  unrecorded: "Method not recorded",
};

export default function Financials() {
  const { user } = useAuth();
  const [weeks, setWeeks] = useState(16);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading } = trpc.payments.financials.useQuery(
    { weeks },
    { enabled: user?.role === "admin" },
  );

  if (user && user.role !== "admin") {
    return (
      <BVCLayout>
        <p className="text-sm" style={{ color: "oklch(0.45 0.03 240)" }}>
          Financials are for administrators.
        </p>
      </BVCLayout>
    );
  }

  const rows = data?.weeks ?? [];
  const grand = rows.reduce(
    (acc, w) => {
      for (const c of COLUMNS) acc[c.key] += w[c.key];
      acc.totalCents += w.totalCents;
      acc.compCount += w.compCount;
      return acc;
    },
    { cashCents: 0, eftCents: 0, onlineCents: 0, otherCents: 0, shopCents: 0, unrecordedCents: 0, totalCents: 0, compCount: 0 },
  );
  const anyUnrecorded = grand.unrecordedCents > 0;

  /** One row per payment, so it opens in a spreadsheet and reconciles by hand. */
  function downloadCsv() {
    const esc = (v: string | number | null) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [["Week starting", "Date", "Member", "What", "Method", "Amount"].join(",")];
    for (const w of rows) {
      for (const p of w.payments) {
        lines.push([
          w.weekStart,
          p.date,
          esc(p.memberName ?? ""),
          esc(p.label),
          CHANNEL_LABEL[p.channel] ?? p.channel,
          (p.amountCents / 100).toFixed(2),
        ].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bvc-financials-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <BVCLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <Banknote className="w-5 h-5" style={{ color: "oklch(0.55 0.1 75)" }} />
              Financials
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.45 0.03 240)" }}>
              Every payment, week by week. Weeks run Tuesday to Monday, so rehearsal
              night opens the week and the money typed in on Wednesday lands with it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border px-2 text-sm"
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              style={{ borderColor: "oklch(0.88 0.02 240)", color: "oklch(0.30 0.04 240)" }}
            >
              <option value={8}>Last 8 weeks</option>
              <option value={16}>Last 16 weeks</option>
              <option value={52}>Last year</option>
              <option value={104}>Everything</option>
            </select>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!rows.length}>
              <Download className="w-4 h-4 mr-1.5" /> CSV
            </Button>
          </div>
        </div>

        {anyUnrecorded && (
          <div
            className="flex gap-2 rounded-lg p-3 text-sm"
            style={{ background: "oklch(0.96 0.02 240)", color: "oklch(0.35 0.04 240)" }}
          >
            <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }} />
            <p className="leading-snug">
              <strong>{money(grand.unrecordedCents)}</strong> sits under “Unrecorded”. Those
              payments were entered before the form asked how the money arrived
              {data?.firstChannelDate ? ` (${dayLabel(data.firstChannelDate)})` : ""}, so
              cash and EFT cannot be told apart for them. They are counted in the
              totals — only the split is unknown, and guessing would be worse than
              saying so.
            </p>
          </div>
        )}

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
              {isLoading ? "Loading…" : `${rows.length} week${rows.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "oklch(0.52 0.03 240)" }}>
                    <th className="text-left font-medium px-4 py-2">Week</th>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="text-right font-medium px-3 py-2 whitespace-nowrap">{c.label}</th>
                    ))}
                    <th className="text-right font-medium px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => {
                    const isOpen = open === w.weekStart;
                    return (
                      <Fragment key={w.weekStart}>
                        <tr
                          className="border-t cursor-pointer hover:bg-black/[0.02]"
                          style={{ borderColor: "oklch(0.93 0.01 240)" }}
                          onClick={() => setOpen(isOpen ? null : w.weekStart)}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {isOpen
                                ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "oklch(0.60 0.03 240)" }} />
                                : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "oklch(0.60 0.03 240)" }} />}
                              <div className="min-w-0">
                                <div className="font-medium whitespace-nowrap" style={{ color: "oklch(0.25 0.05 240)" }}>
                                  {dayLabel(w.weekStart)} – {dayLabel(w.weekEnd)}
                                </div>
                                {w.sessionTitle && (
                                  <div className="text-xs truncate" style={{ color: "oklch(0.58 0.03 240)" }}>
                                    {w.sessionTitle}
                                    {w.compCount > 0 && ` · ${w.compCount} comp`}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          {COLUMNS.map((c) => (
                            <td
                              key={c.key}
                              className="text-right px-3 py-2.5 tabular-nums whitespace-nowrap"
                              style={{ color: w[c.key] ? c.tint : "oklch(0.80 0.01 240)" }}
                            >
                              {w[c.key] ? money(w[c.key]) : "–"}
                            </td>
                          ))}
                          <td className="text-right px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap" style={{ color: "oklch(0.22 0.07 240)" }}>
                            {money(w.totalCents)}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr style={{ background: "oklch(0.98 0.005 240)" }}>
                            <td colSpan={COLUMNS.length + 2} className="px-4 py-3">
                              {w.payments.length === 0 ? (
                                <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                                  Nothing was taken this week.
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {w.payments.map((p) => (
                                    <li key={`${p.kind}-${p.id}`} className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-xs shrink-0 tabular-nums" style={{ color: "oklch(0.58 0.03 240)" }}>
                                          {dayLabel(p.date)}
                                        </span>
                                        <span
                                          className="text-xs px-1.5 py-0.5 rounded shrink-0 font-medium"
                                          style={{ background: "oklch(0.95 0.01 240)", color: "oklch(0.40 0.04 240)" }}
                                        >
                                          {CHANNEL_LABEL[p.channel] ?? p.channel}
                                        </span>
                                        <span className="truncate" style={{ color: "oklch(0.30 0.04 240)" }}>
                                          {p.memberName ?? "Unknown member"}
                                        </span>
                                        <span className="text-xs truncate" style={{ color: "oklch(0.58 0.03 240)" }}>
                                          {p.label}
                                        </span>
                                      </div>
                                      <span
                                        className="shrink-0 tabular-nums font-medium"
                                        style={{ color: p.channel === "complimentary" ? "oklch(0.52 0.12 150)" : "oklch(0.30 0.04 240)" }}
                                      >
                                        {p.channel === "complimentary" ? "Comp" : money(p.amountCents)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2" style={{ borderColor: "oklch(0.88 0.02 240)" }}>
                      <td className="px-4 py-3 font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                        Total
                        {grand.compCount > 0 && (
                          <span className="font-normal text-xs ml-2" style={{ color: "oklch(0.58 0.03 240)" }}>
                            {grand.compCount} complimentary, not counted
                          </span>
                        )}
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="text-right px-3 py-3 font-semibold tabular-nums whitespace-nowrap" style={{ color: c.tint }}>
                          {grand[c.key] ? money(grand[c.key]) : "–"}
                        </td>
                      ))}
                      <td className="text-right px-4 py-3 font-bold tabular-nums whitespace-nowrap" style={{ color: "oklch(0.22 0.07 240)" }}>
                        {money(grand.totalCents)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {!isLoading && rows.length === 0 && (
              <p className="px-4 py-6 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                No payments recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </BVCLayout>
  );
}
