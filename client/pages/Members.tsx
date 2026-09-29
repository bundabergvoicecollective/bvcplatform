import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Users, Plus, Pencil, Trash2, CreditCard, ChevronDown, ChevronUp, Camera, CalendarDays, UserPlus, Copy, CheckCheck, Mail, Phone, UserCheck, UserX, Clock, SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, History, MinusCircle, Download, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { getDisplayName } from "@shared/const";
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type MemberRow = {
  id: number;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  dateOfBirth: string | null;
  allergens: string | null;
  avatarUrl: string | null;
  memberSince: string | null; // YYYY-MM
  voicePart: "soprano1" | "soprano2" | "altoHigh" | "altoLow" | "tenor" | "bass" | null;
  singingExperience: "beginner" | "some_experience" | "intermediate" | "advanced" | "professional" | null;
  createdAt: Date;
  remainingSessions?: number | null;
  totalSessions?: number | null;
  sessionsAttended?: number | null;
};

// Sort members alphabetically by firstName then lastName (case-insensitive)
function sortMembers<T extends { firstName: string | null; lastName: string | null; name: string | null }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const aFirst = (a.firstName ?? a.name ?? "").toLowerCase();
    const bFirst = (b.firstName ?? b.name ?? "").toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    const aLast = (a.lastName ?? "").toLowerCase();
    const bLast = (b.lastName ?? "").toLowerCase();
    return aLast.localeCompare(bLast);
  });
}

// ─── Admin Sort Types & Function ─────────────────────────────────────────────

type SortField = "name" | "sessionsRemaining" | "sessionsAttended";
type SortDir = "asc" | "desc";

function sortAdminMembers(arr: MemberRow[], field: SortField, dir: SortDir): MemberRow[] {
  return [...arr].sort((a, b) => {
    let cmp = 0;
    if (field === "name") {
      const aName = getDisplayName(a, "").toLowerCase();
      const bName = getDisplayName(b, "").toLowerCase();
      cmp = aName.localeCompare(bName);
    } else if (field === "sessionsRemaining") {
      cmp = (a.remainingSessions ?? 0) - (b.remainingSessions ?? 0);
    } else if (field === "sessionsAttended") {
      cmp = (a.sessionsAttended ?? 0) - (b.sessionsAttended ?? 0);
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

// ─── Month/Year Picker ───────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMemberSince(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month] = value.split("-");
  if (!year || !month) return value;
  const monthName = MONTHS[parseInt(month, 10) - 1];
  return monthName ? `${monthName} ${year}` : value;
}

function MemberSincePicker({
  value,
  onChange,
}: {
  value: string; // YYYY-MM or ""
  onChange: (v: string) => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => currentYear - i);

  const [month, setMonth] = useState(() => value ? value.split("-")[1] ?? "" : "");
  const [year, setYear] = useState(() => value ? value.split("-")[0] ?? "" : "");
  const [manualText, setManualText] = useState("");
  const [showManual, setShowManual] = useState(false);

  // Sync outward when both month + year are set
  const handleMonth = (m: string) => {
    setMonth(m);
    if (year) onChange(`${year}-${m}`);
  };
  const handleYear = (y: string) => {
    setYear(y);
    if (month) onChange(`${y}-${month}`);
  };

  // Manual text entry: accept "MM/YYYY", "Month YYYY", or "YYYY-MM"
  const handleManualBlur = () => {
    const t = manualText.trim();
    if (!t) return;
    // Try YYYY-MM
    if (/^\d{4}-\d{2}$/.test(t)) { onChange(t); return; }
    // Try MM/YYYY
    const mmYYYY = t.match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYYYY) { onChange(`${mmYYYY[2]}-${mmYYYY[1].padStart(2, "0")}`); return; }
    // Try Month YYYY (e.g. "January 2020")
    const monthYear = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (monthYear) {
      const idx = MONTHS.findIndex((m) => m.toLowerCase().startsWith(monthYear[1].toLowerCase()));
      if (idx >= 0) { onChange(`${monthYear[2]}-${String(idx + 1).padStart(2, "0")}`); return; }
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select value={month} onValueChange={handleMonth}>
          <SelectTrigger>
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={m} value={String(i + 1).padStart(2, "0")}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={year} onValueChange={handleYear}>
          <SelectTrigger>
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <button
        type="button"
        className="text-xs underline"
        style={{ color: "oklch(0.55 0.14 185)" }}
        onClick={() => setShowManual((v) => !v)}
      >
        {showManual ? "Hide manual entry" : "Or type a date (e.g. January 2020)"}
      </button>
      {showManual && (
        <Input
          placeholder="e.g. January 2020 or 01/2020"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          onBlur={handleManualBlur}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleManualBlur(); } }}
        />
      )}
      {value && (
        <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>
          Set to: <strong>{formatMemberSince(value)}</strong>
          <button
            type="button"
            className="ml-2 underline"
            style={{ color: "oklch(0.55 0.18 25)" }}
            onClick={() => { setMonth(""); setYear(""); onChange(""); }}
          >Clear</button>
        </p>
      )}
    </div>
  );
}

// ─── Voice Part Labels ───────────────────────────────────────────────────────

const VOICE_PART_LABELS = {
  soprano1: "Soprano 1",
  soprano2: "Soprano 2",
  altoHigh: "Alto High",
  altoLow: "Alto Low",
  tenor: "Tenor",
  bass: "Bass",
} as const;

const SINGING_EXPERIENCE_LABELS = {
  beginner: "Beginner",
  some_experience: "Some Experience",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
} as const;

