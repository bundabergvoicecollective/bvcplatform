import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell,
  BellOff,
  CheckCheck,
  CreditCard,
  Eye,
  Info,
  Megaphone,
  Music2,
  FileText,
  CalendarDays,
  Pin,
  Plus,
  Trash2,
  Users,
  Paperclip,
  Image,
  Video,
  X,
  Download,
  Pencil,
  ZoomIn,
} from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

// ─── Announcement helpers ─────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  event:     { bg: "oklch(0.97 0.04 75)",  text: "oklch(0.45 0.10 75)",  label: "Event" },
  rehearsal: { bg: "oklch(0.94 0.06 185)", text: "oklch(0.35 0.10 185)", label: "Rehearsal" },
  general:   { bg: "oklch(0.94 0.01 240)", text: "oklch(0.35 0.04 240)", label: "General" },
};

function getDisplayName(u: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.name || "Member";
}

function getInitials(u: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const first = u.firstName?.[0] ?? u.name?.[0] ?? "?";
  const last = u.lastName?.[0] ?? "";
  return (first + last).toUpperCase();
}

// ─── Attachment helpers ───────────────────────────────────────────────────────

type AttachmentType = "image" | "video" | "document";

interface AttachmentState {
  url: string;
  key: string;
  name: string;
  mimeType: string;
  type: AttachmentType;
}

function detectAttachmentType(mimeType: string): AttachmentType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

function AttachmentIcon({ type, className }: { type: AttachmentType; className?: string }) {
  if (type === "image") return <Image className={className} />;
  if (type === "video") return <Video className={className} />;
  return <FileText className={className} />;
}

// ─── Attachment Upload Widget ─────────────────────────────────────────────────

