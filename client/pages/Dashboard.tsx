import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calendar,
  CreditCard,
  Bell,
  Megaphone,
  Users,
  Music2,
  MessageCircle,
  AlertTriangle,
  CalendarDays,
  Mic2,
  Radio,
  PartyPopper,
  Plus,
  Banknote,
  X,
} from "lucide-react";
import { format, isAfter, isBefore, addDays } from "date-fns";
import { toast } from "sonner";
import { getDisplayName } from "@shared/const";

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  accent?: string;
  href?: string;
}) {
  const inner = (
    <CardContent className="p-5 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: accent ?? "oklch(0.94 0.01 240)" }}
      >
        <Icon className="w-5 h-5" style={{ color: accent ? "white" : "oklch(0.55 0.14 185)" }} />
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color: "oklch(0.18 0.04 240)" }}>
          {value}
        </p>
        <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
          {label}
        </p>
      </div>
      {href && (
        <div className="ml-auto shrink-0 opacity-40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "oklch(0.35 0.04 240)" }}><path d="M9 18l6-6-6-6"/></svg>
        </div>
      )}
    </CardContent>
  );
  if (href) {
    return (
      <a href={href} className="block">
        <Card className="border-0 shadow-sm cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]">
          {inner}
        </Card>
      </a>
    );
  }
  return (
    <Card className="border-0 shadow-sm">
      {inner}
    </Card>
  );
}

function passTypeLabel(passType: string): string {
  if (passType === "10-pass") return "10-Pass ($140)";
  if (passType === "5-pass") return "5-Pass ($75)";
  if (passType === "single") return "Single Session ($16)";
  if (passType === "10-pass-comp") return "10-Pass (Comp)";
  if (passType === "5-pass-comp") return "5-Pass (Comp)";
  if (passType === "single-comp") return "Single (Comp)";
  if (passType === "custom-carryover") return "Carry-over";
  return passType;
}

function squareNoteLabel(note: string | null): string {
  if (!note) return "Square payment";
  // Parse our structured note format: "user_id:1|pass_product_key:single|session_count:1"
  const parts = Object.fromEntries(
    note.split("|").map((p) => p.split(":") as [string, string])
  );
  const key = parts["pass_product_key"];
  if (key) return passTypeLabel(key);
  return note;
}