// ─── Add / Edit Member Dialog ─────────────────────────────────────────────────

function MemberFormDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing?: MemberRow | null;
}) {
  const utils = trpc.useUtils();
  const isEditing = !!existing;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(existing?.avatarUrl ?? null);

  const uploadAvatar = trpc.members.adminUploadAvatar.useMutation({
    onSuccess: (data) => {
      setAvatarPreview(data.avatarUrl);
      utils.members.list.invalidate();
      toast.success("Profile photo updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!existing) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast.error("Image must be under 4 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      uploadAvatar.mutate({ userId: existing.id, base64: dataUrl.split(",")[1], mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const VOICE_PARTS = [
    { value: "soprano1", label: "Soprano 1" },
    { value: "soprano2", label: "Soprano 2" },
    { value: "altoHigh", label: "Alto High" },
    { value: "altoLow", label: "Alto Low" },
    { value: "tenor", label: "Tenor" },
    { value: "bass", label: "Bass" },
  ];

  const SINGING_EXPERIENCE_OPTIONS = [
    { value: "beginner", label: "Beginner — just starting out" },
    { value: "some_experience", label: "Some experience — sung in groups before" },
    { value: "intermediate", label: "Intermediate — comfortable with harmonies" },
    { value: "advanced", label: "Advanced — strong sight-reading ability" },
    { value: "professional", label: "Professional — trained or performing musician" },
  ];

  const [form, setForm] = useState({
    firstName: existing?.firstName ?? "",
    lastName: existing?.lastName ?? "",
    email: existing?.email ?? "",
    phone: existing?.phone ?? "",
    address: existing?.address ?? "",
    dateOfBirth: existing?.dateOfBirth ?? "",
    allergens: existing?.allergens ?? "",
    voicePart: (existing as any)?.voicePart ?? "",
    singingExperience: (existing as any)?.singingExperience ?? "",
    memberSince: (existing as any)?.memberSince ?? "",
    role: (existing?.role ?? "user") as "user" | "admin",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const createMember = trpc.members.create.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success("Member added successfully");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateProfile = trpc.members.adminUpdateProfile.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success("Profile updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!form.firstName.trim()) return toast.error("First name is required");
    if (!form.lastName.trim()) return toast.error("Last name is required");
    if (!form.email.trim()) return toast.error("Email is required");

    if (isEditing && existing) {
      updateProfile.mutate({
        userId: existing.id,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        address: form.address || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        allergens: form.allergens || undefined,
        voicePart: form.voicePart ? (form.voicePart as any) : undefined,
        singingExperience: (form.singingExperience as any) || null,
        memberSince: form.memberSince || null,
      });
    } else {
      createMember.mutate({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone || undefined,
        address: form.address || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        allergens: form.allergens || undefined,
        voicePart: form.voicePart ? (form.voicePart as any) : undefined,
        singingExperience: (form.singingExperience as any) || undefined,
        role: form.role,
      });
    }
  };

  const isPending = createMember.isPending || updateProfile.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Member" : "Add Member"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Avatar section — only shown when editing an existing member */}
          {isEditing && (
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div
                  className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-xl font-bold"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{(existing?.firstName ?? existing?.name)?.charAt(0)?.toUpperCase() ?? "?"}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                  className="absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-white"
                  style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                  title="Change photo"
                >
                  {uploadAvatar.isPending ? (
                    <span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-3 h-3" />
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>
                  {existing?.firstName && existing?.lastName ? `${existing.firstName} ${existing.lastName}` : existing?.name ?? "Member"}
                </p>
                <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>Click the camera icon to change photo</p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First Name *</Label>
              <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Jane" />
            </div>
            <div className="space-y-1.5">
              <Label>Last Name *</Label>
              <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Smith" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email {!isEditing && "*"}</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@example.com"
              disabled={isEditing}
            />
            {isEditing && (
              <p className="text-xs" style={{ color: "oklch(0.6 0.02 240)" }}>Email cannot be changed after creation.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+61 400 000 000" />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Textarea
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="123 Main St, Bundaberg QLD 4670"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Date of Birth</Label>
            <Input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => set("dateOfBirth", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Allergens / Dietary Requirements</Label>
            <Textarea
              value={form.allergens}
              onChange={(e) => set("allergens", e.target.value)}
              placeholder="e.g. Peanuts, Gluten-free, Vegan"
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              Member Since
            </Label>
            <MemberSincePicker
              value={form.memberSince}
              onChange={(v) => set("memberSince", v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Singing Experience <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={form.singingExperience} onValueChange={(v) => set("singingExperience", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select experience level…" />
              </SelectTrigger>
              <SelectContent>
                {SINGING_EXPERIENCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Voice Part</Label>
            <Select value={form.voicePart} onValueChange={(v) => set("voicePart", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select voice part…" />
              </SelectTrigger>
              <SelectContent>
                {VOICE_PARTS.map((vp) => (
                  <SelectItem key={vp.value} value={vp.value}>{vp.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isEditing && (
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => set("role", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending}
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
          >
            {isPending ? "Saving…" : isEditing ? "Save Changes" : "Add Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cash Payment Dialog ──────────────────────────────────────────────────────

type CashPassType = "10-pass" | "5-pass" | "single" | "10-pass-comp" | "5-pass-comp" | "single-comp" | "custom-carryover";

function CashPaymentDialog({
  open,
  onClose,
  member,
}: {
  open: boolean;
  onClose: () => void;
  member: MemberRow;
}) {
  const utils = trpc.useUtils();
  const [passType, setPassType] = useState<CashPassType>("10-pass");
  const [notes, setNotes] = useState("");
  const [customCount, setCustomCount] = useState("1");

  const LABELS: Record<CashPassType, string> = {
    "10-pass": "10-Pass ($140)",
    "5-pass": "5-Pass ($75)",
    "single": "Single Session ($16)",
    "10-pass-comp": "10-Pass — Complimentary",
    "5-pass-comp": "5-Pass — Complimentary",
    "single-comp": "Single Session — Complimentary",
    "custom-carryover": "Carry-Over (Paper Pass Migration)",
  };

  const isComp = passType.endsWith("-comp") || passType === "custom-carryover";
  const isCarryOver = passType === "custom-carryover";

  const recordPayment = trpc.members.recordCashPayment.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      utils.passes.activeForUser.invalidate({ userId: member.id });
      utils.dashboard.adminStats.invalidate();
      utils.attendance.lastSessionStats.invalidate();
      const label = isCarryOver ? `${customCount} carry-over sessions` : LABELS[passType];
      toast.success(`${isComp ? "Complimentary pass" : "Cash payment"} recorded — ${label} assigned to ${member.firstName ?? member.name}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment / Complimentary Pass</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm" style={{ color: "oklch(0.45 0.03 240)" }}>
            Assign a pass to <strong>{member.firstName ?? member.name}</strong>. Sessions are added to their balance immediately.
          </p>
          {(member.remainingSessions ?? 0) > 0 && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs" style={{ background: "oklch(0.97 0.06 75)", color: "oklch(0.40 0.12 75)", border: "1px solid oklch(0.88 0.10 75)" }}>
              <span className="text-base leading-none mt-0.5">⚠️</span>
              <div>
                <span className="font-semibold">{member.firstName ?? member.name} already has {member.remainingSessions} session{member.remainingSessions === 1 ? "" : "s"} remaining.</span>{" "}
                Adding a new pass will <strong>top up</strong> their balance — sessions will be added on top of their current balance.
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Pass Type</Label>
            <Select value={passType} onValueChange={(v) => setPassType(v as CashPassType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10-pass">10-Pass — $140 AUD (Cash)</SelectItem>
                <SelectItem value="5-pass">5-Pass — $75 AUD (Cash)</SelectItem>
                <SelectItem value="single">Single Session — $16 AUD (Cash)</SelectItem>
                <SelectItem value="10-pass-comp">10-Pass — Complimentary ($0)</SelectItem>
                <SelectItem value="5-pass-comp">5-Pass — Complimentary ($0)</SelectItem>
                <SelectItem value="single-comp">Single Session — Complimentary ($0)</SelectItem>
                <SelectItem value="custom-carryover">↪ Carry-Over (Paper Pass Migration)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCarryOver && (
            <div className="space-y-1.5">
              <Label>Sessions Remaining on Paper Card *</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={customCount}
                onChange={(e) => setCustomCount(e.target.value)}
                placeholder="e.g. 6"
              />
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "oklch(0.97 0.04 75)", color: "oklch(0.45 0.10 75)" }}>
                Enter the number of sessions left on their existing paper card. These will be added to their digital balance at no charge.
              </p>
            </div>
          )}
          {isComp && !isCarryOver && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "oklch(0.94 0.04 185)", color: "oklch(0.35 0.1 185)" }}>
              Complimentary passes are recorded at $0 and tracked for reporting purposes.
            </p>
          )}
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isComp ? "e.g. Committee decision, volunteer reward" : "e.g. Paid at rehearsal 19 May"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={recordPayment.isPending}>Cancel</Button>
          <Button
            onClick={() => recordPayment.mutate({
              userId: member.id,
              passType,
              customSessionCount: isCarryOver ? (parseInt(customCount) >= 0 ? parseInt(customCount) : 0) : undefined,
              notes: notes || undefined,
            })}
            disabled={recordPayment.isPending}
            style={{ background: isComp ? "oklch(0.55 0.14 185)" : "oklch(0.78 0.17 75)", color: "white" }}
          >
            {recordPayment.isPending ? "Recording…" : isComp ? "Assign Complimentary" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Activity History (admin-only paper trail) ──────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  attendance_marked: "Attendance Marked",
  attendance_unmarked: "Attendance Un-marked",
  pass_purchased: "Pass Purchased",
  pass_credited: "Pass Credited",
  pass_deducted: "Session Deducted",
  pass_adjusted: "Balance Adjusted",
  comp_granted: "Complimentary Granted",
  cash_payment: "Cash Payment Recorded",
  pass_restored: "Session Restored",
  pass_expired: "Pass Expired",
};

const ACTION_COLORS: Record<string, string> = {
  attendance_marked: "oklch(0.55 0.14 185)",
  attendance_unmarked: "oklch(0.65 0.10 30)",
  pass_purchased: "oklch(0.55 0.17 145)",
  pass_credited: "oklch(0.55 0.17 145)",
  pass_deducted: "oklch(0.65 0.10 30)",
  pass_adjusted: "oklch(0.55 0.12 260)",
  comp_granted: "oklch(0.55 0.14 300)",
  cash_payment: "oklch(0.55 0.17 145)",
  pass_restored: "oklch(0.55 0.14 185)",
  pass_expired: "oklch(0.55 0.10 20)",
};

// ─── Pass History Timeline ───────────────────────────────────────────────────

function PassHistoryTimeline({ memberId }: { memberId: number }) {
  const [open, setOpen] = useState(false);
  const { data: passes, isLoading } = trpc.passes.forUser.useQuery(
    { userId: memberId },
    { enabled: open }
  );

  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: "oklch(0.90 0.01 240)" }}>
      <button
        className="flex items-center gap-2 text-sm font-semibold mb-3 hover:opacity-75 transition-opacity"
        style={{ color: "oklch(0.35 0.05 240)" }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <CreditCard className="w-4 h-4" />
        Pass History
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div>
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>
              <Clock className="w-3.5 h-3.5 animate-spin" /> Loading pass history…
            </div>
          ) : !passes || passes.length === 0 ? (
            <p className="text-xs py-3" style={{ color: "oklch(0.60 0.02 240)" }}>No passes found for this member.</p>
          ) : (
            <div className="relative pl-5">
              {/* Vertical line */}
              <div className="absolute left-2 top-2 bottom-2 w-px" style={{ background: "oklch(0.88 0.01 240)" }} />
              <div className="space-y-3">
                {passes.map((pass, idx) => {
                  const isActive = pass.active;
                  const usedSessions = pass.totalSessions - pass.remainingSessions;
                  const pct = pass.totalSessions > 0 ? Math.round((pass.remainingSessions / pass.totalSessions) * 100) : 0;
                  return (
                    <div key={pass.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className="absolute -left-3 top-2 w-2.5 h-2.5 rounded-full border-2"
                        style={{
                          background: isActive ? "oklch(0.55 0.14 185)" : "oklch(0.88 0.01 240)",
                          borderColor: isActive ? "oklch(0.55 0.14 185)" : "oklch(0.75 0.02 240)",
                        }}
                      />
                      <div
                        className="rounded-lg border p-3 text-xs space-y-1.5"
                        style={{
                          borderColor: isActive ? "oklch(0.80 0.08 185)" : "oklch(0.92 0.01 240)",
                          background: isActive ? "oklch(0.97 0.03 185)" : "oklch(0.98 0.005 240)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-semibold" style={{ color: "oklch(0.22 0.07 240)" }}>
                            {pass.totalSessions}-Session Pass
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isActive ? (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "oklch(0.55 0.14 185)", color: "white" }}>Active</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "oklch(0.88 0.01 240)", color: "oklch(0.50 0.03 240)" }}>Expired</span>
                            )}
                            {idx === 0 && passes.length > 1 && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ background: "oklch(0.96 0.04 75)", color: "oklch(0.45 0.12 75)" }}>Latest</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5" style={{ color: "oklch(0.45 0.03 240)" }}>
                          <span>Assigned: {new Date(pass.assignedAt).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}</span>
                          <span>{pass.remainingSessions} remaining / {pass.totalSessions} total</span>
                          <span>{usedSessions} used</span>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "oklch(0.90 0.01 240)" }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              background: pct > 30 ? "oklch(0.55 0.14 185)" : pct > 10 ? "oklch(0.70 0.15 60)" : "oklch(0.55 0.22 25)",
                            }}
                          />
                        </div>
                        {pass.notes && (
                          <p className="italic" style={{ color: "oklch(0.55 0.03 240)" }}>Note: {pass.notes}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityHistory({ memberId }: { memberId: number }) {
  const [open, setOpen] = useState(false);
  const { data: log, isLoading } = trpc.members.activityLog.useQuery(
    { userId: memberId },
    { enabled: open }
  );

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: "oklch(0.90 0.01 240)" }}>
      <button
        className="flex items-center gap-2 text-sm font-semibold mb-3 hover:opacity-75 transition-opacity"
        style={{ color: "oklch(0.35 0.05 240)" }}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <History className="w-4 h-4" />
        Account Activity History
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "oklch(0.90 0.01 240)" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-sm" style={{ color: "oklch(0.55 0.03 240)" }}>
              <Clock className="w-4 h-4 animate-spin" />
              Loading history…
            </div>
          ) : !log || log.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <History className="w-6 h-6" style={{ color: "oklch(0.75 0.02 240)" }} />
              <p className="text-xs" style={{ color: "oklch(0.60 0.02 240)" }}>No activity recorded yet.</p>
              <p className="text-xs" style={{ color: "oklch(0.70 0.02 240)" }}>Future pass and attendance changes will appear here.</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead style={{ background: "oklch(0.96 0.005 240)" }}>
                <tr>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "oklch(0.35 0.05 240)" }}>Date &amp; Time</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "oklch(0.35 0.05 240)" }}>Action</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "oklch(0.35 0.05 240)" }}>Details</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "oklch(0.35 0.05 240)" }}>Balance</th>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: "oklch(0.35 0.05 240)" }}>Performed By</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id} className="border-t" style={{ borderColor: "oklch(0.93 0.01 240)" }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "oklch(0.50 0.03 240)" }}>
                      {format(new Date(entry.createdAt), "d MMM yyyy, h:mm a")}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-white text-[10px] font-semibold"
                        style={{ background: ACTION_COLORS[entry.action] ?? "oklch(0.55 0.05 240)" }}
                      >
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-3 py-2" style={{ color: "oklch(0.40 0.03 240)" }}>
                      {entry.detail ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono" style={{ color: "oklch(0.40 0.03 240)" }}>
                      {entry.balanceBefore !== null && entry.balanceAfter !== null
                        ? `${entry.balanceBefore} → ${entry.balanceAfter}`
                        : entry.balanceAfter !== null
                        ? `→ ${entry.balanceAfter}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "oklch(0.50 0.03 240)" }}>
                      {entry.actorName
                        ? entry.actorName
                        : entry.actorId
                        ? `Admin #${entry.actorId}`
                        : "System"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Admin Member Row (expandable) ───────────────────────────────────────────

function AdminMemberRow({
  m,
  isSelf,
  onEdit,
  onDelete,
  onCashPayment,
  initialExpanded = false,
  highlighted = false,
}: {
  m: MemberRow;
  isSelf: boolean;
  onEdit: (m: MemberRow) => void;
  onDelete: (m: MemberRow) => void;
  onCashPayment: (m: MemberRow) => void;
  initialExpanded?: boolean;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const rowRef = useRef<HTMLTableRowElement>(null);
  // Scroll into view when highlighted
  useEffect(() => {
    if (highlighted && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);
  const [roleConfirmOpen, setRoleConfirmOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustValue, setAdjustValue] = useState<string>("");
  const [adjustReason, setAdjustReason] = useState("");
  const [deductOpen, setDeductOpen] = useState(false);
  const [deductReason, setDeductReason] = useState("");
  const utils = trpc.useUtils();

  const adjustMutation = trpc.passes.adminAdjust.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      utils.passes.activeForUser.invalidate({ userId: m.id });
      utils.dashboard.adminStats.invalidate();
      toast.success(`Sessions updated for ${getDisplayName(m)}.`);
      setAdjustOpen(false);
      setAdjustValue("");
      setAdjustReason("");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateRole = trpc.members.updateRole.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success(
        m.role === "admin"
          ? `${getDisplayName(m)} has been demoted to Member.`
          : `${getDisplayName(m)} has been promoted to Admin.`
      );
      setRoleConfirmOpen(false);
    },
    onError: (e) => {
      toast.error(e.message);
      setRoleConfirmOpen(false);
    },
  });

  const targetRole = m.role === "admin" ? "user" : "admin";
  const roleActionLabel = m.role === "admin" ? "Demote to Member" : "Promote to Admin";

  return (
    <>
      <tr
        ref={rowRef}
        className={"border-b hover:bg-gray-50 transition-colors cursor-pointer" + (highlighted ? " ring-2 ring-inset ring-teal-400 bg-teal-50/40" : "")}
        style={{ borderColor: "oklch(0.94 0.01 240)" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            {(m as any).avatarUrl ? (
              <img
                src={(m as any).avatarUrl}
                alt={getDisplayName(m, "Avatar")}
                className="w-8 h-8 rounded-full object-cover shrink-0"
                style={{ border: "1.5px solid oklch(0.55 0.14 185)" }}
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
              >
                {getDisplayName(m, "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-medium text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                {getDisplayName(m, "Unknown")}
                {m.voicePart && (
                  <span className="ml-1 text-xs font-normal" style={{ color: "oklch(0.55 0.14 185)" }}>
                    ({VOICE_PART_LABELS[m.voicePart as keyof typeof VOICE_PART_LABELS] ?? m.voicePart})
                  </span>
                )}
                {isSelf && <span className="ml-1 text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>(you)</span>}
              </p>
              <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{m.email ?? "—"}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
          {m.phone ?? "—"}
        </td>
        <td className="px-4 py-3">
          <Badge
            style={
              m.role === "admin"
                ? { background: "oklch(0.78 0.17 75)", color: "oklch(0.18 0.04 240)" }
                : { background: "oklch(0.92 0.02 240)", color: "oklch(0.45 0.03 240)" }
            }
          >
            {m.role === "admin" ? "Admin" : "Member"}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
          {m.memberSince ? formatMemberSince(m.memberSince) : (
            <span style={{ color: "oklch(0.7 0.02 240)" }}>Not set</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm font-semibold">
          {m.remainingSessions != null ? (
            <span style={{
              color: m.remainingSessions <= 2
                ? "oklch(0.55 0.22 25)"
                : "oklch(0.35 0.05 240)",
            }}>
              {m.remainingSessions}
              {m.remainingSessions <= 2 && (
                <span className="ml-1 text-xs font-normal" style={{ color: "oklch(0.55 0.22 25)" }}>⚠ low</span>
              )}
            </span>
          ) : (
            <span style={{ color: "oklch(0.7 0.02 240)" }}>—</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm font-semibold">
          <span style={{ color: "oklch(0.35 0.05 240)" }}>
            {m.sessionsAttended ?? 0}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 gap-1 text-xs"
              onClick={() => onCashPayment(m)}
              title="Record cash payment"
            >
              <CreditCard className="w-3 h-3" />
              Add Payment
            </Button>
            {m.remainingSessions != null && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={(e) => { e.stopPropagation(); setAdjustValue(String(m.remainingSessions ?? 0)); setAdjustOpen(true); }}
                  title="Adjust session balance"
                  style={{ color: "oklch(0.45 0.12 260)", borderColor: "oklch(0.78 0.08 260)" }}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Adjust
                </Button>
                {(m.remainingSessions ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 gap-1 text-xs"
                    onClick={(e) => { e.stopPropagation(); setDeductReason(""); setDeductOpen(true); }}
                    title="Manually deduct 1 session (error correction)"
                    style={{ color: "oklch(0.52 0.18 25)", borderColor: "oklch(0.78 0.12 25)" }}
                  >
                    <TrendingDown className="w-3 h-3" />
                    Deduct
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(m)}
              title="Edit member"
            >
              <Pencil className="w-3 h-3" />
            </Button>
            {!isSelf && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={(e) => { e.stopPropagation(); setRoleConfirmOpen(true); }}
                  title={roleActionLabel}
                  style={m.role === "admin"
                    ? { color: "oklch(0.52 0.03 240)", borderColor: "oklch(0.82 0.02 240)" }
                    : { color: "oklch(0.55 0.14 185)", borderColor: "oklch(0.78 0.12 185)" }
                  }
                >
                  {m.role === "admin" ? "↓ Demote" : "↑ Promote"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-7 p-0 hover:bg-red-50 hover:border-red-300"
                  onClick={() => onDelete(m)}
                  title="Delete member"
                  style={{ color: "oklch(0.55 0.18 25)" }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            )}
            {expanded ? (
              <ChevronUp className="w-4 h-4 ml-1" style={{ color: "oklch(0.6 0.02 240)" }} />
            ) : (
              <ChevronDown className="w-4 h-4 ml-1" style={{ color: "oklch(0.6 0.02 240)" }} />
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: "oklch(0.97 0.005 240)" }}>
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Address: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>{m.address || "—"}</span>
              </div>
              <div>
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Date of Birth: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>
                  {m.dateOfBirth ? format(new Date(m.dateOfBirth), "d MMM yyyy") : "—"}
                </span>
              </div>
              <div>
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Voice Part: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>
                  {(m as any).voicePart ? (VOICE_PART_LABELS[(m as any).voicePart as keyof typeof VOICE_PART_LABELS] ?? (m as any).voicePart) : "—"}
                </span>
              </div>
              <div>
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Singing Experience: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>
                  {(m as any).singingExperience ? SINGING_EXPERIENCE_LABELS[(m as any).singingExperience as keyof typeof SINGING_EXPERIENCE_LABELS] ?? (m as any).singingExperience : "—"}
                </span>
              </div>
              <div>
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Member Since: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>
                  {formatMemberSince((m as any).memberSince)}
                </span>
              </div>
              <div className="col-span-2">
                <span className="font-medium" style={{ color: "oklch(0.35 0.05 240)" }}>Allergens: </span>
                <span style={{ color: "oklch(0.45 0.03 240)" }}>{m.allergens || "None recorded"}</span>
              </div>
            </div>
            <PassHistoryTimeline memberId={m.id} />
            <ActivityHistory memberId={m.id} />
          </td>
        </tr>
      )}

      {/* Role change confirmation */}
      <AlertDialog open={roleConfirmOpen} onOpenChange={(v) => !v && setRoleConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{roleActionLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {m.role === "admin"
                ? <>Are you sure you want to demote <strong>{getDisplayName(m)}</strong> from Admin to Member? They will lose all admin privileges.</>
                : <>Are you sure you want to promote <strong>{getDisplayName(m)}</strong> to Admin? They will gain full admin access to all member data and settings.</>
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => updateRole.mutate({ userId: m.id, role: targetRole })}
              disabled={updateRole.isPending}
              style={m.role === "admin"
                ? { background: "oklch(0.52 0.03 240)", color: "white" }
                : { background: "oklch(0.55 0.14 185)", color: "white" }
              }
            >
              {updateRole.isPending ? "Saving…" : roleActionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manually deduct 1 session */}
      <Dialog open={deductOpen} onOpenChange={(v) => { if (!v) { setDeductOpen(false); setDeductReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              Deduct 1 Session
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="px-3 py-2.5 rounded-lg text-xs" style={{ background: "oklch(0.97 0.04 25)", color: "oklch(0.40 0.12 25)", border: "1px solid oklch(0.88 0.10 25)" }}>
              <strong>{getDisplayName(m)}</strong> currently has <strong>{m.remainingSessions ?? 0} session{(m.remainingSessions ?? 0) === 1 ? "" : "s"} remaining</strong>.
              This will deduct 1 session, leaving them with <strong>{Math.max(0, (m.remainingSessions ?? 0) - 1)}</strong>.
            </div>
            <div className="space-y-1">
              <Label>Reason for deduction *</Label>
              <Input
                value={deductReason}
                onChange={(e) => setDeductReason(e.target.value)}
                placeholder="e.g. Attended but pass not deducted at rehearsal"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeductOpen(false)} disabled={adjustMutation.isPending}>Cancel</Button>
            <Button
              disabled={adjustMutation.isPending || !deductReason.trim()}
              onClick={() => {
                const newVal = Math.max(0, (m.remainingSessions ?? 0) - 1);
                adjustMutation.mutate({ userId: m.id, newRemaining: newVal, reason: `Manual deduct: ${deductReason}` });
                setDeductOpen(false);
                setDeductReason("");
              }}
              style={{ background: "oklch(0.52 0.18 25)", color: "white" }}
            >
              {adjustMutation.isPending ? "Deducting…" : "Deduct 1 Session"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust session balance */}
      <Dialog open={adjustOpen} onOpenChange={(v) => { if (!v) { setAdjustOpen(false); setAdjustValue(""); setAdjustReason(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Session Balance</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              Set the exact number of remaining sessions for <strong>{getDisplayName(m)}</strong>.
              Current balance: <strong>{m.remainingSessions ?? 0}</strong>
            </p>
            <div className="space-y-1">
              <Label>New Session Count</Label>
              <Input
                type="number"
                min={0}
                max={200}
                value={adjustValue}
                onChange={(e) => setAdjustValue(e.target.value)}
                placeholder="e.g. 6"
              />
            </div>
            <div className="space-y-1">
              <Label>Reason (optional)</Label>
              <Input
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="e.g. Used in error, correcting balance"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
            <Button
              disabled={adjustMutation.isPending || adjustValue === "" || isNaN(Number(adjustValue))}
              onClick={() => adjustMutation.mutate({ userId: m.id, newRemaining: Number(adjustValue), reason: adjustReason || undefined })}
              style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            >
              {adjustMutation.isPending ? "Saving…" : "Save Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Invite Member Dialog ────────────────────────────────────────────────────

function InviteMemberDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const createInvite = trpc.invites.create.useMutation({
    onSuccess: (data) => setResult({ inviteUrl: data.inviteUrl, emailSent: data.emailSent }),
    onError: (e) => toast.error(e.message),
  });

  const handleSend = () => {
    if (!email.trim()) {
      toast.error("Please enter an email address.");
      return;
    }
    createInvite.mutate({ email: email.trim(), note: note.trim() || undefined, origin: window.location.origin });
  };

  const handleCopy = async () => {
    if (!result?.inviteUrl) return;
    await navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    toast.success("Invite link copied!");
  };

  const handleClose = () => {
    setEmail("");
    setNote("");
    setResult(null);
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" style={{ color: "oklch(0.55 0.14 185)" }} />
            Invite a New Member
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4 py-2">
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
              Enter the new member’s email address. They will receive a personalised invite link
              and must verify their email to complete membership. The link expires after 30 days.
            </p>

            <div>
              <Label className="flex items-center gap-1.5 mb-1">
                <Mail className="w-3.5 h-3.5" /> Email address <span className="text-xs font-normal text-red-500">*</span>
              </Label>
              <Input
                type="email"
                placeholder="e.g. jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                autoFocus
              />
            </div>

            <div>
              <Label className="mb-1 block">Note <span className="text-xs font-normal" style={{ color: "oklch(0.65 0.02 240)" }}>(optional, for your reference)</span></Label>
              <Textarea
                placeholder="e.g. Soprano from Tuesday rehearsal"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleSend}
                disabled={createInvite.isPending || !email.trim()}
                style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
              >
                {createInvite.isPending ? "Sending…" : "Send Invite Email"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-lg p-4 space-y-2" style={{ background: "oklch(0.96 0.03 185)" }}>
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 shrink-0" style={{ color: "oklch(0.55 0.14 185)" }} />
                <p className="font-semibold text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>Invite sent!</p>
              </div>
              {result.emailSent ? (
                <p className="text-sm" style={{ color: "oklch(0.35 0.05 185)" }}>
                  An invitation email has been sent to <strong>{email}</strong>. They must verify their email address and sign in to accept membership.
                </p>
              ) : (
                <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                  Invite link generated for <strong>{email}</strong>. Email sending is not yet configured — copy the link below and send it manually.
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1 block text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>Invite link</Label>
              <p className="text-xs break-all font-mono px-3 py-2 rounded border" style={{ background: "oklch(0.98 0.005 240)", color: "oklch(0.45 0.05 240)" }}>
                {result.inviteUrl}
              </p>
            </div>

            <Button
              className="w-full font-semibold"
              onClick={handleCopy}
              style={{ background: copied ? "oklch(0.55 0.14 140)" : "oklch(0.55 0.14 185)", color: "white" }}
            >
              {copied ? (
                <><CheckCheck className="w-4 h-4 mr-2" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4 mr-2" /> Copy Invite Link</>
              )}
            </Button>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Members() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const [location] = useLocation();
  const [highlightId, setHighlightId] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const h = params.get("highlight");
    return h ? parseInt(h, 10) : null;
  });
  // Clear highlight after 4 seconds
  useEffect(() => {
    if (highlightId) {
      const t = setTimeout(() => setHighlightId(null), 4000);
      return () => clearTimeout(t);
    }
  }, [highlightId]);

  // admins use list (full profile), members use listAll (same data, protected but not admin-gated)
  const adminQuery = trpc.members.list.useQuery(undefined, { enabled: isAdmin });
  const memberQuery = trpc.members.listAll.useQuery(undefined, { enabled: !isAdmin });
  const { data: members, isLoading } = isAdmin ? adminQuery : memberQuery;

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MemberRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null);
  const [cashTarget, setCashTarget] = useState<MemberRow | null>(null);
    const [inviteOpen, setInviteOpen] = useState(false);
  // Admin sort controls
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Pending approvals
  const pendingQuery = trpc.members.listPending.useQuery(undefined, { enabled: isAdmin });
  const pendingMembers = pendingQuery.data ?? [];

  const approveUser = trpc.members.approve.useMutation({
    onSuccess: () => {
      utils.members.listPending.invalidate();
      utils.members.list.invalidate();
      toast.success("Member approved — they can now access the platform");
    },
    onError: (e) => toast.error(e.message),
  });

  const denyUser = trpc.members.deny.useMutation({
    onSuccess: () => {
      utils.members.listPending.invalidate();
      utils.members.list.invalidate();
      toast.success("Member denied");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMember = trpc.members.delete.useMutation({
    onSuccess: () => {
      utils.members.list.invalidate();
      toast.success("Member removed");
      setDeleteTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Member (non-admin) view ──────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <BVCLayout>
        <div className="space-y-6">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Members
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              Your fellow Bundaberg Voice Collective members.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : !members || members.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                <Users className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
                <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No members yet</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-0 shadow-sm overflow-hidden">
              <div className="divide-y" style={{ borderColor: "oklch(0.94 0.01 240)" }}>
                {sortMembers(members).map((m) => {
                  const displayName = getDisplayName(m, "Unknown");
                  const initials = displayName.charAt(0).toUpperCase();
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                      {(m as any).avatarUrl ? (
                        <img
                          src={(m as any).avatarUrl}
                          alt={displayName}
                          className="w-8 h-8 rounded-full object-cover shrink-0"
                          style={{ border: "1.5px solid oklch(0.55 0.14 185)" }}
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                          style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                        >
                          {initials}
                        </div>
                      )}
                      <span className="font-medium text-sm" style={{ color: "oklch(0.22 0.07 240)" }}>
                        {displayName}
                {(m as any).voicePart && (
                  <span className="ml-1 text-xs font-normal" style={{ color: "oklch(0.55 0.14 185)" }}>
                    ({VOICE_PART_LABELS[(m as any).voicePart as keyof typeof VOICE_PART_LABELS] ?? (m as any).voicePart})
                  </span>
                )}
                {(m as any).id === user?.id && (
                          <span className="ml-2 text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>(you)</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </BVCLayout>
    );
  }

  // ── Admin view ───────────────────────────────────────────────────────────────
  return (
    <BVCLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Members
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              Manage all choir members, their profiles, and payments.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => setInviteOpen(true)}
              variant="outline"
              className="shrink-0 hover:opacity-90"
              style={{ borderColor: "oklch(0.55 0.14 185)", color: "oklch(0.55 0.14 185)" }}
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              Invite Member
            </Button>
            <Button
              onClick={() => setAddOpen(true)}
              style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
              className="shrink-0 hover:opacity-90"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Member
            </Button>
          </div>
        </div>

        {/* Pending Approvals Section */}
        {isAdmin && (pendingMembers.length > 0 || pendingQuery.isLoading) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" style={{ color: "oklch(0.78 0.17 75)" }} />
              <h2 className="font-semibold text-base" style={{ color: "oklch(0.22 0.07 240)" }}>Pending Approvals</h2>
              {pendingMembers.length > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white" style={{ background: "oklch(0.78 0.17 75)" }}>
                  {pendingMembers.length}
                </span>
              )}
            </div>
            {pendingQuery.isLoading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <Card className="border-0 shadow-sm overflow-hidden">
                <div className="divide-y" style={{ borderColor: "oklch(0.92 0.02 240)" }}>
                  {pendingMembers.map((pm) => (
                    <div key={pm.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-semibold text-sm text-white" style={{ background: "oklch(0.55 0.14 185)" }}>
                          {getDisplayName(pm, "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
                            {getDisplayName(pm, "(No name yet)")}
                          </p>
                          <p className="text-xs truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
                            {pm.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={() => approveUser.mutate({ userId: pm.id })}
                          disabled={approveUser.isPending || denyUser.isPending}
                          className="gap-1.5 font-semibold"
                          style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => denyUser.mutate({ userId: pm.id })}
                          disabled={approveUser.isPending || denyUser.isPending}
                          className="gap-1.5 font-semibold"
                          style={{ borderColor: "oklch(0.55 0.18 25)", color: "oklch(0.55 0.18 25)" }}
                        >
                          <UserX className="w-3.5 h-3.5" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Sort Controls */}
        {!isLoading && members && members.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4" style={{ color: "oklch(0.52 0.03 240)" }} />
              <span className="text-sm font-medium" style={{ color: "oklch(0.52 0.03 240)" }}>Sort by:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(["name", "sessionsRemaining", "sessionsAttended"] as SortField[]).map((field) => {
                const labels: Record<SortField, string> = {
                  name: "Member Name",
                  sessionsRemaining: "Sessions Remaining",
                  sessionsAttended: "Sessions Attended",
                };
                const isActive = sortField === field;
                return (
                  <button
                    key={field}
                    onClick={() => {
                      if (isActive) {
                        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                      } else {
                        setSortField(field);
                        setSortDir("asc");
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: isActive ? "oklch(0.22 0.07 240)" : "oklch(0.94 0.01 240)",
                      color: isActive ? "white" : "oklch(0.35 0.05 240)",
                      border: isActive ? "1.5px solid oklch(0.22 0.07 240)" : "1.5px solid oklch(0.88 0.02 240)",
                    }}
                  >
                    {labels[field]}
                    {isActive ? (
                      sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {/* Table */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !members || members.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
              <Users className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>No members yet</p>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                Click "Add Member" to manually create a member account.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "oklch(0.22 0.07 240)" }}>
                    <th className="text-left px-4 py-3 font-semibold text-white">Member</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Phone</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Member Since</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Sessions Remaining</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Sessions Attended</th>
                    <th className="text-left px-4 py-3 font-semibold text-white">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortAdminMembers(members as MemberRow[], sortField, sortDir).map((m) => (
                    <AdminMemberRow
                      key={m.id}
                      m={m}
                      isSelf={m.id === user?.id}
                      onEdit={setEditTarget}
                      onDelete={setDeleteTarget}
                      onCashPayment={setCashTarget}
                      initialExpanded={highlightId === m.id}
                      highlighted={highlightId === m.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Add Member dialog */}
      <MemberFormDialog open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Edit Member dialog */}
      {editTarget && (
        <MemberFormDialog
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          existing={editTarget}
        />
      )}

      {/* Cash Payment dialog */}
      {cashTarget && (
        <CashPaymentDialog
          open={!!cashTarget}
          onClose={() => setCashTarget(null)}
          member={cashTarget}
        />
      )}

      {/* Invite Member dialog */}
      <InviteMemberDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently remove <strong>{deleteTarget?.name}</strong>? This will delete all their attendance records, passes, and messages and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMember.mutate({ userId: deleteTarget.id })}
              style={{ background: "oklch(0.55 0.18 25)", color: "white" }}
            >
              {deleteMember.isPending ? "Removing…" : "Remove Member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BVCLayout>
  );
}
