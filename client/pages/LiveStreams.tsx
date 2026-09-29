import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Video,
  Lock,
  Unlock,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Users,
  CreditCard,
  CheckCircle2,
  CalendarClock,
  Archive,
  Film,
  Link2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StreamItem = {
  id: number;
  title: string;
  description: string | null;
  streamUrl: string | null;
  recordingUrl?: string | null;
  scheduledAt: Date;
  endsAt?: Date | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  hasAccess: boolean;
};

/** Returns the effective end time for a stream: endsAt if set, otherwise scheduledAt + 3 hours */
function getStreamEndTime(stream: StreamItem): Date {
  if (stream.endsAt) return new Date(stream.endsAt);
  const start = new Date(stream.scheduledAt);
  return new Date(start.getTime() + 3 * 60 * 60 * 1000); // default 3h window
}

// ─── Admin Create/Edit Dialog ─────────────────────────────────────────────────

function StreamFormDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: StreamItem | null;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [streamUrl, setStreamUrl] = useState(initial?.streamUrl ?? "");
  const [scheduledAt, setScheduledAt] = useState(
    initial ? format(new Date(initial.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ""
  );
  const [endsAt, setEndsAt] = useState(
    initial?.endsAt ? format(new Date(initial.endsAt), "yyyy-MM-dd'T'HH:mm") : ""
  );

  useEffect(() => {
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setStreamUrl(initial?.streamUrl ?? "");
    setScheduledAt(
      initial ? format(new Date(initial.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ""
    );
    setEndsAt(
      initial?.endsAt ? format(new Date(initial.endsAt), "yyyy-MM-dd'T'HH:mm") : ""
    );
  }, [initial, open]);

  const create = trpc.liveStreams.create.useMutation({
    onSuccess: () => { utils.liveStreams.list.invalidate(); toast.success("Live stream created"); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.liveStreams.update.useMutation({
    onSuccess: () => { utils.liveStreams.list.invalidate(); toast.success("Live stream updated"); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const isEditing = !!initial;
  const loading = create.isPending || update.isPending;

  function handleSubmit() {
    if (!title.trim() || !streamUrl.trim() || !scheduledAt) {
      toast.error("Title, stream URL, and date/time are required");
      return;
    }
    const data = {
      title: title.trim(),
      description: description.trim() || undefined,
      streamUrl: streamUrl.trim(),
      scheduledAt: new Date(scheduledAt),
      endsAt: endsAt ? new Date(endsAt) : undefined,
    };
    if (isEditing) {
      update.mutate({ id: initial!.id, ...data, endsAt: endsAt ? new Date(endsAt) : null });
    } else {
      create.mutate(data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Live Rehearsal" : "Create Live Rehearsal"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. BVC Rehearsal — May 26" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional notes for members" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Stream URL * (Zoom, YouTube, etc.)</Label>
            <Input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="https://zoom.us/j/..." />
          </div>
          <div className="space-y-1.5">
            <Label>Start Date & Time *</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End Time <span className="text-muted-foreground text-xs">(optional — stream stays joinable until this time)</span></Label>
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving…" : isEditing ? "Save Changes" : "Create Stream"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin Set Recording URL Dialog ──────────────────────────────────────────

function SetRecordingDialog({
  stream,
  open,
  onClose,
}: {
  stream: StreamItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [url, setUrl] = useState(stream?.recordingUrl ?? "");

  useEffect(() => {
    setUrl(stream?.recordingUrl ?? "");
  }, [stream, open]);

  const setRecording = trpc.liveStreams.setRecordingUrl.useMutation({
    onSuccess: () => {
      utils.liveStreams.list.invalidate();
      toast.success("Recording URL saved. Members can now access the archive.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const clearRecording = trpc.liveStreams.setRecordingUrl.useMutation({
    onSuccess: () => {
      utils.liveStreams.list.invalidate();
      toast.success("Recording URL removed.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="w-4 h-4" />
            Archive Recording — {stream?.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Paste the recording URL (Zoom cloud recording, YouTube, Google Drive, etc.). Members who attended in person or joined the live stream will get free access. Others will need to use a session pass.
          </p>
          <div className="space-y-1.5">
            <Label>Recording URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://zoom.us/rec/..."
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {stream?.recordingUrl && (
            <Button
              variant="outline"
              className="text-red-500 hover:text-red-600 mr-auto"
              onClick={() => clearRecording.mutate({ streamId: stream.id, recordingUrl: null })}
              disabled={clearRecording.isPending}
            >
              Remove Recording
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!url.trim()) { toast.error("Please enter a recording URL"); return; }
              setRecording.mutate({ streamId: stream!.id, recordingUrl: url.trim() });
            }}
            disabled={setRecording.isPending}
          >
            {setRecording.isPending ? "Saving…" : "Save Recording URL"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Admin Access List Dialog ─────────────────────────────────────────────────

function AccessListDialog({ stream, open, onClose }: { stream: StreamItem | null; open: boolean; onClose: () => void }) {
  const { data: accessList, isLoading } = trpc.liveStreams.accessList.useQuery(
    { streamId: stream?.id ?? 0 },
    { enabled: open && !!stream }
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Access List — {stream?.title}</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-2 max-h-72 overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && (!accessList || accessList.length === 0) && (
            <p className="text-sm text-muted-foreground">No members have accessed this stream yet.</p>
          )}
          {accessList?.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
              <div>
                <p className="font-medium">{a.userName ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{a.userEmail ?? ""}</p>
              </div>
              <div className="text-right">
                <Badge variant={a.accessType === "pass" ? "secondary" : "default"} className="text-xs">
                  {a.accessType === "pass" ? "Pass" : "Purchased"}
                </Badge>
                <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(a.grantedAt), "d MMM yyyy")}</p>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Unlock Recording Dialog (member) ────────────────────────────────────────

function UnlockRecordingDialog({
  stream,
  passBalance,
  open,
  onClose,
}: {
  stream: StreamItem | null;
  passBalance: number;
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();

  const unlock = trpc.liveStreams.unlockRecordingWithPass.useMutation({
    onSuccess: (data) => {
      utils.liveStreams.list.invalidate();
      utils.passes.myPass.invalidate();
      toast.success("Recording unlocked! You can now watch it.");
      if (data?.recordingUrl) window.open(data.recordingUrl, "_blank");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="w-4 h-4" />
            Unlock Recording
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">
            You didn't attend <strong>{stream?.title}</strong> in person or via live stream. To watch the recording, you'll need to use <strong>1 session pass</strong>.
          </p>
          {passBalance >= 1 ? (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{ background: "oklch(0.96 0.02 185)" }}
            >
              <CreditCard className="w-4 h-4 shrink-0" style={{ color: "oklch(0.45 0.12 185)" }} />
              <span className="text-sm" style={{ color: "oklch(0.35 0.07 240)" }}>
                You have <strong>{passBalance}</strong> session{passBalance !== 1 ? "s" : ""} remaining
              </span>
            </div>
          ) : (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{ background: "oklch(0.96 0.02 30)" }}
            >
              <Lock className="w-4 h-4 shrink-0" style={{ color: "oklch(0.55 0.14 30)" }} />
              <span className="text-sm" style={{ color: "oklch(0.35 0.07 240)" }}>
                No pass sessions remaining. Please purchase a pass first.
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => unlock.mutate({ streamId: stream!.id })}
            disabled={passBalance < 1 || unlock.isPending}
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
          >
            {unlock.isPending ? "Unlocking…" : "Use 1 Session — Watch Recording"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stream Card ──────────────────────────────────────────────────────────────

function StreamCard({
  stream,
  isAdmin,
  passBalance,
  onEdit,
  onDelete,
  onViewAccess,
  onSetRecording,
}: {
  stream: StreamItem;
  isAdmin: boolean;
  passBalance: number;
  onEdit: (s: StreamItem) => void;
  onDelete: (s: StreamItem) => void;
  onViewAccess: (s: StreamItem) => void;
  onSetRecording: (s: StreamItem) => void;
}) {
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockRecordingOpen, setUnlockRecordingOpen] = useState(false);
  const utils = trpc.useUtils();

  const now = new Date();
  const isPast = getStreamEndTime(stream) < now;
  const isLive = new Date(stream.scheduledAt) <= now && !isPast; // started but not yet ended
  const hasRecording = !!stream.recordingUrl;

  // For past streams with a recording, check the current user's access status
  const { data: recordingAccess } = trpc.liveStreams.recordingAccessStatus.useQuery(
    { streamId: stream.id },
    { enabled: isPast && hasRecording && !isAdmin }
  );

  const unlockWithPass = trpc.liveStreams.unlockWithPass.useMutation({
    onSuccess: () => {
      utils.liveStreams.list.invalidate();
      utils.passes.myPass.invalidate();
      toast.success("Access granted! The stream link is now visible.");
    },
    onError: (e) => toast.error(e.message),
  });

  const createCheckout = trpc.liveStreams.createCheckout.useMutation({
    onSuccess: (data) => {
      if (data?.checkoutUrl) {
        toast.info("Redirecting to checkout…");
        window.open(data.checkoutUrl, "_blank");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const isLocked = !stream.hasAccess && !isAdmin;
  const canWatchRecording = isAdmin || (recordingAccess?.hasAccess ?? false);
  const recordingReason = recordingAccess?.reason;

  return (
    <>
      <Card className={`border-0 shadow-sm transition-all ${isLocked && !isPast ? "opacity-90" : ""}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: isPast && hasRecording
                    ? "oklch(0.94 0.04 270)"
                    : isLocked
                    ? "oklch(0.92 0.01 240)"
                    : "oklch(0.94 0.06 185)",
                }}
              >
                {isPast && hasRecording ? (
                  <Archive className="w-4 h-4" style={{ color: "oklch(0.45 0.12 270)" }} />
                ) : isLocked ? (
                  <Lock className="w-4 h-4" style={{ color: "oklch(0.55 0.03 240)" }} />
                ) : (
                  <Video className="w-4 h-4" style={{ color: "oklch(0.45 0.12 185)" }} />
                )}
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                  {stream.title}
                </CardTitle>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <CalendarClock className="w-3 h-3" style={{ color: "oklch(0.52 0.03 240)" }} />
                  <span className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {format(new Date(stream.scheduledAt), "EEEE, d MMMM yyyy · h:mm a")}
                    {stream.endsAt && ` – ${format(new Date(stream.endsAt), "h:mm a")}`}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isLive && (
                <Badge className="text-xs animate-pulse" style={{ background: "oklch(0.55 0.18 25)", color: "white" }}>
                  <Video className="w-3 h-3 mr-1" />
                  Live Now
                </Badge>
              )}
              {stream.hasAccess && !isPast && !isLive && (
                <Badge className="text-xs" style={{ background: "oklch(0.55 0.14 185)", color: "white" }}>
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Access
                </Badge>
              )}
              {isPast && hasRecording && (
                <Badge className="text-xs" style={{ background: "oklch(0.55 0.12 270)", color: "white" }}>
                  <Archive className="w-3 h-3 mr-1" />
                  Archived
                </Badge>
              )}
              {isPast && !hasRecording && (
                <Badge variant="secondary" className="text-xs">Past</Badge>
              )}
              {isAdmin && (
                <>
                  {isPast && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title={hasRecording ? "Edit recording URL" : "Add recording URL"}
                      onClick={() => onSetRecording(stream)}
                    >
                      <Film className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onViewAccess(stream)}>
                    <Users className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(stream)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => onDelete(stream)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {stream.description && (
          <CardContent className="pt-0 pb-3">
            <p className="text-sm" style={{ color: "oklch(0.45 0.03 240)" }}>{stream.description}</p>
          </CardContent>
        )}

        <CardContent className="pt-0 space-y-2">

          {/* ── PAST STREAM WITH RECORDING ── */}
          {isPast && hasRecording && (
            <>
              {/* Admin: always show recording link */}
              {isAdmin && (
                <a
                  href={stream.recordingUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                  style={{ background: "oklch(0.55 0.12 270)", color: "white" }}
                >
                  <Film className="w-4 h-4" />
                  Watch Recording
                </a>
              )}

              {/* Member: free access (attended or live stream) */}
              {!isAdmin && canWatchRecording && (
                <div className="space-y-2">
                  <div
                    className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg w-fit"
                    style={{ background: "oklch(0.94 0.06 185)", color: "oklch(0.35 0.12 185)" }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {recordingReason === "attended" && "Free access — you attended this rehearsal"}
                    {recordingReason === "livestream" && "Free access — you joined the live stream"}
                    {recordingReason === "pass" && "Unlocked with a pass session"}
                  </div>
                  <a
                    href={stream.recordingUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                    style={{ background: "oklch(0.55 0.12 270)", color: "white" }}
                  >
                    <Film className="w-4 h-4" />
                    Watch Recording
                  </a>
                </div>
              )}

              {/* Member: no access — prompt to unlock with pass */}
              {!isAdmin && !canWatchRecording && (
                <div className="space-y-2">
                  <div
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg"
                    style={{ background: "oklch(0.95 0.01 240)", color: "oklch(0.45 0.03 240)" }}
                  >
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>Recording available — use a session pass to watch</span>
                  </div>
                  <button
                    onClick={() => setUnlockRecordingOpen(true)}
                    className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                    style={{ background: "oklch(0.55 0.12 270)", color: "white" }}
                  >
                    <Film className="w-4 h-4" />
                    Watch Recording — Use 1 Pass Session
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── PAST STREAM WITHOUT RECORDING ── */}
          {isPast && !hasRecording && isAdmin && (
            <button
              onClick={() => onSetRecording(stream)}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-dashed transition-all hover:border-purple-400 hover:bg-purple-50"
              style={{ color: "oklch(0.52 0.03 240)" }}
            >
              <Link2 className="w-4 h-4" />
              Add Recording URL
            </button>
          )}

          {isPast && !hasRecording && !isAdmin && (
            <p className="text-sm" style={{ color: "oklch(0.6 0.02 240)" }}>
              Recording not yet available.
            </p>
          )}

          {/* ── UPCOMING STREAM ── */}
          {!isPast && (
            <>
              {/* Admin: always show the link */}
              {isAdmin && stream.streamUrl && (
                <a
                  href={stream.streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Stream Link
                </a>
              )}

              {/* Member: unlocked */}
              {!isAdmin && stream.hasAccess && stream.streamUrl && (
                <a
                  href={stream.streamUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all hover:opacity-90"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                >
                  <Unlock className="w-4 h-4" />
                  Join Live Rehearsal
                </a>
              )}

              {/* Member: locked — show purchase options */}
              {!isAdmin && !stream.hasAccess && (
                <div className="space-y-3">
                  <div
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg"
                    style={{ background: "oklch(0.95 0.01 240)", color: "oklch(0.45 0.03 240)" }}
                  >
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>Stream link hidden — unlock to reveal it</span>
                  </div>

                  {passBalance >= 1 && (
                    <button
                      onClick={() => unlockWithPass.mutate({ streamId: stream.id })}
                      disabled={unlockWithPass.isPending}
                      className="w-full text-left rounded-lg border p-3 hover:border-teal-500 hover:bg-teal-50 transition-all cursor-pointer disabled:opacity-60"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                          <CreditCard className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{unlockWithPass.isPending ? "Unlocking…" : `Use 1 Pass Session`}</p>
                          <p className="text-xs text-muted-foreground">{passBalance} session{passBalance !== 1 ? "s" : ""} remaining</p>
                        </div>
                      </div>
                    </button>
                  )}

                  <div className="grid grid-cols-1 gap-2">
                    <button
                      onClick={() => createCheckout.mutate({ streamId: stream.id, origin: window.location.origin, purchaseType: "10-pass" })}
                      disabled={createCheckout.isPending}
                      className="w-full text-left rounded-lg border p-3 hover:border-amber-500 hover:bg-amber-50 transition-all cursor-pointer disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                            <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">10-Session Pass</p>
                            <p className="text-xs text-muted-foreground">Includes access to this stream + 9 future sessions</p>
                          </div>
                        </div>
                        <span className="font-bold text-sm shrink-0" style={{ color: "oklch(0.55 0.14 75)" }}>$140</span>
                      </div>
                    </button>

                    <button
                      onClick={() => createCheckout.mutate({ streamId: stream.id, origin: window.location.origin, purchaseType: "5-pass" })}
                      disabled={createCheckout.isPending}
                      className="w-full text-left rounded-lg border p-3 hover:border-amber-500 hover:bg-amber-50 transition-all cursor-pointer disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                            <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">5-Session Pass</p>
                            <p className="text-xs text-muted-foreground">Includes access to this stream + 4 future sessions</p>
                          </div>
                        </div>
                        <span className="font-bold text-sm shrink-0" style={{ color: "oklch(0.55 0.14 75)" }}>$75</span>
                      </div>
                    </button>

                    <button
                      onClick={() => createCheckout.mutate({ streamId: stream.id, origin: window.location.origin, purchaseType: "single" })}
                      disabled={createCheckout.isPending}
                      className="w-full text-left rounded-lg border p-3 hover:border-amber-500 hover:bg-amber-50 transition-all cursor-pointer disabled:opacity-60"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                            <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">Single Session</p>
                            <p className="text-xs text-muted-foreground">One-time access to this stream only</p>
                          </div>
                        </div>
                        <span className="font-bold text-sm shrink-0" style={{ color: "oklch(0.55 0.14 75)" }}>$16</span>
                      </div>
                    </button>
                  </div>

                  {passBalance < 1 && (
                    <p className="text-xs text-muted-foreground text-center">No pass sessions remaining — purchase a pass or pay per session</p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Unlock recording dialog (member) */}
      <UnlockRecordingDialog
        stream={stream}
        passBalance={passBalance}
        open={unlockRecordingOpen}
        onClose={() => setUnlockRecordingOpen(false)}
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LiveStreams() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();

  const { data: streams, isLoading } = trpc.liveStreams.list.useQuery();
  const { data: myPass } = trpc.passes.myPass.useQuery();
  const utils = trpc.useUtils();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<StreamItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StreamItem | null>(null);
  const [accessTarget, setAccessTarget] = useState<StreamItem | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<StreamItem | null>(null);

  const deleteStream = trpc.liveStreams.delete.useMutation({
    onSuccess: () => { utils.liveStreams.list.invalidate(); toast.success("Stream deleted"); setDeleteTarget(null); },
    onError: (e) => toast.error(e.message),
  });

  // Handle Square success/cancel redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      toast.success("Payment successful! Your stream access has been granted.");
      utils.liveStreams.list.invalidate();
      setLocation("/live-streams");
    } else if (params.get("cancelled") === "1") {
      toast.info("Payment cancelled.");
      setLocation("/live-streams");
    }
  }, []);

  const passBalance = myPass?.remainingSessions ?? 0;

  const now = new Date();
  // A stream is "upcoming/active" if its effective end time hasn't passed yet
  const upcoming = streams?.filter((s) => getStreamEndTime(s) >= now) ?? [];
  const past = streams?.filter((s) => getStreamEndTime(s) < now) ?? [];

  return (
    <BVCLayout>
      <div className="max-w-3xl mx-auto space-y-6 animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Live Rehearsals
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              {isAdmin
                ? "Create and manage gated live rehearsal sessions for members."
                : "Access live rehearsal streams using your pass or a single session purchase."}
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => { setEditTarget(null); setFormOpen(true); }}
              style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
              className="shrink-0 hover:opacity-90"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Rehearsal
            </Button>
          )}
        </div>

        {/* Member pass balance hint */}
        {!isAdmin && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
            style={{ background: "oklch(0.96 0.02 185)" }}
          >
            <CreditCard className="w-4 h-4 shrink-0" style={{ color: "oklch(0.45 0.12 185)" }} />
            <span style={{ color: "oklch(0.35 0.07 240)" }}>
              {passBalance > 0
                ? `You have ${passBalance} pass session${passBalance !== 1 ? "s" : ""} remaining — use one to unlock a stream or past recording.`
                : "You have no pass sessions remaining. Purchase a pass or pay $16 per stream for single access."}
            </span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-36 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        )}

        {/* Upcoming streams */}
        {!isLoading && upcoming.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "oklch(0.45 0.12 185)" }}>
              Upcoming
            </h2>
            {upcoming.map((s) => (
              <StreamCard
                key={s.id}
                stream={s as StreamItem}
                isAdmin={isAdmin}
                passBalance={passBalance}
                onEdit={(s) => { setEditTarget(s); setFormOpen(true); }}
                onDelete={setDeleteTarget}
                onViewAccess={setAccessTarget}
                onSetRecording={setRecordingTarget}
              />
            ))}
          </div>
        )}

        {/* Past streams */}
        {!isLoading && past.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "oklch(0.52 0.03 240)" }}>
              Past
            </h2>
            {past.map((s) => (
              <StreamCard
                key={s.id}
                stream={s as StreamItem}
                isAdmin={isAdmin}
                passBalance={passBalance}
                onEdit={(s) => { setEditTarget(s); setFormOpen(true); }}
                onDelete={setDeleteTarget}
                onViewAccess={setAccessTarget}
                onSetRecording={setRecordingTarget}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (!streams || streams.length === 0) && (
          <div className="text-center py-16">
            <Video className="w-12 h-12 mx-auto mb-3" style={{ color: "oklch(0.75 0.03 240)" }} />
            <p className="font-medium" style={{ color: "oklch(0.45 0.03 240)" }}>No live rehearsals yet</p>
            {isAdmin && (
              <p className="text-sm mt-1" style={{ color: "oklch(0.6 0.02 240)" }}>
                Click "New Rehearsal" to create your first gated rehearsal stream.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Admin create/edit dialog */}
      <StreamFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        initial={editTarget}
      />

      {/* Admin set recording URL dialog */}
      <SetRecordingDialog
        stream={recordingTarget}
        open={!!recordingTarget}
        onClose={() => setRecordingTarget(null)}
      />

      {/* Admin access list dialog */}
      <AccessListDialog
        stream={accessTarget}
        open={!!accessTarget}
        onClose={() => setAccessTarget(null)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Stream?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            This will permanently delete <strong>{deleteTarget?.title}</strong> and remove all member access records. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteStream.mutate({ id: deleteTarget.id })}
              disabled={deleteStream.isPending}
            >
              {deleteStream.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BVCLayout>
  );
}