function IncomeWidget() {
  const utils = trpc.useUtils();
  const { data: income, isLoading } = trpc.dashboard.lastSessionIncome.useQuery();
  const { data: members } = trpc.members.list.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [passType, setPassType] = useState<string>("10-pass");
  const [notes, setNotes] = useState("");

  const recordCash = trpc.members.recordCashPayment.useMutation({
    onSuccess: () => {
      toast.success("Cash payment recorded and pass assigned.");
      utils.dashboard.lastSessionIncome.invalidate();
      setShowForm(false);
      setSelectedUserId("");
      setPassType("10-pass");
      setNotes("");
    },
    onError: (e) => toast.error(e.message),
  });

  const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  const sortedMembers = [...(members ?? [])].sort((a, b) => {
    const aName = `${a.firstName ?? ""} ${a.lastName ?? ""}`.trim() || a.name || "";
    const bName = `${b.firstName ?? ""} ${b.lastName ?? ""}`.trim() || b.name || "";
    return aName.localeCompare(bName);
  });

  if (isLoading) {
    return <div className="h-48 rounded-xl bg-gray-100 animate-pulse" />;
  }

  if (!income) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>No session data yet.</p>
        </CardContent>
      </Card>
    );
  }

  const allPayments: { label: string; amount: number; method: string; email?: string | null }[] = [
    ...income.squarePayments.map((p) => ({
      label: squareNoteLabel(p.note),
      amount: p.amountCents,
      method: p.sourceType === "CASH" ? "Cash (Square)" : "Square",
      email: p.buyerEmail,
    })),
    ...income.cashOrders.map((o) => ({
      label: passTypeLabel(o.passType),
      amount: o.amountCents,
      method: "Cash / EFTPOS",
      email: o.userEmail,
    })),
    ...income.compOrders.map((o) => ({
      label: passTypeLabel(o.passType) + " (Comp)",
      amount: 0,
      method: "Complimentary",
      email: o.userEmail,
    })),
  ];

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
            <Banknote className="w-4 h-4" style={{ color: "oklch(0.55 0.1 75)" }} />
            Last Rehearsal — Income
          </CardTitle>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
          >
            {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showForm ? "Cancel" : "Record Cash"}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Session info + total */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>{income.sessionTitle}</p>
            <p className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
              {format(new Date(income.sessionDate), "EEEE, d MMMM yyyy")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-extrabold leading-none" style={{ color: "oklch(0.55 0.1 75)" }}>
              {formatCents(income.grandTotalCents)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }}>
              {formatCents(income.squareTotalCents)} Square + {formatCents(income.cashTotalCents)} cash
            </p>
          </div>
        </div>

        {/* Cash recording form */}
        {showForm && (
          <div
            className="rounded-xl p-4 space-y-3 border"
            style={{ background: "oklch(0.98 0.01 240)", borderColor: "oklch(0.90 0.02 240)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "oklch(0.45 0.12 185)" }}>
              Record Cash / EFTPOS Payment
            </p>
            <div className="space-y-2">
              <Label className="text-xs" style={{ color: "oklch(0.35 0.04 240)" }}>Member</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select member..." />
                </SelectTrigger>
                <SelectContent>
                  {sortedMembers.map((m) => {
                    const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.name || "Unknown";
                    return (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs" style={{ color: "oklch(0.35 0.04 240)" }}>Pass Type</Label>
              <Select value={passType} onValueChange={setPassType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10-pass">10-Pass ($140.00)</SelectItem>
                  <SelectItem value="5-pass">5-Pass ($75.00)</SelectItem>
                  <SelectItem value="single">Single Session ($16.00)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs" style={{ color: "oklch(0.35 0.04 240)" }}>Notes (optional)</Label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. Paid at door with cash"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!selectedUserId || recordCash.isPending}
              onClick={() =>
                recordCash.mutate({
                  userId: Number(selectedUserId),
                  passType: passType as "10-pass" | "5-pass" | "single",
                  notes: notes || undefined,
                })
              }
              style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            >
              {recordCash.isPending ? "Saving..." : "Save Payment"}
            </Button>
          </div>
        )}

        {/* Payment list */}
        {allPayments.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "oklch(0.52 0.03 240)" }}>
              Transactions
            </p>
            <ul className="space-y-1.5">
              {allPayments.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded shrink-0 font-medium"
                      style={{
                        background: p.method === "Square" || p.method === "Cash (Square)"
                          ? "oklch(0.94 0.03 185)"
                          : p.method === "Complimentary"
                          ? "oklch(0.94 0.03 150)"
                          : "oklch(0.94 0.03 75)",
                        color: p.method === "Square" || p.method === "Cash (Square)"
                          ? "oklch(0.35 0.14 185)"
                          : p.method === "Complimentary"
                          ? "oklch(0.35 0.14 150)"
                          : "oklch(0.45 0.1 75)",
                      }}
                    >
                      {p.method}
                    </span>
                    <span className="truncate" style={{ color: "oklch(0.35 0.04 240)" }}>
                      {p.email ?? p.label}
                    </span>
                    {p.email && (
                      <span className="text-xs truncate" style={{ color: "oklch(0.60 0.03 240)" }}>
                        {p.label}
                      </span>
                    )}
                  </div>
                  <span className="font-semibold shrink-0" style={{ color: p.amount > 0 ? "oklch(0.45 0.1 75)" : "oklch(0.52 0.12 150)" }}>
                    {p.amount > 0 ? formatCents(p.amount) : "Comp"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
            No payments recorded for this session yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AdminDashboard() {
  const { data: stats, isLoading } = trpc.dashboard.adminStats.useQuery();
  const { data: lastSession } = trpc.attendance.lastSessionStats.useQuery();
  const { data: expiredPasses } = trpc.dashboard.expiredPasses.useQuery();
  const { data: lowPasses } = trpc.dashboard.lowPasses.useQuery();
  const { data: calendarEvents } = trpc.calendar.events.useQuery();

  // Sort expired passes alphabetically
  const sortedExpired = [...(expiredPasses ?? [])].sort((a, b) => {
    const aFirst = (a.firstName ?? a.name ?? "").toLowerCase();
    const bFirst = (b.firstName ?? b.name ?? "").toLowerCase();
    const aLast = (a.lastName ?? "").toLowerCase();
    const bLast = (b.lastName ?? "").toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    return aLast.localeCompare(bLast);
  });

  // Sort low passes by sessions remaining (lowest first), then alphabetically
  const sortedLow = [...(lowPasses ?? [])].sort((a, b) => {
    if (a.remainingSessions !== b.remainingSessions) return a.remainingSessions - b.remainingSessions;
    const aFirst = (a.firstName ?? a.name ?? "").toLowerCase();
    const bFirst = (b.firstName ?? b.name ?? "").toLowerCase();
    return aFirst.localeCompare(bFirst);
  });

  // Upcoming calendar events: next 60 days, sorted by date
  const now = new Date();
  const cutoff = addDays(now, 60);
  const upcomingEvents = [...(calendarEvents ?? [])]
    .filter((e) => {
      const d = new Date(e.date);
      return isAfter(d, now) && isBefore(d, cutoff);
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 8);

  const eventTypeIcon = (type: string) => {
    if (type === "rehearsal") return <Mic2 className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.55 0.14 185)" }} />;
    if (type === "stream") return <Radio className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.65 0.12 185)" }} />;
    if (type === "birthday") return <PartyPopper className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.78 0.17 75)" }} />;
    return <CalendarDays className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.45 0.1 240)" }} />;
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <div>
        <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
          Admin Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
          Overview of Bundaberg Voice Collective
        </p>
      </div>

      {/* Top stats row */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Total Members"
            value={stats?.totalMembers ?? 0}
            accent="oklch(0.22 0.07 240)"
          />
          <StatCard
            icon={Calendar}
            label="Sessions Held"
            value={stats?.totalSessions ?? 0}
            accent="oklch(0.55 0.14 185)"
          />
          <StatCard
            icon={Music2}
            label="Library Items"
            value={stats?.totalLibraryItems ?? 0}
            accent="oklch(0.78 0.17 75)"
          />
          <StatCard
            icon={Megaphone}
            label="Announcements"
            value={stats?.totalAnnouncements ?? 0}
            accent="oklch(0.65 0.12 185)"
          />
        </div>
      )}

      {/* Last Rehearsal: Attendance + Income side by side */}
      {lastSession && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Attendance widget */}
          <Card className="border-0 shadow-sm" style={{ background: "oklch(0.97 0.02 185)" }}>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "oklch(0.45 0.12 185)" }}>
                Last Rehearsal — Attendance
              </p>
              <p className="font-semibold text-sm mb-0.5" style={{ color: "oklch(0.22 0.07 240)" }}>
                {lastSession.sessionTitle}
              </p>
              <p className="text-xs mb-4" style={{ color: "oklch(0.52 0.03 240)" }}>
                {format(new Date(lastSession.sessionDate), "EEEE, d MMMM yyyy")}
              </p>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-4xl font-extrabold leading-none" style={{ color: "oklch(0.35 0.14 185)" }}>
                    {lastSession.total}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>total</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "oklch(0.45 0.12 185)" }}>Pass</span>
                    <span className="font-semibold" style={{ color: "oklch(0.35 0.14 185)" }}>{lastSession.passCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "oklch(0.55 0.1 75)" }}>Single</span>
                    <span className="font-semibold" style={{ color: "oklch(0.55 0.1 75)" }}>{lastSession.singleCount}</span>
                  </div>
                  {lastSession.complimentaryCount > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: "oklch(0.52 0.12 150)" }}>Comp.</span>
                      <span className="font-semibold" style={{ color: "oklch(0.52 0.12 150)" }}>{lastSession.complimentaryCount}</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Income widget */}
          <IncomeWidget />
        </div>
      )}

      {/* Calendar + Expired Passes row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Calendar */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <CalendarDays className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
              Upcoming (next 60 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingEvents.length > 0 ? (
              <ul className="space-y-2.5">
                {upcomingEvents.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-2.5">
                    {eventTypeIcon(ev.type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight" style={{ color: "oklch(0.22 0.07 240)" }}>
                        {ev.title}
                      </p>
                      {ev.type === "performance" && (ev as any).location && (
                        <p className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
                          {(ev as any).location}
                        </p>
                      )}
                    </div>
                    <span className="text-xs shrink-0 font-medium" style={{ color: "oklch(0.52 0.03 240)" }}>
                      {format(new Date(ev.date), "d MMM")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                No upcoming events in the next 60 days.
              </p>
            )}
            <a href="/calendar" className="block mt-4 text-xs font-medium" style={{ color: "oklch(0.55 0.14 185)" }}>
              View full calendar →
            </a>
          </CardContent>
        </Card>

        {/* Expired Passes */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <AlertTriangle className="w-4 h-4" style={{ color: "oklch(0.577 0.245 27.325)" }} />
              Expired Passes
              {sortedExpired.length > 0 && (
                <Badge
                  className="ml-auto text-xs px-2 py-0.5"
                  style={{ background: "oklch(0.577 0.245 27.325)", color: "white" }}
                >
                  {sortedExpired.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sortedExpired.length > 0 ? (
              <ul className="space-y-2">
                {sortedExpired.map((m) => {
                  const displayName =
                    m.firstName || m.lastName
                      ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim()
                      : getDisplayName(m, "Unknown");
                  return (
                    <li key={m.userId} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                          style={{ background: "oklch(0.97 0.02 27)", color: "oklch(0.577 0.245 27.325)" }}
                        >
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                            {displayName}
                          </p>
                          {m.email && (
                            <p className="text-xs truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
                              {m.email}
                            </p>
                          )}
                        </div>
                      </div>
                      <span
                        className="text-xs font-semibold shrink-0 px-2 py-0.5 rounded-full"
                        style={{ background: "oklch(0.97 0.02 27)", color: "oklch(0.577 0.245 27.325)" }}
                      >
                        0 / {m.totalSessions}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                No members with expired passes.
              </p>
            )}
            <a href="/passes" className="block mt-4 text-xs font-medium" style={{ color: "oklch(0.55 0.14 185)" }}>
              Manage passes →
            </a>
          </CardContent>
        </Card>
      </div>

      {/* Low Pass Alert */}
      {sortedLow.length > 0 && (
        <Card className="border-0 shadow-sm" style={{ borderLeft: "4px solid oklch(0.70 0.15 60)" }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <AlertTriangle className="w-4 h-4" style={{ color: "oklch(0.65 0.18 60)" }} />
              Low Pass Alert
              <Badge
                className="ml-auto text-xs px-2 py-0.5"
                style={{ background: "oklch(0.65 0.18 60)", color: "white" }}
              >
                {sortedLow.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs mb-3" style={{ color: "oklch(0.52 0.03 240)" }}>
              These members have 1–2 sessions remaining and may need a top-up soon.
            </p>
            <ul className="space-y-2">
              {sortedLow.map((m) => {
                const displayName = m.firstName || m.lastName
                  ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim()
                  : getDisplayName(m, "Unknown");
                return (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                        style={{ background: "oklch(0.96 0.05 60)", color: "oklch(0.50 0.18 60)" }}
                      >
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                          {displayName}
                        </p>
                        {m.email && (
                          <p className="text-xs truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
                            {m.email}
                          </p>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-xs font-semibold shrink-0 px-2 py-0.5 rounded-full"
                      style={{
                        background: m.remainingSessions === 1 ? "oklch(0.97 0.04 25)" : "oklch(0.96 0.05 60)",
                        color: m.remainingSessions === 1 ? "oklch(0.52 0.18 25)" : "oklch(0.45 0.18 60)",
                      }}
                    >
                      {m.remainingSessions} left
                    </span>
                  </li>
                );
              })}
            </ul>
            <a href="/members" className="block mt-4 text-xs font-medium" style={{ color: "oklch(0.55 0.14 185)" }}>
              Manage members →
            </a>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions + Getting Started */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { href: "/attendance", label: "Mark Attendance", icon: Calendar, color: "oklch(0.55 0.14 185)" },
              { href: "/passes", label: "Manage Passes", icon: CreditCard, color: "oklch(0.78 0.17 75)" },
              { href: "/library", label: "Upload to Library", icon: Music2, color: "oklch(0.22 0.07 240)" },
              { href: "/announcements", label: "Post Announcement", icon: Megaphone, color: "oklch(0.65 0.12 185)" },
            ].map(({ href, label, icon: Icon, color }) => (
              <a
                key={href}
                href={href}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: color, color: "white" }}
              >
                <Icon className="w-4 h-4" />
                {label}
              </a>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Getting Started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
            <p>Welcome to the BVC management portal. Here's what you can do:</p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "oklch(0.55 0.14 185)" }} />
                Create rehearsal sessions and mark attendance for each member.
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "oklch(0.78 0.17 75)" }} />
                Assign and top up passes. Members are notified when 2 remain.
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "oklch(0.22 0.07 240)" }} />
                Upload sheet music PDFs and backing track audio files to the library.
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: "oklch(0.65 0.12 185)" }} />
                Post announcements for events, rehearsals, and general updates.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MemberDashboard() {
  const { user } = useAuth();
  const { data: summary, isLoading } = trpc.dashboard.memberSummary.useQuery();

  const passPercent = summary?.pass
    ? Math.round((summary.pass.remainingSessions / summary.pass.totalSessions) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-slide-up">
      <div>
        <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
          Welcome back, {user?.name?.split(" ")[0] ?? "Singer"}!
        </h1>
        <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
          Here's your Bundaberg Voice Collective summary.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Calendar}
            label="Sessions Attended"
            value={summary?.totalAttended ?? 0}
            accent="oklch(0.55 0.14 185)"
            href="/attendance-history"
          />
          <StatCard
            icon={CreditCard}
            label="Pass Balance"
            value={summary?.pass ? `${summary.pass.remainingSessions} / ${summary.pass.totalSessions}` : "No pass"}
            accent={
              !summary?.pass
                ? "oklch(0.52 0.03 240)"
                : summary.pass.remainingSessions <= 2
                ? "oklch(0.577 0.245 27.325)"
                : "oklch(0.78 0.17 75)"
            }
            href={!summary?.pass || (summary.pass.remainingSessions <= 2) ? "/payments" : undefined}
          />
          <StatCard
            icon={Bell}
            label="Notifications"
            value={summary?.unreadNotificationCount ?? 0}
            accent="oklch(0.22 0.07 240)"
            href={(summary?.unreadNotificationCount ?? 0) > 0 ? "/announcements" : undefined}
          />
          <StatCard
            icon={Megaphone}
            label="Unread Posts"
            value={summary?.unreadAnnouncementCount ?? 0}
            accent="oklch(0.65 0.12 185)"
            href={(summary?.unreadAnnouncementCount ?? 0) > 0 ? "/announcements" : undefined}
          />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Pass card */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <CreditCard className="w-4 h-4" style={{ color: "oklch(0.78 0.17 75)" }} />
              Your Session Pass
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.pass ? (
              <div className="space-y-4">
                <div className="flex items-end gap-2">
                  <span
                    className="text-5xl font-extrabold leading-none"
                    style={{ color: summary.pass.remainingSessions <= 2 ? "oklch(0.577 0.245 27.325)" : "oklch(0.78 0.17 75)" }}
                  >
                    {summary.pass.remainingSessions}
                  </span>
                  <span className="text-sm pb-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                    of {summary.pass.totalSessions} sessions remaining
                  </span>
                </div>
                <div className="w-full h-3 rounded-full" style={{ background: "oklch(0.94 0.01 240)" }}>
                  <div
                    className="h-3 rounded-full transition-all duration-500"
                    style={{
                      width: `${passPercent}%`,
                      background: summary.pass.remainingSessions <= 2
                        ? "oklch(0.577 0.245 27.325)"
                        : "oklch(0.78 0.17 75)",
                    }}
                  />
                </div>
                {summary.pass.remainingSessions <= 2 ? (
                  <div
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg"
                    style={{ background: "oklch(0.97 0.02 27)" }}
                  >
                    <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "oklch(0.577 0.245 27.325)" }}>
                      <Bell className="w-3.5 h-3.5 shrink-0" />
                      Only {summary.pass.remainingSessions} session{summary.pass.remainingSessions === 1 ? "" : "s"} left. Top up now!
                    </div>
                    <a
                      href="/payments"
                      className="text-xs font-semibold px-3 py-1 rounded-md shrink-0 transition-opacity hover:opacity-80"
                      style={{ background: "oklch(0.577 0.245 27.325)", color: "white" }}
                    >
                      Top Up
                    </a>
                  </div>
                ) : (
                  <a
                    href="/payments"
                    className="inline-flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-70"
                    style={{ color: "oklch(0.55 0.14 185)" }}
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Top up your pass
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                  You don't have an active pass.
                </p>
                <a
                  href="/payments"
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
                  style={{ background: "oklch(0.78 0.17 75)", color: "white" }}
                >
                  <CreditCard className="w-4 h-4" />
                  Purchase a Pass
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Unread announcements */}
        {summary?.unreadAnnouncements && summary.unreadAnnouncements.length > 0 && (
          <Card className="border-0 shadow-sm md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: "oklch(0.55 0.14 185)" }} />
                Unread Announcements
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.unreadAnnouncements.map((a: any) => (
                <div key={a.id} className="border-l-2 pl-3 py-1" style={{ borderColor: "oklch(0.78 0.17 75)" }}>
                  <p className="text-sm font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{a.title}</p>
                  <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "oklch(0.52 0.03 240)" }}>{a.body}</p>
                </div>
              ))}
              <a href="/announcements" className="text-xs font-medium" style={{ color: "oklch(0.55 0.14 185)" }}>
                View all announcements →
              </a>
            </CardContent>
          </Card>
        )}
        {/* Unread chat messages */}
        {summary?.unreadChatPreviews && summary.unreadChatPreviews.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
                <MessageCircle className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
                Unread Messages
                <Badge
                  className="ml-auto text-xs px-2 py-0.5"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                >
                  {summary.unreadMessageCount}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.unreadChatPreviews.map((msg: any) => (
                <div key={msg.id} className="flex items-start gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ background: "oklch(0.94 0.01 240)", color: "oklch(0.35 0.14 185)" }}
                  >
                    {(msg.senderName ?? "M").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                      {msg.senderName}
                    </p>
                    <p className="text-xs line-clamp-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                      {msg.body}
                    </p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: "oklch(0.65 0.03 240)" }}>
                    {msg.createdAt ? format(new Date(msg.createdAt), "h:mm a") : ""}
                  </span>
                </div>
              ))}
              <a
                href="/messages"
                className="text-xs font-medium"
                style={{ color: "oklch(0.55 0.14 185)" }}
              >
                Open Chat →
              </a>
            </CardContent>
          </Card>
        )}
        {/* Recent attendance */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: "oklch(0.22 0.07 240)" }}>
              <Calendar className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
              Recent Attendance
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.recentAttendance && summary.recentAttendance.length > 0 ? (
              <ul className="space-y-2">
                {summary.recentAttendance.map((a, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span style={{ color: "oklch(0.35 0.04 240)" }}>{a.sessionTitle ?? "Session"}</span>
                    <span style={{ color: "oklch(0.55 0.03 240)" }}>
                      {a.sessionDate ? format(new Date(a.sessionDate), "d MMM yyyy") : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                No attendance records yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <BVCLayout>
      {user?.role === "admin" ? <AdminDashboard /> : <MemberDashboard />}
    </BVCLayout>
  );
}
