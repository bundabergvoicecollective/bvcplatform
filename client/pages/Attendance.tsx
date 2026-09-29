import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Calendar,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Search,
  CreditCard,
  UserCheck,
  Gift,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useState, useRef } from "react";
import { getDisplayName } from "@shared/const";
import { toast } from "sonner";

// ─── Create Session Dialog ────────────────────────────────────────────────────

function CreateSessionDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const utils = trpc.useUtils();
  const create = trpc.sessions.create.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
      setOpen(false);
      setTitle("");
      setDate("");
      setNotes("");
      onCreated();
      toast.success("Session created");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="flex items-center gap-2 font-semibold"
          style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
        >
          <Plus className="w-4 h-4" /> New Session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Rehearsal Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Session Title</Label>
            <Input
              placeholder="e.g. Tuesday Rehearsal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Date & Time</Label>
            <Input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Any notes about this session..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1"
              rows={3}
            />
          </div>
          <Button
            className="w-full font-semibold"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            disabled={!title || !date || create.isPending}
            onClick={() =>
              create.mutate({ title, sessionDate: new Date(date), notes: notes || undefined })
            }
          >
            {create.isPending ? "Creating..." : "Create Session"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Session Row ──────────────────────────────────────────────────────────────

function SessionRow({
  session,
}: {
  session: { id: number; title: string; sessionDate: Date; notes?: string | null };
}) {
  const [expanded, setExpanded] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const utils = trpc.useUtils();

  const { data: members } = trpc.members.list.useQuery(undefined, { enabled: expanded });
  const { data: attendanceData, refetch } = trpc.attendance.forSession.useQuery(
    { sessionId: session.id },
    { enabled: expanded }
  );
  const { data: stats, refetch: refetchStats } = trpc.attendance.sessionStats.useQuery(
    { sessionId: session.id },
    { enabled: expanded }
  );

  const mark = trpc.attendance.mark.useMutation({
    onSuccess: (_data, variables) => {
      refetch();
      refetchStats();
      utils.dashboard.adminStats.invalidate();
      utils.attendance.lastSessionStats.invalidate();
      // Refresh the pass balance for the member that was just marked
      utils.passes.activeForUser.invalidate({ userId: variables.userId });
      // Keep Members tab in sync so pass balances update there too
      utils.members.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteSession = trpc.sessions.delete.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
      toast.success("Session deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const attendanceMap = new Map((attendanceData ?? []).map((a) => [a.userId, a]));
  const presentCount = attendanceData?.filter((a) => a.attended).length ?? 0;

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      {/* Session header row */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
          ) : (
            <ChevronRight className="w-4 h-4" style={{ color: "oklch(0.55 0.03 240)" }} />
          )}
          <div>
            <p className="font-semibold text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
              {session.title}
            </p>
            <p className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
              {format(new Date(session.sessionDate), "EEEE, d MMMM yyyy · h:mm a")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {presentCount} present
          </Badge>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("Delete this session and all its attendance records?")) {
                deleteSession.mutate({ sessionId: session.id });
              }
            }}
            className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
            style={{ color: "oklch(0.577 0.245 27.325)" }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded attendance panel */}
      {expanded && (
        <div className="border-t px-5 py-4 space-y-4" style={{ borderColor: "oklch(0.88 0.01 240)" }}>

          {/* Per-session stats summary */}
          {stats && stats.total > 0 && (
            <div className="flex items-center gap-4 p-3 rounded-lg text-sm flex-wrap"
              style={{ background: "oklch(0.96 0.02 185)" }}>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: "oklch(0.35 0.1 185)" }}>
                <UserCheck className="w-4 h-4" />
                <span>{stats.total} attended</span>
              </div>
              <span style={{ color: "oklch(0.65 0.03 240)" }}>·</span>
              <div className="flex items-center gap-1.5" style={{ color: "oklch(0.45 0.1 185)" }}>
                <CreditCard className="w-3.5 h-3.5" />
                <span>{stats.passCount} pass</span>
              </div>
              <span style={{ color: "oklch(0.65 0.03 240)" }}>·</span>
              <div style={{ color: "oklch(0.52 0.03 240)" }}>
                <span>{stats.singleCount} single</span>
              </div>
              {(stats as any).complimentaryCount > 0 && (
                <>
                  <span style={{ color: "oklch(0.65 0.03 240)" }}>·</span>
                  <div className="flex items-center gap-1.5" style={{ color: "oklch(0.45 0.12 145)" }}>
                    <Gift className="w-3.5 h-3.5" />
                    <span>{(stats as any).complimentaryCount} complimentary</span>
                  </div>
                </>
              )}
            </div>
          )}

          {!members || members.length === 0 ? (
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              No members found. Members will appear here once they sign in.
            </p>
          ) : (
            <div className="space-y-1">
              {/* Search bar */}
              <div className="relative mb-3">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                  style={{ color: "oklch(0.65 0.03 240)" }}
                />
                <Input
                  placeholder="Search members…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>

              {/* Column headers */}
              <div
                className="grid text-xs font-semibold pb-2 border-b"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  color: "oklch(0.52 0.03 240)",
                  borderColor: "oklch(0.88 0.01 240)",
                }}
              >
                <span>Member</span>
                <span className="text-center px-3">Complimentary</span>
                <span className="text-center pr-2">Attended</span>
              </div>

              {[...(members ?? [])]
                .sort((a, b) => {
                  return getDisplayName(a).toLowerCase().localeCompare(getDisplayName(b).toLowerCase());
                })
                .filter(
                  (m) =>
                    memberSearch.trim() === "" ||
                    getDisplayName(m).toLowerCase().includes(memberSearch.toLowerCase()) ||
                    (m.email ?? "").toLowerCase().includes(memberSearch.toLowerCase())
                )
                .map((member) => {
                  const rec = attendanceMap.get(member.id);
                  const attended = rec?.attended ?? false;
                  const sessionType = rec?.sessionType ?? null;

                  return (
                    <MemberAttendanceRow
                      key={member.id}
                      member={member}
                      sessionId={session.id}
                      attended={attended}
                      sessionType={sessionType as "pass" | "single" | "complimentary" | null}
                      isPending={mark.isPending}
                      onMark={(attended, complimentary) =>
                        mark.mutate({ sessionId: session.id, userId: member.id, attended, complimentary })
                      }
                    />
                  );
                })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Assign Pass Confirmation Dialog ─────────────────────────────────────────

function AssignPassButton({
  label,
  sessions,
  memberName,
  memberId,
  existingPass,
  onAssigned,
}: {
  label: string;
  sessions: number;
  memberName: string;
  memberId: number;
  existingPass?: { id: number; remainingSessions: number } | null;
  onAssigned: (passId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const hasActivePass = !!(existingPass && existingPass.remainingSessions > 0);

  // Top-up mutation — used when member already has sessions remaining
  const topUp = trpc.passes.topUp.useMutation({
    onSuccess: (data) => {
      setOpen(false);
      utils.passes.activeForUser.invalidate({ userId: memberId });
      utils.members.list.invalidate();
      utils.dashboard.adminStats.invalidate();
      if (data?.id) onAssigned(data.id);
    },
    onError: (e) => {
      setOpen(false);
      toast.error(e.message);
    },
  });

  // Assign mutation — used when member has no active pass
  const assign = trpc.passes.assign.useMutation({
    onSuccess: (data) => {
      setOpen(false);
      utils.passes.activeForUser.invalidate({ userId: memberId });
      utils.members.list.invalidate();
      utils.dashboard.adminStats.invalidate();
      if (data?.id) onAssigned(data.id);
    },
    onError: (e) => {
      setOpen(false);
      toast.error(e.message);
    },
  });

  const isPending = topUp.isPending || assign.isPending;

  function handleConfirm() {
    if (hasActivePass && existingPass) {
      topUp.mutate({ passId: existingPass.id, userId: memberId, addSessions: sessions });
    } else {
      assign.mutate({ userId: memberId, totalSessions: sessions });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="text-xs px-2 py-0.5 rounded-md border font-medium transition-all hover:opacity-80 active:scale-95"
          style={{
            borderColor: "oklch(0.75 0.08 185)",
            color: "oklch(0.35 0.10 185)",
            background: "oklch(0.96 0.03 185)",
          }}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            {hasActivePass ? "Top Up Pass" : "Assign New Pass"}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3 text-sm" style={{ color: "oklch(0.35 0.05 240)" }}>
          {hasActivePass ? (
            <>
              <p>
                <span className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{memberName}</span>{" "}
                already has{" "}
                <span className="font-semibold" style={{ color: "oklch(0.35 0.10 185)" }}>
                  {existingPass!.remainingSessions} session{existingPass!.remainingSessions === 1 ? "" : "s"} remaining
                </span>.
              </p>
              <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "oklch(0.96 0.04 185)", color: "oklch(0.30 0.10 185)" }}>
                Adding a <strong>{label}</strong> will <strong>top up</strong> their balance by {sessions} session{sessions === 1 ? "" : "s"} — bringing them to{" "}
                <strong>{existingPass!.remainingSessions + sessions}</strong> total.
              </div>
            </>
          ) : (
            <p>
              You are about to assign a{" "}
              <span className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{label}</span>{" "}
              to{" "}
              <span className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{memberName}</span>.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={handleConfirm}
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
          >
            {isPending
              ? (hasActivePass ? "Topping up…" : "Assigning…")
              : (hasActivePass ? `Add ${sessions} Session${sessions === 1 ? "" : "s"}` : "Yes, Assign")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Member Attendance Row ────────────────────────────────────────────────────

function MemberAttendanceRow({
  member,
  sessionId: _sessionId,
  attended,
  sessionType,
  isPending,
  onMark,
}: {
  member: { id: number; name: string | null; firstName?: string | null; lastName?: string | null; email: string | null };
  sessionId: number;
  attended: boolean;
  sessionType: "pass" | "single" | "complimentary" | null;
  isPending: boolean;
  onMark: (attended: boolean, complimentary: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { data: pass, refetch: refetchPass } = trpc.passes.activeForUser.useQuery({ userId: member.id });
  const isComplimentary = sessionType === "complimentary";

  // Undo timer ref — stores the toast ID so we can dismiss it on undo
  const undoToastRef = useRef<string | number | null>(null);

  const deletePass = trpc.passes.delete.useMutation({
    onSuccess: () => {
      refetchPass();
      utils.passes.activeForUser.invalidate({ userId: member.id });
      utils.members.list.invalidate();
      utils.dashboard.adminStats.invalidate();
      if (undoToastRef.current !== null) toast.dismiss(undoToastRef.current);
      toast.success(`Pass removed for ${getDisplayName(member, "member")}`)
    },
    onError: (e) => toast.error(e.message),
  });

  function handleAssigned(passId: number) {
    refetchPass();
    const label = pass?.totalSessions === 1 ? "Single session" : `${pass?.totalSessions ?? "?"}-pass`;
    // Show undo toast for 8 seconds
    const toastId = toast.success(
      `Pass assigned to ${getDisplayName(member, "member")}`,
      {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => deletePass.mutate({ passId }),
        },
        description: "Tap Undo within 8 seconds to reverse this.",
      }
    );
    undoToastRef.current = toastId;
  }

  // Remaining balance label
  function PassBalanceLabel() {
    if (!pass) {
      return (
        <span className="text-xs shrink-0" style={{ color: "oklch(0.65 0.06 75)" }}>
          No pass
        </span>
      );
    }
    const remaining = pass.remainingSessions;
    const total = pass.totalSessions;
    const colour = remaining <= 2 ? "oklch(0.65 0.14 75)" : "oklch(0.45 0.12 185)";
    return (
      <span className="text-xs font-semibold shrink-0" style={{ color: colour }}>
        {remaining} / {total} left
      </span>
    );
  }

  return (
    <div className="py-2.5 border-b last:border-0" style={{ borderColor: "oklch(0.93 0.01 240)" }}>
      {/* Top row: name + balance + complimentary + checkbox */}
      <div className="grid items-center gap-2" style={{ gridTemplateColumns: "1fr auto auto" }}>
        {/* Member info */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
              {getDisplayName(member)}
            </p>
            <PassBalanceLabel />
            {attended && sessionType === "pass" && (
              <Badge
                className="text-xs px-1.5 py-0 h-5 shrink-0"
                style={{ background: "oklch(0.88 0.08 185)", color: "oklch(0.35 0.12 185)" }}
              >
                <CreditCard className="w-3 h-3 mr-1" />
                Pass used
              </Badge>
            )}
            {attended && sessionType === "single" && (
              <Badge
                className="text-xs px-1.5 py-0 h-5 shrink-0"
                style={{ background: "oklch(0.94 0.04 75)", color: "oklch(0.45 0.12 75)" }}
              >
                Single session
              </Badge>
            )}
            {attended && sessionType === "complimentary" && (
              <Badge
                className="text-xs px-1.5 py-0 h-5 shrink-0"
                style={{ background: "oklch(0.92 0.06 145)", color: "oklch(0.35 0.12 145)" }}
              >
                <Gift className="w-3 h-3 mr-1" />
                Complimentary
              </Badge>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: "oklch(0.55 0.03 240)" }}>
            {member.email ?? ""}
          </p>
        </div>

        {/* Complimentary toggle */}
        <div className="flex justify-center px-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Switch
                    checked={isComplimentary}
                    disabled={isPending || !attended}
                    onCheckedChange={(checked) => onMark(true, checked)}
                    className="data-[state=checked]:bg-emerald-500 scale-90"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-44 text-center">
                {attended
                  ? isComplimentary
                    ? "Complimentary — no pass deducted. Toggle off to deduct from pass."
                    : "Mark as complimentary to skip pass deduction."
                  : "Mark as attended first to enable complimentary option."}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Attended checkbox */}
        <div className="flex justify-center pr-2">
          <Checkbox
            checked={attended}
            disabled={isPending}
            onCheckedChange={(checked) => onMark(!!checked, isComplimentary && !!checked)}
            className="data-[state=checked]:bg-teal-600 data-[state=checked]:border-teal-600"
          />
        </div>
      </div>

      {/* Assign pass buttons with confirmation */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className="text-xs" style={{ color: "oklch(0.65 0.03 240)" }}>Assign:</span>
        {[
          { label: "10-Pass", sessions: 10 },
          { label: "5-Pass", sessions: 5 },
          { label: "Single", sessions: 1 },
        ].map(({ label, sessions }) => (
          <AssignPassButton
            key={sessions}
            label={label}
            sessions={sessions}
            memberName={getDisplayName(member, "this member")}
            memberId={member.id}
            existingPass={pass ?? null}
            onAssigned={handleAssigned}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Attendance() {
  const { user } = useAuth();
  const { data: sessions, isLoading } = trpc.sessions.list.useQuery();
  const [_refresh, setRefresh] = useState(0);

  if (user?.role !== "admin") {
    return (
      <BVCLayout>
        <div className="flex items-center justify-center h-64">
          <p style={{ color: "oklch(0.52 0.03 240)" }}>Admin access required.</p>
        </div>
      </BVCLayout>
    );
  }

  return (
    <BVCLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="font-display text-2xl font-bold"
              style={{ color: "oklch(0.22 0.07 240)" }}
            >
              Attendance
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              Tick a member as attended — their pass is deducted automatically. Use the Complimentary toggle for free sessions, or assign a new pass directly from each member row.
            </p>
          </div>
          <CreateSessionDialog onCreated={() => setRefresh((v) => v + 1)} />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Calendar className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>
                No sessions yet
              </p>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                Create your first rehearsal session above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s as any} />
            ))}
          </div>
        )}
      </div>
    </BVCLayout>
  );
}
