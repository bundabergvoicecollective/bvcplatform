import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Phone, Mail, UserX, Clock } from "lucide-react";

/**
 * Not seen lately — who to ask about at the next rehearsal, by name.
 *
 * The attendancesweep audit finds the same people, but it runs in a public
 * log and can only print initials. This is the same pair of lists inside the
 * admin panel:
 *
 *   Holding sessions, not ticked at the last three rehearsals — they paid to
 *   come; either they have stopped, or they are coming and not being ticked.
 *
 *   Never ticked at all — some never came. One holding sessions, or signing
 *   in recently, is the shape of somebody being missed on the roll.
 *
 * Neither list is proof. A missing tick looks the same whether nobody ticked
 * them or they stayed home, so this says who to ask, not who is wrong. If they
 * were there, tick them on that night's session below.
 *
 * Collapsed by default: it is a weekly look, not something to scroll past
 * while taking a roll.
 */

const NAVY = "oklch(0.22 0.07 240)";
const MUTED = "oklch(0.52 0.03 240)";

const fmt = (ymd: string | null) =>
  ymd
    ? new Date(`${ymd}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    : null;

type Member = {
  id: number; name: string; email: string | null; phone: string | null; remaining: number;
  lastPresent: string | null; timesPresent: number; joined: string; lastSignedIn: string | null; hasPassword: boolean;
};

function Contact({ m }: { m: Member }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
      {m.phone && (
        <a href={`tel:${m.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: "oklch(0.45 0.12 185)" }}>
          <Phone className="size-3.5" /> {m.phone}
        </a>
      )}
      {m.email && (
        <a href={`mailto:${m.email}`} className="inline-flex items-center gap-1 text-sm font-medium min-w-0 break-all" style={{ color: "oklch(0.45 0.12 185)" }}>
          <Mail className="size-3.5 shrink-0" /> {m.email}
        </a>
      )}
    </span>
  );
}

function Row({ m, kind }: { m: Member; kind: "quiet" | "never" }) {
  const recentSignIn =
    m.lastSignedIn && Date.now() - new Date(`${m.lastSignedIn}T12:00:00`).getTime() < 21 * 86400_000;
  return (
    <li className="py-3 flex gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-semibold" style={{ color: NAVY }}>{m.name}</p>
        <p className="text-sm" style={{ color: MUTED }}>
          {kind === "quiet" ? (
            <>Last ticked {fmt(m.lastPresent)} · {m.timesPresent} rehearsal{m.timesPresent === 1 ? "" : "s"} in all</>
          ) : (
            <>
              Joined {fmt(m.joined)}
              {m.lastSignedIn ? ` · last signed in ${fmt(m.lastSignedIn)}` : ""}
              {!m.hasPassword ? " · hasn't set a password" : ""}
            </>
          )}
        </p>
        <Contact m={m} />
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {m.remaining > 0 ? (
          <Badge variant="outline" className="tabular-nums" style={{ color: NAVY }}>
            {m.remaining} left
          </Badge>
        ) : (
          <Badge variant="outline" style={{ color: MUTED }}>No sessions</Badge>
        )}
        {kind === "never" && (m.remaining > 0 || recentSignIn) && (
          <Badge className="border-0" style={{ background: "oklch(0.95 0.05 80)", color: "oklch(0.42 0.12 70)" }}>
            Ask about
          </Badge>
        )}
      </div>
    </li>
  );
}

export default function NotSeenLately() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.attendance.notSeenLately.useQuery();

  const quiet = data?.quiet ?? [];
  const never = data?.never ?? [];
  // The never-ticked worth a look: holding sessions, or signing in lately.
  const neverToAsk = never.filter(
    (m) => m.remaining > 0 || (m.lastSignedIn && Date.now() - new Date(`${m.lastSignedIn}T12:00:00`).getTime() < 21 * 86400_000),
  );
  const nights = (data?.sessions ?? []).map((s) => fmt(s.date)).filter(Boolean).join(", ");

  return (
    <Card className="border-0 py-0 gap-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <span className="size-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "oklch(0.95 0.04 80)" }}>
          <Clock className="size-5" style={{ color: "oklch(0.55 0.13 70)" }} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold" style={{ color: NAVY }}>Not seen lately</span>
          <span className="block text-sm" style={{ color: MUTED }}>
            {isLoading
              ? "Checking…"
              : `${quiet.length} holding sessions but not ticked lately · ${neverToAsk.length} never ticked worth asking about`}
          </span>
        </span>
        {open ? <ChevronUp className="size-5 shrink-0" style={{ color: MUTED }} /> : <ChevronDown className="size-5 shrink-0" style={{ color: MUTED }} />}
      </button>

      {open && data && (
        <CardContent className="px-4 pb-4 pt-0 space-y-5">
          <p className="text-sm rounded-xl px-3 py-2" style={{ background: "oklch(0.965 0.006 250)", color: MUTED }}>
            Who to ask about, not who's done anything wrong — a missing tick looks the same whether nobody ticked them
            or they stayed home. If they were there, tick them on that night's session below.
          </p>

          <section>
            <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: NAVY }}>
              <Clock className="size-4" /> Holding sessions, not ticked at the last {data.sessions.length} rehearsals
              <Badge variant="secondary" className="ml-1">{quiet.length}</Badge>
            </h3>
            {nights && <p className="text-xs mt-0.5" style={{ color: MUTED }}>{nights}</p>}
            {quiet.length ? (
              <ul className="divide-y mt-1">{quiet.map((m) => <Row key={m.id} m={m} kind="quiet" />)}</ul>
            ) : (
              <p className="text-sm mt-2" style={{ color: MUTED }}>Everyone holding sessions has been ticked recently.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: NAVY }}>
              <UserX className="size-4" /> Never ticked at any rehearsal
              <Badge variant="secondary" className="ml-1">{never.length}</Badge>
            </h3>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              "Ask about" marks those holding sessions or signing in lately — the ones who may be coming and not being ticked.
            </p>
            {never.length ? (
              <ul className="divide-y mt-1">{never.map((m) => <Row key={m.id} m={m} kind="never" />)}</ul>
            ) : (
              <p className="text-sm mt-2" style={{ color: MUTED }}>Every active member has been ticked at least once.</p>
            )}
          </section>
        </CardContent>
      )}
    </Card>
  );
}