function AttachmentUpload({
  value,
  onChange,
  onClear,
}: {
  value: AttachmentState | null;
  onChange: (a: AttachmentState) => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = trpc.announcements.uploadAttachment.useMutation({
    onError: (e) => toast.error(`Upload failed: ${e.message}`),
  });

  const handleFile = async (file: File) => {
    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`File too large. Maximum size is ${MAX_MB} MB.`);
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
      const attachType = detectAttachmentType(file.type);
      onChange({ url: result.url, key: result.key, name: result.name, mimeType: result.mimeType, type: attachType });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <Label>Attachment (optional)</Label>
      {value ? (
        <div className="mt-1 flex items-center gap-2 p-2.5 rounded-lg border" style={{ borderColor: "oklch(0.88 0.02 240)" }}>
          <span style={{ color: "oklch(0.55 0.14 185)" }}><AttachmentIcon type={value.type} className="w-4 h-4 shrink-0" /></span>
          <span className="flex-1 text-sm truncate" style={{ color: "oklch(0.35 0.04 240)" }}>{value.name}</span>
          <button
            type="button"
            onClick={onClear}
            className="p-1 rounded hover:bg-red-50 transition-colors"
            style={{ color: "oklch(0.577 0.245 27.325)" }}
            title="Remove attachment"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending}
          className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 border-dashed text-sm transition-colors hover:border-blue-400 hover:bg-blue-50/40"
          style={{ borderColor: "oklch(0.88 0.02 240)", color: "oklch(0.52 0.03 240)" }}
        >
          <Paperclip className="w-4 h-4" />
          {upload.isPending ? "Uploading..." : "Attach image, video, or document"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  // Close on Escape key
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

// ─── Attachment Display ───────────────────────────────────────────────────────

function AnnouncementAttachment({ a }: { a: { attachmentUrl?: string | null; attachmentType?: string | null; attachmentName?: string | null } }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!a.attachmentUrl) return null;
  const type = a.attachmentType as AttachmentType | null;

  if (type === "image") {
    return (
      <>
        <div
          className="mt-3 rounded-lg overflow-hidden relative group cursor-zoom-in"
          style={{ maxHeight: 320 }}
          onClick={() => setLightboxOpen(true)}
          title="Click to expand"
        >
          <img
            src={a.attachmentUrl}
            alt={a.attachmentName ?? "Attachment"}
            className="w-full object-cover rounded-lg"
            style={{ maxHeight: 320 }}
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg" style={{ background: "rgba(0,0,0,0.25)" }}>
            <ZoomIn className="w-8 h-8 text-white drop-shadow" />
          </div>
        </div>
        {lightboxOpen && (
          <Lightbox
            src={a.attachmentUrl}
            alt={a.attachmentName ?? "Attachment"}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    );
  }

  if (type === "video") {
    return (
      <div className="mt-3 rounded-lg overflow-hidden">
        <video
          src={a.attachmentUrl}
          controls
          className="w-full rounded-lg"
          style={{ maxHeight: 320 }}
        />
      </div>
    );
  }

  // Document
  return (
    <a
      href={a.attachmentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-colors hover:bg-gray-50"
      style={{ borderColor: "oklch(0.88 0.02 240)", color: "oklch(0.35 0.04 240)" }}
    >
      <FileText className="w-4 h-4 shrink-0" style={{ color: "oklch(0.55 0.14 185)" }} />
      <span className="flex-1 text-sm truncate">{a.attachmentName ?? "Download attachment"}</span>
      <Download className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.65 0.02 240)" }} />
    </a>
  );
}

// ─── Viewers Dialog ───────────────────────────────────────────────────────────

function ViewersDialog({ announcementId, viewCount, title }: { announcementId: number; viewCount: number; title: string }) {
  const [open, setOpen] = useState(false);

  const { data: viewers, isLoading } = trpc.announcements.getViewers.useQuery(
    { announcementId },
    { enabled: open }
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:opacity-80 active:scale-95"
          style={{ background: "oklch(0.94 0.06 185)", color: "oklch(0.35 0.10 185)" }}
          title="See who viewed this announcement"
        >
          <Users className="w-3 h-3" />
          {viewCount === 0 ? "No views yet" : viewCount === 1 ? "1 view" : `${viewCount} views`}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />
            Viewed by
          </DialogTitle>
          <p className="text-xs mt-0.5 truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
            {title}
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 bg-gray-200 rounded animate-pulse" />
                  <div className="h-2.5 w-32 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : !viewers || viewers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <Eye className="w-8 h-8" style={{ color: "oklch(0.78 0.17 75)" }} />
            <p className="text-sm font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No views yet</p>
            <p className="text-xs text-center" style={{ color: "oklch(0.52 0.03 240)" }}>
              Members who open this announcement will appear here.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-72 pr-2">
            <div className="space-y-3 py-1">
              {viewers.map((v) => (
                <div key={v.userId} className="flex items-center gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    {v.avatarUrl && <AvatarImage src={v.avatarUrl} alt={getDisplayName(v)} />}
                    <AvatarFallback className="text-xs font-semibold" style={{ background: "oklch(0.94 0.06 185)", color: "oklch(0.35 0.10 185)" }}>
                      {getInitials(v)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                      {getDisplayName(v)}
                    </p>
                    <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                      {format(new Date(v.readAt), "d MMM yyyy · h:mm a")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <p className="text-xs pt-1 border-t" style={{ color: "oklch(0.65 0.02 240)", borderColor: "oklch(0.92 0.01 240)" }}>
          {viewers?.length ?? 0} {viewers?.length === 1 ? "member has" : "members have"} viewed this announcement
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ─── Auto-mark-viewed hook ────────────────────────────────────────────────────

function useAutoMarkViewed(announcementIds: number[], isAdmin: boolean) {
  const utils = trpc.useUtils();
  const markRead = trpc.announcements.markRead.useMutation({
    onSuccess: () => utils.announcements.list.invalidate(),
  });

  useEffect(() => {
    if (announcementIds.length === 0) return;
    const timer = setTimeout(() => {
      announcementIds.forEach((id) => {
        markRead.mutate({ announcementId: id });
      });
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcementIds.join(",")]);
}

// ─── Edit Announcement Dialog ─────────────────────────────────────────────────

function EditAnnouncementDialog({ announcement, onUpdated }: { announcement: any; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(announcement.title);
  const [body, setBody] = useState(announcement.body);
  const [category, setCategory] = useState<"event" | "rehearsal" | "general">(announcement.category ?? "general");
  const [pinned, setPinned] = useState(announcement.pinned ?? false);
  const [attachment, setAttachment] = useState<AttachmentState | null>(
    announcement.attachmentUrl
      ? { url: announcement.attachmentUrl, key: announcement.attachmentKey ?? "", name: announcement.attachmentName ?? "Attachment", mimeType: "", type: (announcement.attachmentType as AttachmentType) ?? "document" }
      : null
  );

  const utils = trpc.useUtils();
  const update = trpc.announcements.update.useMutation({
    onSuccess: () => {
      utils.announcements.list.invalidate();
      setOpen(false);
      onUpdated();
      toast.success("Announcement updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    update.mutate({
      id: announcement.id,
      title,
      body,
      category,
      pinned,
      attachmentUrl: attachment?.url ?? null,
      attachmentKey: attachment?.key ?? null,
      attachmentType: attachment?.type ?? null,
      attachmentName: attachment?.name ?? null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="p-1.5 rounded-md hover:bg-blue-50 transition-colors"
          style={{ color: "oklch(0.55 0.14 185)" }}
          title="Edit announcement"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Announcement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General Update</SelectItem>
                <SelectItem value="rehearsal">Rehearsal</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Message *</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="mt-1" rows={5} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={pinned} onCheckedChange={setPinned} />
            <Label className="cursor-pointer">Pin this announcement</Label>
          </div>
          <AttachmentUpload
            value={attachment}
            onChange={setAttachment}
            onClear={() => setAttachment(null)}
          />
          <Button
            className="w-full font-semibold"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            disabled={!title || !body || update.isPending}
            onClick={handleSave}
          >
            {update.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Announcement Dialog ───────────────────────────────────────────────

function CreateAnnouncementDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<"event" | "rehearsal" | "general">("general");
  const [pinned, setPinned] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);

  const utils = trpc.useUtils();
  const create = trpc.announcements.create.useMutation({
    onSuccess: () => {
      utils.announcements.list.invalidate();
      setOpen(false);
      setTitle(""); setBody(""); setCategory("general"); setPinned(false); setAttachment(null);
      onCreated();
      toast.success("Announcement posted");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    create.mutate({
      title,
      body,
      category,
      pinned,
      attachmentUrl: attachment?.url,
      attachmentKey: attachment?.key,
      attachmentType: attachment?.type,
      attachmentName: attachment?.name,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2 font-semibold" style={{ background: "oklch(0.55 0.14 185)", color: "white" }}>
          <Plus className="w-4 h-4" /> New Announcement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Post Announcement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input placeholder="e.g. Next Rehearsal, Tuesday 7pm" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General Update</SelectItem>
                <SelectItem value="rehearsal">Rehearsal</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Message *</Label>
            <Textarea placeholder="Write your announcement here..." value={body} onChange={(e) => setBody(e.target.value)} className="mt-1" rows={5} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={pinned} onCheckedChange={setPinned} />
            <Label className="cursor-pointer">Pin this announcement</Label>
          </div>
          <AttachmentUpload
            value={attachment}
            onChange={setAttachment}
            onClear={() => setAttachment(null)}
          />
          <Button
            className="w-full font-semibold"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            disabled={!title || !body || create.isPending}
            onClick={handleCreate}
          >
            {create.isPending ? "Posting..." : "Post Announcement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Notification helpers ─────────────────────────────────────────────────────

const NOTIF_CONFIG = {
  pass_low:     { icon: CreditCard,   bg: "oklch(0.97 0.02 27)",  text: "oklch(0.577 0.245 27.325)", label: "Pass Alert" },
  announcement: { icon: Megaphone,    bg: "oklch(0.94 0.06 185)", text: "oklch(0.35 0.10 185)",      label: "Announcement" },
  general:      { icon: Info,         bg: "oklch(0.94 0.01 240)", text: "oklch(0.35 0.04 240)",      label: "General" },
  library:      { icon: Music2,       bg: "oklch(0.94 0.04 280)", text: "oklch(0.35 0.10 280)",      label: "Music Library" },
  document:     { icon: FileText,     bg: "oklch(0.94 0.03 60)",  text: "oklch(0.40 0.10 60)",       label: "New Document" },
  event:        { icon: CalendarDays, bg: "oklch(0.94 0.04 145)", text: "oklch(0.35 0.10 145)",      label: "New Event" },
};

function NotificationsPanel() {
  const { data: notifications, isLoading, refetch } = trpc.notifications.list.useQuery();
  const utils = trpc.useUtils();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => { refetch(); utils.notifications.unread.invalidate(); },
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => { refetch(); utils.notifications.unread.invalidate(); toast.success("All notifications marked as read"); },
  });

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
      </div>
    );
  }

  if (!notifications || notifications.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <BellOff className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
          <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No notifications</p>
          <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
            You'll be notified when your pass is running low or there are new updates.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="flex items-center gap-2 text-sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            <CheckCheck className="w-4 h-4" /> Mark all read
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {notifications.map((n) => {
          const config = NOTIF_CONFIG[n.type as keyof typeof NOTIF_CONFIG] ?? NOTIF_CONFIG.general;
          const Icon = config.icon;
          return (
            <Card
              key={n.id}
              className={`border-0 shadow-sm transition-all ${!n.read ? "cursor-pointer hover:shadow-md" : ""}`}
              style={!n.read ? { borderLeft: "4px solid oklch(0.55 0.14 185)" } : {}}
              onClick={() => { if (!n.read) markRead.mutate({ notificationId: n.id }); }}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: config.bg }}>
                  <Icon className="w-4 h-4" style={{ color: config.text }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="font-semibold text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>{n.title}</p>
                    <Badge className="text-xs" style={{ background: config.bg, color: config.text }}>{config.label}</Badge>
                    {!n.read && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "oklch(0.55 0.14 185)" }} />}
                  </div>
                  <p className="text-sm" style={{ color: "oklch(0.35 0.04 240)" }}>{n.message}</p>
                  <p className="text-xs mt-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                    {format(new Date(n.createdAt), "d MMM yyyy · h:mm a")}
                  </p>
                </div>
                {!n.read && (
                  <span className="shrink-0 text-xs px-2 py-1 rounded-md" style={{ color: "oklch(0.55 0.14 185)" }}>
                    Tap to read
                  </span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Announcements() {
  const { user } = useAuth();
  const { data: announcements, isLoading, refetch } = trpc.announcements.list.useQuery();
  const { data: unreadNotifs } = trpc.notifications.unread.useQuery();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const del = trpc.announcements.delete.useMutation({
    onSuccess: () => { utils.announcements.list.invalidate(); toast.success("Announcement deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const markRead = trpc.announcements.markRead.useMutation({
    onSuccess: () => utils.announcements.list.invalidate(),
  });

  const unreadIds = useMemo(
    () => (announcements ?? []).filter((a: any) => !a.isRead).map((a: any) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announcements?.length]
  );
  useAutoMarkViewed(unreadIds, isAdmin);

  const announcementIds = useMemo(
    () => (announcements ?? []).map((a: any) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announcements?.length]
  );
  const { data: viewCounts } = trpc.announcements.getViewCounts.useQuery(
    { announcementIds },
    { enabled: isAdmin && announcementIds.length > 0 }
  );

  const unreadAnnouncementsCount = (announcements ?? []).filter((a: any) => !a.isRead).length;
  const unreadNotifsCount = typeof unreadNotifs === 'number' ? unreadNotifs : (unreadNotifs as any)?.length ?? 0;

  return (
    <BVCLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Announcements
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              {isAdmin
                ? "Post updates, events, and rehearsal notices for all members."
                : "Stay up to date with the latest from your choir director."}
            </p>
          </div>
          {isAdmin && <CreateAnnouncementDialog onCreated={() => refetch()} />}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="announcements">
          <TabsList className="mb-4">
            <TabsTrigger value="announcements" className="flex items-center gap-2">
              <Megaphone className="w-4 h-4" />
              Announcements
              {unreadAnnouncementsCount > 0 && (
                <span
                  className="ml-1 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                >
                  {unreadAnnouncementsCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Notifications
              {unreadNotifsCount > 0 && (
                <span
                  className="ml-1 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold"
                  style={{ background: "oklch(0.78 0.17 75)", color: "oklch(0.18 0.04 240)" }}
                >
                  {unreadNotifsCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Announcements tab ──────────────────────────────────────── */}
          <TabsContent value="announcements">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => <div key={i} className="h-32 rounded-xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : !announcements || announcements.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                  <Megaphone className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
                  <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No announcements yet</p>
                  {isAdmin && (
                    <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>Post your first announcement above.</p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {announcements.map((a: any) => {
                  const style = CATEGORY_STYLES[a.category] ?? CATEGORY_STYLES.general;
                  const viewCount = viewCounts?.[a.id] ?? 0;
                  return (
                    <Card
                      key={a.id}
                      className="border-0 shadow-sm transition-shadow hover:shadow-md"
                      style={
                        a.pinned
                          ? { borderLeft: "4px solid oklch(0.78 0.17 75)" }
                          : !a.isRead
                          ? { borderLeft: "4px solid oklch(0.55 0.14 185)" }
                          : {}
                      }
                    >
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {a.pinned && <Pin className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.78 0.17 75)" }} />}
                            <h3 className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>{a.title}</h3>
                            <Badge className="text-xs" style={{ background: style.bg, color: style.text }}>{style.label}</Badge>
                            {!a.isRead && (
                              <Badge className="text-xs" style={{ background: "oklch(0.94 0.06 185)", color: "oklch(0.35 0.10 185)" }}>New</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {!a.isRead && (
                              <button
                                onClick={() => markRead.mutate({ announcementId: a.id })}
                                className="p-1.5 rounded-md hover:bg-blue-50 transition-colors"
                                style={{ color: "oklch(0.55 0.14 185)" }}
                                title="Mark as read"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isAdmin && (
                              <>
                                <EditAnnouncementDialog announcement={a} onUpdated={() => refetch()} />
                                <button
                                  onClick={() => { if (confirm("Delete this announcement?")) del.mutate({ id: a.id }); }}
                                  className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
                                  style={{ color: "oklch(0.577 0.245 27.325)" }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <p className="text-sm whitespace-pre-wrap" style={{ color: "oklch(0.35 0.04 240)" }}>{a.body}</p>
                        {/* Attachment display */}
                        <AnnouncementAttachment a={a} />
                        <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
                          <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                            {format(new Date(a.createdAt), "EEEE, d MMMM yyyy · h:mm a")}
                          </p>
                          {isAdmin && (
                            <ViewersDialog
                              announcementId={a.id}
                              viewCount={viewCount}
                              title={a.title}
                            />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Notifications tab ──────────────────────────────────────── */}
          <TabsContent value="notifications">
            <NotificationsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </BVCLayout>
  );
}
