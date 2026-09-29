import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Camera, Save, User, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect, useRef } from "react";

const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";
const MUTED = "oklch(0.52 0.03 240)";

export default function Profile() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSetupMode = new URLSearchParams(window.location.search).has("setup");

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    address: "",
    dateOfBirth: "",
    allergens: "",
    voicePart: "",
    singingExperience: "",
  });
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Pre-fill form from current user data
  useEffect(() => {
    if (user) {
      const u = user as any;
      setForm({
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
        phone: u.phone ?? "",
        address: u.address ?? "",
        dateOfBirth: u.dateOfBirth ?? "",
        allergens: u.allergens ?? "",
        voicePart: u.voicePart ?? "",
        singingExperience: u.singingExperience ?? "",
      });
      if (u.avatarUrl) setAvatarPreview(u.avatarUrl);
    }
  }, [user]);

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const updateProfile = trpc.members.updateProfile.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      utils.messages.members.invalidate();
      utils.calendar.events.invalidate();
      if (isSetupMode) {
        toast.success("Profile saved! Welcome to Bundaberg Voice Collective!");
        // Remove setup param and go to dashboard
        window.location.replace("/dashboard");
      } else {
        toast.success("Profile saved");
        setDirty(false);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadAvatar = trpc.members.uploadAvatar.useMutation({
    onSuccess: (data) => {
      setAvatarPreview(data.avatarUrl);
      utils.auth.me.invalidate();
      toast.success("Profile photo updated");
    },
    onError: (e) => toast.error(e.message),
  });

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

  const REQUIRED_FIELDS: (keyof typeof form)[] = ["firstName", "lastName", "phone", "dateOfBirth", "voicePart"];  // address is optional; dateOfBirth is required but year is optional
  const [touched, setTouched] = useState<Partial<Record<keyof typeof form, boolean>>>({});

  const touch = (k: keyof typeof form) => setTouched((t) => ({ ...t, [k]: true }));
  const fieldError = (k: keyof typeof form) => touched[k] && REQUIRED_FIELDS.includes(k) && !form[k];

  const profileComplete = REQUIRED_FIELDS.every((k) => !!form[k]);

  const handleSave = () => {
    const allTouched = REQUIRED_FIELDS.reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);
    const missing = REQUIRED_FIELDS.filter((k) => !form[k]);
    if (missing.length > 0) {
      toast.error("Please fill in all required fields before saving");
      return;
    }
    updateProfile.mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      address: form.address,
      dateOfBirth: form.dateOfBirth,
      allergens: form.allergens || undefined,
      voicePart: form.voicePart as any,
      singingExperience: (form.singingExperience as any) || undefined,
    });
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image must be under 4 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setAvatarPreview(dataUrl);
      uploadAvatar.mutate({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  if (!user) return null;

  const u = user as any;
  const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || user.name || "Member";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <BVCLayout>
      <div className="max-w-2xl space-y-6">
        {/* ── Hero header ──────────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm overflow-hidden">
          {/* Colour band */}
          <div className="h-24" style={{ background: `linear-gradient(135deg, ${TEAL}, oklch(0.45 0.14 220))` }} />
          <CardContent className="pt-0 pb-6 px-6">
            <div className="flex items-end gap-5 -mt-12">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div
                  className="w-24 h-24 rounded-full border-4 border-white shadow-md overflow-hidden flex items-center justify-center text-3xl font-bold"
                  style={{ background: TEAL, color: "white" }}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{initials || <User className="w-10 h-10" />}</span>
                  )}
                </div>
                {/* Upload button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                  className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center shadow-md border-2 border-white transition-opacity hover:opacity-90"
                  style={{ background: TEAL, color: "white" }}
                  title="Change photo"
                >
                  {uploadAvatar.isPending ? (
                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-3.5 h-3.5" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              {/* Name + role */}
              <div className="pb-1">
                <h1 className="text-xl font-display font-bold" style={{ color: NAVY }}>
                  {displayName}
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm" style={{ color: MUTED }}>{user.email}</p>
                  <Badge
                    style={
                      user.role === "admin"
                        ? { background: "oklch(0.78 0.17 75)", color: "oklch(0.18 0.04 240)" }
                        : { background: "oklch(0.92 0.02 240)", color: "oklch(0.45 0.03 240)" }
                    }
                  >
                    {user.role === "admin" ? "Admin" : "Member"}
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── New member setup banner ───────────────────────────────────── */}
        {isSetupMode && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-lg border"
            style={{ background: "oklch(0.94 0.04 185)", borderColor: TEAL }}
          >
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: TEAL }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "oklch(0.30 0.10 185)" }}>Welcome to Bundaberg Voice Collective!</p>
              <p className="text-xs mt-0.5" style={{ color: "oklch(0.40 0.08 185)" }}>
                Please complete your profile below so the choir admin has your correct details. All fields marked with <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span> are required.
              </p>
            </div>
          </div>
        )}

        {/* ── Incomplete profile banner ─────────────────────────────────── */}
        {!profileComplete && !isSetupMode && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-lg border"
            style={{ background: "oklch(0.98 0.02 75)", borderColor: "oklch(0.78 0.17 75)" }}
          >
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "oklch(0.60 0.17 55)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "oklch(0.35 0.10 55)" }}>Profile incomplete</p>
              <p className="text-xs mt-0.5" style={{ color: "oklch(0.50 0.08 55)" }}>
                Please fill in all required fields marked with <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span> so the choir admin has your correct details.
              </p>
            </div>
          </div>
        )}

        {/* ── Personal details form ─────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base" style={{ color: NAVY }}>
              Personal Details
            </CardTitle>
            <p className="text-sm" style={{ color: MUTED }}>
              Your details are only visible to choir administrators. Fields marked <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span> are required.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>First Name <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span></Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  onBlur={() => touch("firstName")}
                  placeholder="Jane"
                  style={fieldError("firstName") ? { borderColor: "oklch(0.577 0.245 27.325)" } : {}}
                />
                {fieldError("firstName") && <p className="text-xs" style={{ color: "oklch(0.577 0.245 27.325)" }}>Required</p>}
              </div>
              <div className="space-y-1.5">
                <Label>Last Name <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span></Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                  onBlur={() => touch("lastName")}
                  placeholder="Smith"
                  style={fieldError("lastName") ? { borderColor: "oklch(0.577 0.245 27.325)" } : {}}
                />
                {fieldError("lastName") && <p className="text-xs" style={{ color: "oklch(0.577 0.245 27.325)" }}>Required</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input value={user.email ?? ""} disabled className="opacity-60" />
              <p className="text-xs" style={{ color: "oklch(0.6 0.02 240)" }}>
                Email is managed by your login provider and cannot be changed here.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Phone Number <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span></Label>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                onBlur={() => touch("phone")}
                placeholder="+61 400 000 000"
                type="tel"
                style={fieldError("phone") ? { borderColor: "oklch(0.577 0.245 27.325)" } : {}}
              />
              {fieldError("phone") && <p className="text-xs" style={{ color: "oklch(0.577 0.245 27.325)" }}>Required</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Address <span className="text-xs font-normal" style={{ color: MUTED }}>(optional)</span></Label>
              <Textarea
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="123 Main St, Bundaberg QLD 4670"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date of Birth <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span></Label>
              <p className="text-xs text-muted-foreground -mt-0.5">Day and month are required. Year is optional — you may leave it blank or enter any year for privacy.</p>
              <div className="flex gap-2">
                {/* Day */}
                <select
                  value={form.dateOfBirth ? form.dateOfBirth.split("-")[2] ?? "" : ""}
                  onChange={(e) => {
                    const parts = form.dateOfBirth ? form.dateOfBirth.split("-") : ["", "", ""];
                    const year = parts[0] || "2000";
                    const month = parts[1] || "01";
                    const day = e.target.value;
                    set("dateOfBirth", day ? `${year}-${month}-${day.padStart(2, "0")}` : "");
                  }}
                  onBlur={() => touch("dateOfBirth")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={fieldError("dateOfBirth") ? { borderColor: "oklch(0.577 0.245 27.325)" } : {}}
                >
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={String(d).padStart(2, "0")}>{d}</option>
                  ))}
                </select>
                {/* Month */}
                <select
                  value={form.dateOfBirth ? form.dateOfBirth.split("-")[1] ?? "" : ""}
                  onChange={(e) => {
                    const parts = form.dateOfBirth ? form.dateOfBirth.split("-") : ["", "", ""];
                    const year = parts[0] || "2000";
                    const month = e.target.value;
                    const day = parts[2] || "01";
                    set("dateOfBirth", month ? `${year}-${month}-${day}` : "");
                  }}
                  onBlur={() => touch("dateOfBirth")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={fieldError("dateOfBirth") ? { borderColor: "oklch(0.577 0.245 27.325)" } : {}}
                >
                  <option value="">Month</option>
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                    <option key={m} value={String(i + 1).padStart(2, "0")}>{m}</option>
                  ))}
                </select>
                {/* Year — optional */}
                <Input
                  type="number"
                  min={1900}
                  max={new Date().getFullYear()}
                  placeholder="Year (optional)"
                  value={(() => { const y = form.dateOfBirth?.split("-")[0]; return y && y !== "2000" ? y : ""; })()}
                  onChange={(e) => {
                    const parts = form.dateOfBirth ? form.dateOfBirth.split("-") : ["2000", "01", "01"];
                    const year = e.target.value || "2000";
                    const month = parts[1] || "01";
                    const day = parts[2] || "01";
                    set("dateOfBirth", `${year}-${month}-${day}`);
                  }}
                  className="w-32"
                />
              </div>
              {fieldError("dateOfBirth") && <p className="text-xs" style={{ color: "oklch(0.577 0.245 27.325)" }}>Please select a day and month</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Voice Part <span style={{ color: "oklch(0.577 0.245 27.325)" }}>*</span>
              </Label>
              <select
                value={form.voicePart}
                onChange={(e) => set("voicePart", e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={!form.voicePart ? { borderColor: "oklch(0.78 0.17 75)" } : {}}
              >
                <option value="">Select your voice part…</option>
                {VOICE_PARTS.map((vp) => (
                  <option key={vp.value} value={vp.value}>{vp.label}</option>
                ))}
              </select>
              {!form.voicePart && (
                <p className="text-xs flex items-center gap-1" style={{ color: "oklch(0.577 0.245 27.325)" }}>
                  <AlertCircle className="w-3 h-3" /> Voice part is required
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Singing Experience <span className="text-xs font-normal" style={{ color: MUTED }}>(optional)</span></Label>
              <select
                value={form.singingExperience}
                onChange={(e) => set("singingExperience", e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Select your experience level…</option>
                {SINGING_EXPERIENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Allergens / Dietary Requirements <span className="text-xs font-normal" style={{ color: MUTED }}>(optional)</span></Label>
              <Textarea
                value={form.allergens}
                onChange={(e) => set("allergens", e.target.value)}
                placeholder="e.g. Peanuts, Gluten-free, Vegan"
                rows={2}
              />
            </div>

            <div className="pt-2">
              <Button
                onClick={handleSave}
                disabled={!dirty || updateProfile.isPending}
                style={{ background: TEAL, color: "white" }}
                className="hover:opacity-90 transition-opacity"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {updateProfile.isPending ? "Saving…" : "Save Profile"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </BVCLayout>
  );
}
