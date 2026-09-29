import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarDays, MapPin, Clock, Plus, Pencil, Trash2, Users, CheckCircle2, XCircle, Image, X, ZoomIn } from "lucide-react";
import BVCLayout from "@/components/BVCLayout";
import { toast } from "sonner";
import { getDisplayName } from "@shared/const";

const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";

const catColors: Record<string, string> = {
  concert: "bg-purple-100 text-purple-800",
  rehearsal: "bg-blue-100 text-blue-800",
  social: "bg-green-100 text-green-800",
  workshop: "bg-orange-100 text-orange-800",
  other: "bg-gray-100 text-gray-700",
};

type EventCategory = "concert" | "rehearsal" | "social" | "workshop" | "other";

interface EventFormData {
  title: string;
  description: string;
  location: string;
  category: EventCategory;
  eventDate: string;
  eventTime: string;
  endTime: string;
  imageUrl?: string;
  imageKey?: string;
}

const emptyForm: EventFormData = {
  title: "",
  description: "",
  location: "",
  category: "other",
  eventDate: "",
  eventTime: "",
  endTime: "",
  imageUrl: undefined,
  imageKey: undefined,
};

function toLocalDateTimeString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time || "00:00"}:00`);
}

// ─── Image Upload Widget ──────────────────────────────────────────────────────

function EventImageUpload({
  imageUrl,
  onUploaded,
  onClear,
}: {
  imageUrl?: string;
  onUploaded: (url: string, key: string) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = trpc.events.uploadImage.useMutation({
    onError: (e) => toast.error(`Image upload failed: ${e.message}`),
  });

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Image too large. Maximum size is ${MAX_MB} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      const result = await upload.mutateAsync({
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });
      onUploaded(result.url, result.key);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <Label>Cover Image (optional)</Label>
      {imageUrl ? (
        <div className="mt-1 relative rounded-lg overflow-hidden" style={{ maxHeight: 180 }}>
          <img src={imageUrl} alt="Event cover" className="w-full object-cover rounded-lg" style={{ maxHeight: 180 }} />
          <button
            type="button"
            onClick={onClear}
            className="absolute top-2 right-2 p-1 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            title="Remove image"
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/40"
          style={{ borderColor: "oklch(0.88 0.02 240)", color: "oklch(0.52 0.03 240)" }}
        >
          <Image className="w-4 h-4" />
          {upload.isPending ? "Uploading..." : "Add a cover image"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

// ─── RSVP Buttons ─────────────────────────────────────────────────────────────
function RsvpSection({ eventId }: { eventId: number }) {
  const utils = trpc.useUtils();
  const { data: myRsvp } = trpc.events.myRsvp.useQuery({ eventId });
  const { data: counts } = trpc.events.rsvpCounts.useQuery({ eventId });
  const rsvpMutation = trpc.events.rsvp.useMutation({
    onSuccess: () => {
      utils.events.myRsvp.invalidate({ eventId });
      utils.events.rsvpCounts.invalidate({ eventId });
    },
  });

  const current = myRsvp?.status ?? null;

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "oklch(0.52 0.03 240)" }}>Your RSVP:</span>
          <button
            onClick={() => rsvpMutation.mutate({ eventId, status: "attending" })}
            disabled={rsvpMutation.isPending}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              current === "attending"
                ? "text-white"
                : "bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-700"
            }`}
            style={current === "attending" ? { background: TEAL, color: "white" } : {}}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Attending
          </button>
          <button
            onClick={() => rsvpMutation.mutate({ eventId, status: "not_attending" })}
            disabled={rsvpMutation.isPending}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              current === "not_attending"
                ? "text-white bg-red-500"
                : "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-700"
            }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            Not Attending
          </button>
        </div>
        {counts && (
          <div className="flex items-center gap-3 text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {counts.attending} attending
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <XCircle className="w-3.5 h-3.5" />
              {counts.not_attending} not attending
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Admin RSVP List ──────────────────────────────────────────────────────────
function AdminRsvpList({ eventId }: { eventId: number }) {
  const { data: list } = trpc.events.rsvpList.useQuery({ eventId });
  const attending = (list ?? []).filter(r => r.status === "attending");
  const notAttending = (list ?? []).filter(r => r.status === "not_attending");
  return (
    <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <Users className="w-3.5 h-3.5" style={{ color: TEAL }} />
        <span className="text-xs font-semibold" style={{ color: NAVY }}>RSVPs</span>
        <span className="text-xs text-green-700 font-medium">{attending.length} attending</span>
        <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>·</span>
        <span className="text-xs text-red-600 font-medium">{notAttending.length} not attending</span>
      </div>
      {attending.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {attending.map(r => (
            <span key={r.id} className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800">
              {getDisplayName(r, "Member")}
            </span>
          ))}
        </div>
      )}
      {notAttending.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {notAttending.map(r => (
            <span key={r.id} className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">
              {getDisplayName(r, "Member")}
            </span>
          ))}
        </div>
      )}
      {list !== undefined && list.length === 0 && (
        <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>No RSVPs yet.</p>
      )}
    </div>
  );
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        onClick={onClose}
        title="Close"
      >
        <X className="w-5 h-5 text-white" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
        style={{ maxHeight: "90vh", maxWidth: "90vw" }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Main Events Page ─────────────────────────────────────────────────────────
export default function Events() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const { data: events } = trpc.events.list.useQuery();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [form, setForm] = useState<EventFormData>(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const createMutation = trpc.events.create.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success("Performance created");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.events.update.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      setDialogOpen(false);
      setEditingEvent(null);
      setForm(emptyForm);
      toast.success("Performance updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.events.delete.useMutation({
    onSuccess: () => {
      utils.events.list.invalidate();
      setDeleteId(null);
      toast.success("Performance deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditingEvent(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (event: any) => {
    const start = new Date(event.eventDate);
    const end = event.endDate ? new Date(event.endDate) : null;
    setEditingEvent(event);
    setForm({
      title: event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      category: event.category as EventCategory,
      eventDate: toLocalDateTimeString(start),
      eventTime: toTimeString(start),
      endTime: end ? toTimeString(end) : "",
      imageUrl: event.imageUrl ?? undefined,
      imageKey: event.imageKey ?? undefined,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim() || !form.eventDate) {
      toast.error("Title and date are required");
      return;
    }
    const eventDate = combineDateAndTime(form.eventDate, form.eventTime);
    const endDate = form.endTime ? combineDateAndTime(form.eventDate, form.endTime) : undefined;

    if (editingEvent) {
      updateMutation.mutate({
        id: editingEvent.id,
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        category: form.category,
        eventDate,
        endDate,
        imageUrl: form.imageUrl ?? null,
        imageKey: form.imageKey ?? null,
      });
    } else {
      createMutation.mutate({
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        category: form.category,
        eventDate,
        endDate,
        imageUrl: form.imageUrl,
        imageKey: form.imageKey,
      });
    }
  };

  const now = new Date();
  const upcoming = (events ?? []).filter((e: any) => new Date(e.eventDate) >= now);
  const past = (events ?? []).filter((e: any) => new Date(e.eventDate) < now);

  const EventCard = ({ event }: { event: any }) => {
    const start = new Date(event.eventDate);
    const end = event.endDate ? new Date(event.endDate) : null;
    const isPast = start < now;
    const [lightboxOpen, setLightboxOpen] = useState(false);
    return (
      <Card className="border-0 shadow-sm overflow-hidden">
        {/* Cover image */}
        {event.imageUrl && (
          <>
            <div
              className="relative w-full overflow-hidden group cursor-zoom-in"
              style={{ height: 160 }}
              onClick={() => setLightboxOpen(true)}
              title="Click to expand"
            >
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.35) 100%)" }} />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.2)" }}>
                <ZoomIn className="w-8 h-8 text-white drop-shadow" />
              </div>
            </div>
            {lightboxOpen && (
              <Lightbox
                src={event.imageUrl}
                alt={event.title}
                onClose={() => setLightboxOpen(false)}
              />
            )}
          </>
        )}
        <div className="h-1.5" style={{ background: isPast ? "oklch(0.85 0.01 240)" : TEAL }} />
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h3 className="font-semibold text-base" style={{ color: isPast ? "oklch(0.55 0.03 240)" : NAVY }}>
                  {event.title}
                </h3>
                <Badge className={`text-xs border-0 ${catColors[event.category] ?? ""}`}>{event.category}</Badge>
              </div>
              {event.description && (
                <p className="text-sm mb-2" style={{ color: "oklch(0.52 0.03 240)" }}>{event.description}</p>
              )}
              <div className="flex flex-wrap gap-3 text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>
                <span className="flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {end && ` – ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                </span>
                {event.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {event.location}
                  </span>
                )}
              </div>

              {/* Admin RSVP list or Member RSVP buttons */}
              {isAdmin ? (
                <AdminRsvpList eventId={event.id} />
              ) : (
                !isPast && <RsvpSection eventId={event.id} />
              )}
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Date badge */}
              <div
                className="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white"
                style={{ background: isPast ? "oklch(0.75 0.02 240)" : TEAL }}
              >
                <span className="text-xl font-bold leading-none">{start.getDate()}</span>
                <span className="text-xs">{start.toLocaleString("default", { month: "short" })}</span>
              </div>

              {/* Admin edit/delete buttons */}
              {isAdmin && (
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(event)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Edit event"
                  >
                    <Pencil className="w-3.5 h-3.5" style={{ color: TEAL }} />
                  </button>
                  <button
                    onClick={() => setDeleteId(event.id)}
                    className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                    title="Delete event"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <BVCLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${TEAL}22` }}>
              <CalendarDays className="w-5 h-5" style={{ color: TEAL }} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold" style={{ color: NAVY }}>Performances</h1>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>Upcoming concerts, rehearsals and social events</p>
            </div>
          </div>
          {isAdmin && (
            <Button onClick={openCreate} size="sm" className="gap-1.5 text-white" style={{ background: TEAL }}>
              <Plus className="w-4 h-4" />
              New Performance
            </Button>
          )}
        </div>

        {/* Upcoming */}
        <div>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "oklch(0.55 0.03 240)" }}>Upcoming Performances</h2>
          {upcoming.length === 0 ? (
            <div className="text-center py-10 rounded-xl border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
              <CalendarDays className="w-10 h-10 mx-auto mb-2" style={{ color: "oklch(0.85 0.02 240)" }} />
              <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>No upcoming performances scheduled.</p>
              {isAdmin && (
                <Button onClick={openCreate} variant="outline" size="sm" className="mt-3 gap-1">
                  <Plus className="w-3.5 h-3.5" /> Create First Performance
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.map((e: any) => <EventCard key={e.id} event={e} />)}
            </div>
          )}
        </div>

        {/* Past */}
        {past.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "oklch(0.55 0.03 240)" }}>Past Performances</h2>
            <div className="space-y-3">
              {past.slice(0, 5).map((e: any) => <EventCard key={e.id} event={e} />)}
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setEditingEvent(null); setForm(emptyForm); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ color: NAVY }}>{editingEvent ? "Edit Performance" : "Create New Performance"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input
                placeholder="e.g. Winter Concert 2026"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={form.eventDate}
                  onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as EventCategory }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="concert">Concert</SelectItem>
                    <SelectItem value="rehearsal">Rehearsal</SelectItem>
                    <SelectItem value="social">Social</SelectItem>
                    <SelectItem value="workshop">Workshop</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={form.eventTime}
                  onChange={e => setForm(f => ({ ...f, eventTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Location</Label>
              <Input
                placeholder="e.g. Bundaberg Civic Centre"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Add details about the event..."
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            {/* Image upload */}
            <EventImageUpload
              imageUrl={form.imageUrl}
              onUploaded={(url, key) => setForm(f => ({ ...f, imageUrl: url, imageKey: key }))}
              onClear={() => setForm(f => ({ ...f, imageUrl: undefined, imageKey: undefined }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="text-white"
              style={{ background: TEAL }}
            >
              {editingEvent ? "Save Changes" : "Create Performance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={o => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Performance?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the performance and all its RSVPs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BVCLayout>
  );
}
