import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Mail, Send, Users, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { getDisplayName } from "@shared/const";

/**
 * Email campaigns — one message to every member whose 5- or 10-pass has run
 * out.
 *
 * WHO IS IN THE LIST is decided by the server (see getMultipassEmptyAudience):
 * active members, nothing left on their pass, who have bought a 5 or 10-pass
 * or held a pass of five sessions or more. People who only ever pay by the
 * session are never in it. Everyone starts ticked; untick anybody who should
 * not get this one.
 *
 * SENDING happens while the page waits, a little over half a second per
 * person to stay inside the mail provider's limit, so 30 people is about
 * twenty seconds. The server checks the list again at the moment of sending
 * and skips anyone who has topped up or unsubscribed since the page loaded.
 */

const NAVY = "oklch(0.22 0.07 240)";
const GOLD = "oklch(0.78 0.17 75)";
const MUTED = "oklch(0.52 0.03 240)";

const DEFAULT_SUBJECT = "Time to top up your BVC pass";
const DEFAULT_BODY = `Hi {firstName},

Your BVC pass has run out, and we'd love to keep seeing you at rehearsal.

You can buy a new 5 or 10-session pass online using the button below, or pay at the door at your next rehearsal.

See you on Tuesday,
The BVC team`;

const bris = (d: string | Date) =>
  new Date(d).toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
const shortDate = (ymd: string | null) =>
  ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : null;

const personalise = (text: string, firstName: string) => text.replace(/\{\s*first\s*name\s*\}/gi, firstName);

export default function EmailCampaignsTab() {
  const utils = trpc.useUtils();
  const audienceQuery = trpc.campaigns.audience.useQuery();
  const historyQuery = trpc.campaigns.list.useQuery();

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [includeBuyButton, setIncludeBuyButton] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number; failed: number; skipped: number } | null>(null);

  const audience = audienceQuery.data ?? [];
  const reachable = useMemo(() => audience.filter((m) => !m.optedOut), [audience]);
  const optedOutCount = audience.length - reachable.length;

  // Everyone who can be emailed starts ticked, once the list arrives.
  useEffect(() => {
    if (audienceQuery.data) setSelected(new Set(audienceQuery.data.filter((m) => !m.optedOut).map((m) => m.id)));
  }, [audienceQuery.data]);

  const chosen = reachable.filter((m) => selected.has(m.id));
  const previewName = chosen[0]?.firstName?.trim() || chosen[0]?.name?.trim().split(/\s+/)[0] || "Jenny";
  const canSend = subject.trim() && body.trim() && chosen.length > 0;

  const sendTest = trpc.campaigns.sendTest.useMutation({
    onSuccess: ({ to }) => toast.success(`Test sent to ${to}. Check your inbox (and junk folder).`),
    onError: (e) => toast.error(e.message),
  });

  const send = trpc.campaigns.send.useMutation({
    onSuccess: (r) => {
      setLastResult(r);
      utils.campaigns.list.invalidate();
      utils.campaigns.audience.invalidate();
      if (r.failed) toast.warning(`Sent to ${r.sent}. ${r.failed} could not be sent — see the history below.`);
      else toast.success(`Sent to ${r.sent} member${r.sent === 1 ? "" : "s"}.`);
    },
    onError: (e) => toast.error(e.message, { duration: 10_000 }),
  });

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* ── Who it goes to ─────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2" style={{ color: NAVY }}>
            <Users className="w-4 h-4" /> Members whose 5 or 10-pass has run out
            {!audienceQuery.isLoading && <Badge variant="secondary" className="ml-1">{reachable.length}</Badge>}
          </CardTitle>
          <p className="text-sm" style={{ color: MUTED }}>
            Everyone with nothing left on their pass who has bought a 5 or 10-pass before. People who only ever pay by
            the session aren't included. Untick anyone who shouldn't get this one.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {audienceQuery.isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />)}</div>
          ) : audienceQuery.error ? (
            <p className="text-sm" style={{ color: "oklch(0.5 0.18 25)" }}>Couldn't load the list: {audienceQuery.error.message}</p>
          ) : !audience.length ? (
            <p className="text-sm py-4 text-center" style={{ color: MUTED }}>
              Nobody's pass has run out right now, so there's no one to email.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span style={{ color: MUTED }}>{chosen.length} of {reachable.length} selected</span>
                <Button variant="outline" size="sm" className="h-9" onClick={() => setSelected(new Set(reachable.map((m) => m.id)))}>Select all</Button>
                <Button variant="outline" size="sm" className="h-9" onClick={() => setSelected(new Set())}>Select none</Button>
              </div>
              <div className="rounded-lg border divide-y max-h-[50svh] overflow-y-auto">
                {audience.map((m) => {
                  const name = getDisplayName(m, m.email ?? `Member #${m.id}`);
                  const lastPass = shortDate(m.lastPassAt);
                  const emailed = shortDate(m.lastEmailedAt);
                  return (
                    <label
                      key={m.id}
                      className={`flex items-start gap-3 px-3 py-3 ${m.optedOut ? "opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
                    >
                      <Checkbox
                        className="mt-1 size-5"
                        checked={!m.optedOut && selected.has(m.id)}
                        disabled={m.optedOut}
                        onCheckedChange={(v) => toggle(m.id, v === true)}
                        aria-label={`Email ${name}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium" style={{ color: NAVY }}>{name}</span>
                        <span className="block text-sm truncate" style={{ color: MUTED }}>{m.email}</span>
                        <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
                          {m.boughtMulti > 0 ? "Has bought a multi-pass" : `Held a ${m.biggestPass}-session pass`}
                          {lastPass ? ` · last pass from ${lastPass}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1 shrink-0">
                        {m.optedOut && <Badge variant="outline">Unsubscribed</Badge>}
                        {emailed && !m.optedOut && <Badge variant="outline" className="text-xs">Emailed {emailed}</Badge>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {optedOutCount > 0 && (
                <p className="text-xs" style={{ color: MUTED }}>
                  {optedOutCount} member{optedOutCount === 1 ? " has" : "s have"} unsubscribed from these emails and won't be sent one.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── The message ────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2" style={{ color: NAVY }}>
            <Mail className="w-4 h-4" /> The email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-subject">Subject</Label>
            <Input id="campaign-subject" className="h-11 text-base" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-body">Message</Label>
            <Textarea id="campaign-body" className="text-base min-h-56" value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-xs" style={{ color: MUTED }}>
              Type <code className="px-1 rounded bg-gray-100">{"{firstName}"}</code> and each person sees their own first name.
              Leave a blank line between paragraphs.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox className="size-5" checked={includeBuyButton} onCheckedChange={(v) => setIncludeBuyButton(v === true)} />
            <span className="text-sm">Include a <strong>Buy a pass</strong> button that opens the Passes page</span>
          </label>

          {/* Preview — what the first selected person will see. */}
          <div className="space-y-1.5">
            <Label>Preview{chosen[0] ? ` — as ${previewName} will see it` : ""}</Label>
            <div className="rounded-xl overflow-hidden border" style={{ background: "#f5f5f0" }}>
              <div className="mx-auto max-w-lg my-4 bg-white rounded-lg overflow-hidden shadow-sm" style={{ fontFamily: "Georgia, serif" }}>
                <div className="py-4 text-center text-[11px] font-bold tracking-[3px] uppercase" style={{ background: "#0e1a2b", color: "#c9922a" }}>
                  Bundaberg Voice Collective
                </div>
                <div className="px-6 py-5 text-[15px] leading-relaxed" style={{ color: "#333" }}>
                  <p className="font-bold mb-3" style={{ color: "#0e1a2b" }}>{personalise(subject, previewName) || "(no subject)"}</p>
                  {personalise(body, previewName).trim().split(/\n\s*\n/).map((para, i) => (
                    <p key={i} className="mb-3 whitespace-pre-line">{para.trim()}</p>
                  ))}
                  {includeBuyButton && (
                    <p className="text-center mt-4 mb-2">
                      <span className="inline-block px-6 py-3 rounded-lg font-bold text-white" style={{ background: "#c9922a" }}>Buy a pass</span>
                    </p>
                  )}
                </div>
                <div className="px-6 py-3 border-t text-[11px] text-center" style={{ color: "#888" }}>
                  Sent by Bundaberg Voice Collective to members who have bought a pass with us.
                  <br /><u>Unsubscribe from these emails</u> — you'll still get receipts and account emails.
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              className="h-11"
              disabled={!subject.trim() || !body.trim() || sendTest.isPending || send.isPending}
              onClick={() => sendTest.mutate({ subject, body, includeBuyButton })}
            >
              <Mail className="w-4 h-4 mr-2" />
              {sendTest.isPending ? "Sending test…" : "Send a test to me"}
            </Button>
            <Button
              className="h-11 text-white"
              style={{ background: GOLD }}
              disabled={!canSend || send.isPending}
              onClick={() => setConfirming(true)}
            >
              <Send className="w-4 h-4 mr-2" />
              {send.isPending
                ? `Sending to ${chosen.length}… keep this page open`
                : `Send to ${chosen.length} member${chosen.length === 1 ? "" : "s"}`}
            </Button>
          </div>

          {lastResult && !send.isPending && (
            <div
              className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
              style={lastResult.failed
                ? { background: "oklch(0.97 0.05 75)", color: "oklch(0.40 0.12 75)" }
                : { background: "oklch(0.95 0.05 160)", color: "oklch(0.35 0.10 160)" }}
            >
              {lastResult.failed ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>
                Sent to <strong>{lastResult.sent}</strong>.
                {lastResult.failed ? ` ${lastResult.failed} couldn't be sent — open the campaign below to see who.` : ""}
                {lastResult.skipped ? ` ${lastResult.skipped} skipped because they'd topped up or unsubscribed since the list loaded.` : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── History ────────────────────────────────────────────────────── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base" style={{ color: NAVY }}>Sent campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="h-12 rounded-lg bg-gray-100 animate-pulse" />
          ) : !historyQuery.data?.length ? (
            <p className="text-sm py-2" style={{ color: MUTED }}>Nothing sent yet.</p>
          ) : (
            <div className="divide-y">
              {historyQuery.data.map((c) => <CampaignRow key={c.id} campaign={c} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Email {chosen.length} member{chosen.length === 1 ? "" : "s"} now?</AlertDialogTitle>
            <AlertDialogDescription>
              "{subject.trim()}" will go straight to their inboxes and can't be called back. It takes about{" "}
              {Math.max(1, Math.round((chosen.length * 0.8) / 60))} minute{chosen.length * 0.8 > 90 ? "s" : ""} —
              keep this page open until it says it's done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              style={{ background: GOLD, color: "white" }}
              onClick={() => {
                setLastResult(null);
                send.mutate({ subject, body, includeBuyButton, userIds: chosen.map((m) => m.id) });
              }}
            >
              Send it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampaignRow({
  campaign: c,
}: {
  campaign: { id: number; subject: string; recipientCount: number; sentCount: number; failedCount: number; status: string; createdAt: Date | string; createdByName: string | null };
}) {
  const [open, setOpen] = useState(false);
  const recipients = trpc.campaigns.recipients.useQuery({ campaignId: c.id }, { enabled: open });
  return (
    <div className="py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-start gap-3 text-left">
        <span className="flex-1 min-w-0">
          <span className="block font-medium truncate" style={{ color: NAVY }}>{c.subject}</span>
          <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
            {bris(c.createdAt)}{c.createdByName ? ` · by ${c.createdByName}` : ""}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0 text-sm">
          {c.status === "sending" ? (
            <Badge variant="outline">Stopped part-way</Badge>
          ) : (
            <Badge variant="secondary">{c.sentCount} sent</Badge>
          )}
          {c.failedCount > 0 && <Badge variant="outline" style={{ color: "oklch(0.5 0.18 25)" }}>{c.failedCount} failed</Badge>}
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
          {recipients.isLoading ? (
            <span style={{ color: MUTED }}>Loading…</span>
          ) : (
            <ul className="space-y-1">
              {(recipients.data ?? []).map((r) => (
                <li key={`${r.userId}-${r.email}`} className="flex flex-wrap justify-between gap-x-3">
                  <span>{getDisplayName(r, r.email)} <span style={{ color: MUTED }}>· {r.email}</span></span>
                  <span style={{ color: r.status === "sent" ? "oklch(0.45 0.12 160)" : "oklch(0.5 0.18 25)" }}>
                    {r.status === "sent" ? "Sent" : `Failed${r.error ? `: ${r.error.slice(0, 80)}` : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
