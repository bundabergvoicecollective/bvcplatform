import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users, CalendarDays, Megaphone, Music, CreditCard, MessageSquare,
  Plus, Trash2, Edit2, Shield, ShieldOff, CheckCircle, XCircle,
  BarChart3, Upload, Bell, Settings, Eye, DollarSign, AlertTriangle, History, Search, Filter, Download
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { useLocation } from "wouter";
import BVCLayout from "@/components/BVCLayout";
import { getDisplayName } from "@shared/const";

const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${color}22` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: NAVY }}>{value}</p>
            <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Members Tab ─────────────────────────────────────────────────────────────
function MembersTab() {
  const { user: currentUser } = useAuth();
  const { data: members, refetch } = trpc.members.list.useQuery();
  const utils = trpc.useUtils();
  const updateRole = trpc.members.updateRole.useMutation({
    onSuccess: () => { toast.success("Role updated"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteUser = trpc.members.delete.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      refetch();
      utils.dashboard.adminStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>All Members ({members?.length ?? 0})</p>
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "oklch(0.97 0.005 240)" }}>
            <tr>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Name</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Email</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Role</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Joined</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <tr key={m.id} className="border-t" style={{ borderColor: "oklch(0.95 0.005 240)" }}>
                <td className="py-2.5 px-4 font-medium" style={{ color: NAVY }}>{getDisplayName(m, "—")}</td>
                <td className="py-2.5 px-4" style={{ color: "oklch(0.52 0.03 240)" }}>{m.email ?? "—"}</td>
                <td className="py-2.5 px-4">
                  <Badge className={m.role === "admin" ? "bg-amber-100 text-amber-800 border-0" : "bg-teal-50 text-teal-700 border-0"}>
                    {m.role}
                  </Badge>
                </td>
                <td className="py-2.5 px-4" style={{ color: "oklch(0.52 0.03 240)" }}>
                  {new Date(m.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm" variant="ghost"
                      className="text-xs h-7 px-2"
                      style={{ color: m.role === "admin" ? "oklch(0.65 0.15 30)" : TEAL }}
                      onClick={() => updateRole.mutate({ userId: m.id, role: m.role === "admin" ? "user" : "admin" })}
                    >
                      {m.role === "admin" ? <><ShieldOff className="w-3.5 h-3.5 mr-1" />Demote</> : <><Shield className="w-3.5 h-3.5 mr-1" />Promote</>}
                    </Button>
                    {m.id !== currentUser?.id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2">
                              <AlertTriangle className="w-5 h-5 text-red-500" />
                              Remove Member
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove <strong>{getDisplayName(m, m.email ?? "this member")}</strong> and all their attendance records, passes, and messages. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => deleteUser.mutate({ userId: m.id })}
                            >
                              Remove Member
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Financial Members Tab ────────────────────────────────────────────────────────
function FinancialMembersTab() {
  const { data: members } = trpc.members.financialMembers.useQuery();
  const passTypeLabel: Record<string, string> = {
    "10-pass": "10-Pass",
    "5-pass": "5-Pass",
    single: "Single Session",
    "10-pass-comp": "10-Pass (Comp)",
    "5-pass-comp": "5-Pass (Comp)",
    "single-comp": "Single Session (Comp)",
    test: "Test",
  };
  const isComplimentary = (type: string) => type.endsWith("-comp");
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: NAVY }}>Financial Members ({members?.length ?? 0})</p>
        <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.03 240)" }}>Everyone who has ever made a payment, sorted by most recent purchase.</p>
      </div>
      {!members || members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <DollarSign className="w-8 h-8" style={{ color: "oklch(0.78 0.17 75)" }} />
          <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>No payments recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "oklch(0.97 0.005 240)" }}>
              <tr>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Member</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Last Purchase</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Date</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Total Paid</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Purchase History</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t" style={{ borderColor: "oklch(0.95 0.005 240)" }}>
                  <td className="py-2.5 px-4">
                    <p className="font-medium" style={{ color: NAVY }}>{m.userName ?? "—"}</p>
                    <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{m.userEmail ?? ""}</p>
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge className={`text-xs border-0 ${isComplimentary(m.lastPurchaseType) ? 'bg-purple-50 text-purple-700' : 'bg-teal-50 text-teal-700'}`}>
                      {passTypeLabel[m.lastPurchaseType] ?? m.lastPurchaseType}
                    </Badge>
                  </td>
                  <td className="py-2.5 px-4" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {new Date(m.lastPurchaseDate).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 px-4 font-medium" style={{ color: NAVY }}>
                    ${(m.totalSpentCents / 100).toFixed(2)}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex flex-col gap-0.5">
                      {m.orders.map((o) => (
                        <span key={o.orderId} className="text-xs flex items-center gap-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                          {passTypeLabel[o.passType] ?? o.passType}
                          {isComplimentary(o.passType) ? (
                            <span className="inline-block text-[10px] font-semibold px-1 rounded bg-purple-100 text-purple-700">Comp</span>
                          ) : (
                            <> — ${(o.amountCents / 100).toFixed(2)}</>
                          )}
                          {' '}on {new Date(o.createdAt).toLocaleDateString()}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Announcements Tab ────────────────────────────────────────────────────────
function AnnouncementsTab() {
  const { data: announcements, refetch } = trpc.announcements.list.useQuery();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ title: "", body: "", category: "general" as any, pinned: false });

  const create = trpc.announcements.create.useMutation({ onSuccess: () => { toast.success("Announcement posted"); refetch(); setOpen(false); setForm({ title: "", body: "", category: "general", pinned: false }); }, onError: (e) => toast.error(e.message) });
  const update = trpc.announcements.update.useMutation({ onSuccess: () => { toast.success("Updated"); refetch(); setEditItem(null); }, onError: (e) => toast.error(e.message) });
  const del = trpc.announcements.delete.useMutation({ onSuccess: () => { toast.success("Deleted"); refetch(); }, onError: (e) => toast.error(e.message) });

  const catColor: Record<string, string> = { event: "bg-purple-100 text-purple-800", rehearsal: "bg-blue-100 text-blue-800", general: "bg-gray-100 text-gray-700" };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>Announcements ({announcements?.length ?? 0})</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" style={{ background: TEAL, color: "white" }} className="text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> New Announcement
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Announcement</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <Input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              <Textarea placeholder="Message body…" rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="rehearsal">Rehearsal</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} />
                Pin to top
              </label>
              <Button className="w-full" style={{ background: TEAL, color: "white" }} onClick={() => create.mutate(form)} disabled={!form.title || !form.body}>
                Post Announcement
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(announcements ?? []).map((a: any) => (
          <div key={a.id} className="flex items-start justify-between p-3 rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)", background: a.pinned ? "oklch(0.98 0.01 75)" : "white" }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: NAVY }}>{a.title}</span>
                <Badge className={`text-xs border-0 ${catColor[a.category] ?? ""}`}>{a.category}</Badge>
                {a.pinned && <Badge className="text-xs bg-amber-100 text-amber-800 border-0">Pinned</Badge>}
              </div>
              <p className="text-xs mt-1 line-clamp-2" style={{ color: "oklch(0.52 0.03 240)" }}>{a.body}</p>
            </div>
            <div className="flex gap-1 ml-2 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditItem(a); }}>
                <Edit2 className="w-3.5 h-3.5" style={{ color: TEAL }} />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => del.mutate({ id: a.id })}>
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={v => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Announcement</DialogTitle></DialogHeader>
          {editItem && (
            <div className="space-y-3 mt-2">
              <Input value={editItem.title} onChange={e => setEditItem((p: any) => ({ ...p, title: e.target.value }))} />
              <Textarea rows={4} value={editItem.body} onChange={e => setEditItem((p: any) => ({ ...p, body: e.target.value }))} />
              <Select value={editItem.category} onValueChange={v => setEditItem((p: any) => ({ ...p, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="general">General</SelectItem><SelectItem value="rehearsal">Rehearsal</SelectItem><SelectItem value="event">Event</SelectItem></SelectContent></Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={editItem.pinned} onChange={e => setEditItem((p: any) => ({ ...p, pinned: e.target.checked }))} />Pin to top</label>
              <Button className="w-full" style={{ background: TEAL, color: "white" }} onClick={() => update.mutate({ id: editItem.id, title: editItem.title, body: editItem.body, category: editItem.category, pinned: editItem.pinned })}>Save Changes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Events Tab ───────────────────────────────────────────────────────────────
function EventsTab() {
  const { data: evts, refetch } = trpc.events.list.useQuery();
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ title: "", description: "", location: "", eventDate: "", endDate: "", category: "other" as any });

  const create = trpc.events.create.useMutation({ onSuccess: () => { toast.success("Event created"); refetch(); setOpen(false); setForm({ title: "", description: "", location: "", eventDate: "", endDate: "", category: "other" }); }, onError: (e) => toast.error(e.message) });
  const update = trpc.events.update.useMutation({ onSuccess: () => { toast.success("Updated"); refetch(); setEditItem(null); }, onError: (e) => toast.error(e.message) });
  const del = trpc.events.delete.useMutation({ onSuccess: () => { toast.success("Deleted"); refetch(); }, onError: (e) => toast.error(e.message) });

  const catColors: Record<string, string> = { concert: "bg-purple-100 text-purple-800", rehearsal: "bg-blue-100 text-blue-800", social: "bg-green-100 text-green-800", workshop: "bg-orange-100 text-orange-800", other: "bg-gray-100 text-gray-700" };

  const EventForm = ({ data, setData, onSubmit, label }: any) => (
    <div className="space-y-3">
      <Input placeholder="Title" value={data.title} onChange={e => setData((p: any) => ({ ...p, title: e.target.value }))} />
      <Textarea placeholder="Description" rows={3} value={data.description} onChange={e => setData((p: any) => ({ ...p, description: e.target.value }))} />
      <Input placeholder="Location" value={data.location} onChange={e => setData((p: any) => ({ ...p, location: e.target.value }))} />
      <div className="grid grid-cols-2 gap-2">
        <div><label className="text-xs font-medium" style={{ color: NAVY }}>Start Date & Time</label><Input type="datetime-local" value={data.eventDate} onChange={e => setData((p: any) => ({ ...p, eventDate: e.target.value }))} /></div>
        <div><label className="text-xs font-medium" style={{ color: NAVY }}>End Date & Time (optional)</label><Input type="datetime-local" value={data.endDate} onChange={e => setData((p: any) => ({ ...p, endDate: e.target.value }))} /></div>
      </div>
      <Select value={data.category} onValueChange={v => setData((p: any) => ({ ...p, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="concert">Concert</SelectItem><SelectItem value="rehearsal">Rehearsal</SelectItem><SelectItem value="social">Social</SelectItem><SelectItem value="workshop">Workshop</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select>
      <Button className="w-full" style={{ background: TEAL, color: "white" }} onClick={onSubmit} disabled={!data.title || !data.eventDate}>{label}</Button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>Events ({evts?.length ?? 0})</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" style={{ background: TEAL, color: "white" }} className="text-xs"><Plus className="w-3.5 h-3.5 mr-1" /> New Event</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Event</DialogTitle></DialogHeader>
            <div className="mt-2">
              <EventForm data={form} setData={setForm} label="Create Event" onSubmit={() => create.mutate({ ...form, eventDate: new Date(form.eventDate), endDate: form.endDate ? new Date(form.endDate) : undefined })} />
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(evts ?? []).map((e: any) => (
          <div key={e.id} className="flex items-start justify-between p-3 rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: NAVY }}>{e.title}</span>
                <Badge className={`text-xs border-0 ${catColors[e.category] ?? ""}`}>{e.category}</Badge>
              </div>
              {e.location && <p className="text-xs mt-0.5" style={{ color: TEAL }}>📍 {e.location}</p>}
              <p className="text-xs mt-0.5" style={{ color: "oklch(0.52 0.03 240)" }}>{new Date(e.eventDate).toLocaleString()}{e.endDate ? ` → ${new Date(e.endDate).toLocaleString()}` : ""}</p>
            </div>
            <div className="flex gap-1 ml-2 shrink-0">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditItem({ ...e, eventDate: new Date(e.eventDate).toISOString().slice(0, 16), endDate: e.endDate ? new Date(e.endDate).toISOString().slice(0, 16) : "" })}><Edit2 className="w-3.5 h-3.5" style={{ color: TEAL }} /></Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => del.mutate({ id: e.id })}><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={!!editItem} onOpenChange={v => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Event</DialogTitle></DialogHeader>
          {editItem && <div className="mt-2"><EventForm data={editItem} setData={setEditItem} label="Save Changes" onSubmit={() => update.mutate({ id: editItem.id, ...editItem, eventDate: new Date(editItem.eventDate), endDate: editItem.endDate ? new Date(editItem.endDate) : undefined })} /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Passes Tab ───────────────────────────────────────────────────────────────
function PassesTab() {
  const { data: members } = trpc.members.list.useQuery();
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const { data: userPasses, refetch: refetchPasses } = trpc.passes.forUser.useQuery({ userId: selectedUser! }, { enabled: !!selectedUser });
  const { data: activePass } = trpc.passes.activeForUser.useQuery({ userId: selectedUser! }, { enabled: !!selectedUser });
  const [sessions, setSessions] = useState(10);
  const [topUpAmt, setTopUpAmt] = useState(5);

  const assign = trpc.passes.assign.useMutation({ onSuccess: () => { toast.success("Pass assigned"); refetchPasses(); }, onError: (e) => toast.error(e.message) });
  const topUp = trpc.passes.topUp.useMutation({ onSuccess: () => { toast.success("Pass topped up"); refetchPasses(); }, onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: NAVY }}>Select Member</label>
          <Select value={selectedUser?.toString() ?? ""} onValueChange={v => setSelectedUser(Number(v))}>
            <SelectTrigger><SelectValue placeholder="Choose a member…" /></SelectTrigger>
            <SelectContent>{(members ?? []).map(m => <SelectItem key={m.id} value={m.id.toString()}>{getDisplayName(m, m.email ?? "Member")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selectedUser && (
          <div className="p-3 rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
            <p className="text-xs font-semibold mb-1" style={{ color: NAVY }}>Active Pass</p>
            {activePass ? (
              <div>
                <p className="text-lg font-bold" style={{ color: TEAL }}>{activePass.remainingSessions} <span className="text-sm font-normal" style={{ color: "oklch(0.52 0.03 240)" }}>/ {activePass.totalSessions} sessions remaining</span></p>
              </div>
            ) : <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>No active pass</p>}
          </div>
        )}
      </div>
      {selectedUser && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Assign New Pass</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input type="number" min={1} max={50} value={sessions} onChange={e => setSessions(Number(e.target.value))} placeholder="Sessions" />
              <Button className="w-full text-sm" style={{ background: TEAL, color: "white" }} onClick={() => assign.mutate({ userId: selectedUser, totalSessions: sessions })}>Assign {sessions}-Pass</Button>
            </CardContent>
          </Card>
          {activePass && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Top Up Active Pass</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <Input type="number" min={1} max={50} value={topUpAmt} onChange={e => setTopUpAmt(Number(e.target.value))} placeholder="Sessions to add" />
                <Button className="w-full text-sm" style={{ background: GOLD, color: "#0a0a0a" }} onClick={() => topUp.mutate({ passId: activePass.id, userId: selectedUser, addSessions: topUpAmt })}>Add {topUpAmt} Sessions</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {selectedUser && userPasses && userPasses.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: NAVY }}>Pass History</p>
          <div className="space-y-1">
            {userPasses.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border text-sm" style={{ borderColor: "oklch(0.92 0.01 240)", background: p.active ? "oklch(0.97 0.01 185)" : "white" }}>
                <span style={{ color: NAVY }}>{p.remainingSessions}/{p.totalSessions} sessions</span>
                <Badge className={p.active ? "bg-green-100 text-green-800 border-0" : "bg-gray-100 text-gray-600 border-0"}>{p.active ? "Active" : "Expired"}</Badge>
                <span className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{new Date(p.assignedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Library Tab ──────────────────────────────────────────────────────────────
function LibraryTab() {
  const { data: items, refetch } = trpc.library.list.useQuery();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", artist: "", type: "sheet_music" as any });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = trpc.library.upload.useMutation({ onSuccess: () => { toast.success("File uploaded"); refetch(); setOpen(false); setForm({ title: "", artist: "", type: "sheet_music" }); setFile(null); setUploading(false); }, onError: (e) => { toast.error(e.message); setUploading(false); } });
  const del = trpc.library.delete.useMutation({ onSuccess: () => { toast.success("Deleted"); refetch(); }, onError: (e) => toast.error(e.message) });

  const handleUpload = async () => {
    if (!file || !form.title) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      upload.mutate({ ...form, fileName: file.name, mimeType: file.type, fileBase64: base64 });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold" style={{ color: NAVY }}>Music Library ({items?.length ?? 0} files)</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" style={{ background: TEAL, color: "white" }} className="text-xs"><Upload className="w-3.5 h-3.5 mr-1" /> Upload File</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Upload to Library</DialogTitle></DialogHeader>
            <div className="space-y-3 mt-2">
              <Input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              <Input placeholder="Artist / Composer (optional)" value={form.artist} onChange={e => setForm(f => ({ ...f, artist: e.target.value }))} />
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as any }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sheet_music">Sheet Music (PDF)</SelectItem><SelectItem value="backing_track">Backing Track (Audio)</SelectItem></SelectContent></Select>
              <div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-teal-400 transition-colors" style={{ borderColor: "oklch(0.85 0.03 185)" }} onClick={() => document.getElementById("lib-file-input")?.click()}>
                <input id="lib-file-input" type="file" className="hidden" accept=".pdf,audio/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                {file ? <p className="text-sm font-medium" style={{ color: TEAL }}>{file.name}</p> : <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>Click to select a file</p>}
              </div>
              <Button className="w-full" style={{ background: TEAL, color: "white" }} onClick={handleUpload} disabled={!file || !form.title || uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(items ?? []).map((item: any) => (
          <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm" style={{ color: NAVY }}>{item.title}</p>
              {item.artist && <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{item.artist}</p>}
              <Badge className={`text-xs border-0 mt-1 ${item.type === "sheet_music" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`}>{item.type === "sheet_music" ? "Sheet Music" : "Backing Track"}</Badge>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-2" onClick={() => del.mutate({ id: item.id })}><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Groups Tab ───────────────────────────────────────────────────────────────
function GroupsTab() {
  const { data: groups } = trpc.groups.adminList.useQuery();
  const del = trpc.groups.delete.useMutation({ onSuccess: () => toast.success("Group deleted") });

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold" style={{ color: NAVY }}>All Groups ({groups?.length ?? 0})</p>
      {(groups ?? []).map((g: any) => (
        <div key={g.id} className="p-3 rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="font-semibold text-sm" style={{ color: NAVY }}>{g.name}</p>
              {g.description && <p className="text-xs mt-0.5" style={{ color: "oklch(0.55 0.03 240)" }}>{g.description}</p>}
              <p className="text-xs mt-1" style={{ color: TEAL }}>{g.memberCount} approved members</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => del.mutate({ groupId: g.id })}><Trash2 className="w-3.5 h-3.5 text-red-400" /></Button>
          </div>
          {g.members && g.members.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {g.members.filter((m: any) => m.status === "approved").map((m: any) => (
                <Badge key={m.userId} className="text-xs border-0 bg-gray-100 text-gray-700">{m.userName ?? m.userId}</Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab() {
  const { data: orders } = trpc.payments.allOrders.useQuery();
  const statusColor: Record<string, string> = { paid: "bg-green-100 text-green-800", pending: "bg-yellow-100 text-yellow-800", failed: "bg-red-100 text-red-800", cancelled: "bg-gray-100 text-gray-700" };
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold" style={{ color: NAVY }}>All Pass Orders ({orders?.length ?? 0})</p>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
        <table className="w-full text-sm">
          <thead style={{ background: "oklch(0.97 0.005 240)" }}>
            <tr>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Member</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Pass</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Amount</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Status</th>
              <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((o: any) => (
              <tr key={o.id} className="border-t" style={{ borderColor: "oklch(0.95 0.005 240)" }}>
                <td className="py-2.5 px-4"><p className="font-medium" style={{ color: NAVY }}>{o.userName ?? "—"}</p><p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{o.userEmail}</p></td>
                <td className="py-2.5 px-4 capitalize" style={{ color: NAVY }}>{o.passType} ({o.sessionCount})</td>
                <td className="py-2.5 px-4" style={{ color: NAVY }}>${(o.amountCents / 100).toFixed(2)}</td>
                <td className="py-2.5 px-4"><Badge className={`text-xs border-0 ${statusColor[o.status] ?? ""}`}>{o.status}</Badge></td>
                <td className="py-2.5 px-4" style={{ color: "oklch(0.52 0.03 240)" }}>{new Date(o.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Activity Log Tab ────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  attendance_marked:    { label: "Attended",          color: "bg-teal-100 text-teal-800" },
  attendance_unmarked:  { label: "Un-marked",          color: "bg-gray-100 text-gray-700" },
  pass_purchased:       { label: "Pass Purchased",     color: "bg-blue-100 text-blue-800" },
  pass_online_purchase: { label: "Online Purchase",    color: "bg-blue-100 text-blue-800" },
  pass_credited:        { label: "Pass Credited",      color: "bg-green-100 text-green-800" },
  pass_deducted:        { label: "Session Used",       color: "bg-orange-100 text-orange-800" },
  pass_adjusted:        { label: "Balance Adjusted",   color: "bg-purple-100 text-purple-800" },
  comp_granted:         { label: "Comp Granted",       color: "bg-pink-100 text-pink-800" },
  cash_payment:         { label: "Cash Payment",       color: "bg-yellow-100 text-yellow-800" },
  pass_restored:        { label: "Session Restored",   color: "bg-teal-100 text-teal-700" },
  pass_expired:         { label: "Pass Expired",       color: "bg-red-100 text-red-800" },
  pass_manual_activated:{ label: "Manual Activation", color: "bg-indigo-100 text-indigo-800" },
  role_changed:         { label: "Role Changed",       color: "bg-violet-100 text-violet-800" },
  member_deleted:       { label: "Member Deleted",     color: "bg-red-100 text-red-800" },
  member_created:       { label: "Member Created",     color: "bg-green-100 text-green-800" },
};

function ActivityLogTab() {
  const { data: log, isLoading } = trpc.members.globalActivityLog.useQuery({ limit: 500 });
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [, navigate] = useLocation();

  // activeActions: null = all, array = multi-action quick filter, string = single action dropdown
  const [quickFilterActions, setQuickFilterActions] = useState<string[] | null>(null);

  const filtered = (log ?? []).filter((entry: any) => {
    const subjectName = [
      entry.subjectFirstName, entry.subjectLastName, entry.subjectName
    ].filter(Boolean).join(" ").toLowerCase();
    const detail = (entry.detail ?? "").toLowerCase();
    const matchesSearch = !search || subjectName.includes(search.toLowerCase()) || detail.includes(search.toLowerCase());
    const matchesAction = quickFilterActions
      ? quickFilterActions.includes(entry.action)
      : actionFilter === "all" || entry.action === actionFilter;
    const entryDate = new Date(entry.createdAt);
    const matchesFrom = !dateFrom || entryDate >= new Date(dateFrom + "T00:00:00");
    const matchesTo = !dateTo || entryDate <= new Date(dateTo + "T23:59:59");
    return matchesSearch && matchesAction && matchesFrom && matchesTo;
  });

  const getSubjectName = (entry: any) => {
    if (entry.subjectFirstName || entry.subjectLastName) {
      return [entry.subjectFirstName, entry.subjectLastName].filter(Boolean).join(" ");
    }
    return entry.subjectName ?? `User #${entry.userId}`;
  };

  const clearFilters = () => {
    setSearch("");
    setActionFilter("all");
    setDateFrom("");
    setDateTo("");
    setQuickFilterActions(null);
  };
  const hasActiveFilters = !!(search || actionFilter !== "all" || dateFrom || dateTo || quickFilterActions);

  // Quick-filter presets
  const QUICK_FILTERS: { label: string; actions: string[] }[] = [
    { label: "Pass Changes", actions: ["pass_credited", "pass_adjusted", "pass_online_purchase", "pass_manual_activated", "cash_payment", "comp_granted", "pass_deducted", "pass_restored", "pass_purchased"] },
    { label: "Attendance", actions: ["attendance_marked", "attendance_unmarked"] },
    { label: "Admin Actions", actions: ["pass_adjusted", "role_changed", "member_deleted", "comp_granted", "cash_payment", "pass_manual_activated"] },
  ];

  function exportCSV() {
    const headers = ["Date", "Time", "Member", "Action", "Detail", "Balance Before", "Balance After", "Performed By"];
    const rows = filtered.map((entry: any) => {
      const d = new Date(entry.createdAt);
      const subjectName = getSubjectName(entry);
      const actorName = entry.actorId
        ? ([entry.actorFirstName, entry.actorLastName].filter(Boolean).join(" ") || entry.actorName || `Admin #${entry.actorId}`)
        : "System / Member";
      const actionLabel = ACTION_LABELS[entry.action]?.label ?? entry.action;
      return [
        d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }),
        d.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }),
        subjectName,
        actionLabel,
        (entry.detail ?? "").replace(/,/g, ";"),
        entry.balanceBefore ?? "",
        entry.balanceAfter ?? "",
        actorName,
      ];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bvc-activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Quick-filter presets */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs font-medium mr-1" style={{ color: "oklch(0.55 0.03 240)" }}>Quick:</span>
        {QUICK_FILTERS.map((qf) => {
          const isActive = quickFilterActions !== null &&
            qf.actions.length === quickFilterActions.length &&
            qf.actions.every(a => quickFilterActions.includes(a));
          return (
            <button
              key={qf.label}
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setActionFilter("all");
                // Toggle off if already active
                setQuickFilterActions(isActive ? null : qf.actions);
              }}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={{
                borderColor: isActive ? TEAL : "oklch(0.88 0.01 240)",
                background: isActive ? `${TEAL}18` : "white",
                color: isActive ? TEAL : "oklch(0.5 0.03 240)",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {qf.label}
            </button>
          );
        })}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs px-2.5 py-1 rounded-full border transition-colors ml-1"
            style={{ borderColor: "oklch(0.88 0.01 240)", color: "oklch(0.55 0.03 240)" }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: "oklch(0.92 0.01 240)", background: "oklch(0.98 0.003 240)" }}>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1" style={{ minWidth: 180 }}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "oklch(0.6 0.03 240)" }} />
            <input
              type="text"
              placeholder="Search member or detail…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-white outline-none focus:ring-1 focus:ring-teal-400"
              style={{ borderColor: "oklch(0.88 0.01 240)", color: NAVY }}
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="text-xs rounded-md border bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-400"
            style={{ borderColor: "oklch(0.88 0.01 240)", color: NAVY }}
          >
            <option value="all">All actions</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium whitespace-nowrap" style={{ color: "oklch(0.5 0.03 240)" }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs rounded-md border bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-400"
              style={{ borderColor: "oklch(0.88 0.01 240)", color: NAVY }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium whitespace-nowrap" style={{ color: "oklch(0.5 0.03 240)" }}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-xs rounded-md border bg-white px-2 py-1.5 outline-none focus:ring-1 focus:ring-teal-400"
              style={{ borderColor: "oklch(0.88 0.01 240)", color: NAVY }}
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs px-2.5 py-1.5 rounded-md border hover:bg-gray-100 transition-colors"
              style={{ borderColor: "oklch(0.88 0.01 240)", color: "oklch(0.5 0.03 240)" }}
            >
              Clear filters
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <p className="text-xs" style={{ color: "oklch(0.6 0.03 240)" }}>
              <span className="font-semibold" style={{ color: NAVY }}>{filtered.length}</span>{" "}
              {filtered.length === 1 ? "entry" : "entries"}{hasActiveFilters ? " (filtered)" : ""}
            </p>
            {filtered.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border hover:bg-gray-100 transition-colors"
                style={{ borderColor: "oklch(0.88 0.01 240)", color: NAVY }}
                title="Download filtered results as CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-center py-8" style={{ color: "oklch(0.6 0.03 240)" }}>Loading activity log…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-center py-8" style={{ color: "oklch(0.6 0.03 240)" }}>
          No activity found{hasActiveFilters ? " matching the current filters" : ""}.
          {hasActiveFilters && (
            <button onClick={clearFilters} className="ml-2 underline hover:no-underline" style={{ color: TEAL }}>Clear filters</button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "oklch(0.97 0.005 240)" }}>
              <tr>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Date & Time</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Member</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Action</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Detail</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>Balance</th>
                <th className="text-left py-2.5 px-4 font-semibold" style={{ color: NAVY }}>By</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry: any) => {
                const meta = ACTION_LABELS[entry.action] ?? { label: entry.action, color: "bg-gray-100 text-gray-700" };
                return (
                  <tr key={entry.id} className="border-t hover:bg-gray-50/50" style={{ borderColor: "oklch(0.95 0.005 240)" }}>
                    <td className="py-2 px-4 whitespace-nowrap" style={{ color: "oklch(0.52 0.03 240)", fontSize: 12 }}>
                      {new Date(entry.createdAt).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}
                      <br />
                      <span style={{ color: "oklch(0.65 0.02 240)" }}>
                        {new Date(entry.createdAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <button
                        onClick={() => navigate("/members?highlight=" + entry.userId)}
                        className="font-medium text-left hover:underline transition-colors"
                        style={{ color: TEAL, background: "none", border: "none", padding: 0, cursor: "pointer" }}
                        title="Jump to member profile"
                      >
                        {getSubjectName(entry)}
                      </button>
                    </td>
                    <td className="py-2 px-4">
                      <Badge className={`text-xs border-0 ${meta.color}`}>{meta.label}</Badge>
                    </td>
                    <td className="py-2 px-4 max-w-xs" style={{ color: "oklch(0.4 0.03 240)", fontSize: 12 }}>
                      {entry.detail ?? "—"}
                    </td>
                    <td className="py-2 px-4 whitespace-nowrap" style={{ color: NAVY, fontSize: 12 }}>
                      {entry.balanceBefore !== null && entry.balanceAfter !== null
                        ? <span>{entry.balanceBefore} → {entry.balanceAfter}</span>
                        : <span style={{ color: "oklch(0.7 0.02 240)" }}>—</span>}
                    </td>
                    <td className="py-2 px-4" style={{ color: "oklch(0.55 0.03 240)", fontSize: 12 }}>
                      {entry.actorId
                        ? (() => {
                            const n = [entry.actorFirstName, entry.actorLastName].filter(Boolean).join(" ");
                            return n || entry.actorName || `Admin #${entry.actorId}`;
                          })()
                        : <span className="italic">System / Member</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data: stats } = trpc.dashboard.adminStats.useQuery(undefined, { enabled: user?.role === "admin" });

  if (!user) return null;
  if (user.role !== "admin") {
    navigate("/dashboard");
    return null;
  }

  return (
    <BVCLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${GOLD}33` }}>
            <Settings className="w-5 h-5" style={{ color: GOLD }} />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold" style={{ color: NAVY }}>Admin Panel</h1>
            <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>Full control over all aspects of Bundaberg Voice Collective</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard icon={Users} label="Members" value={stats?.totalMembers ?? "—"} color={TEAL} />
          <StatCard icon={CalendarDays} label="Sessions" value={stats?.totalSessions ?? "—"} color={NAVY} />
          <StatCard icon={Music} label="Library Files" value={stats?.totalLibraryItems ?? "—"} color={GOLD} />
          <StatCard icon={Megaphone} label="Announcements" value={stats?.totalAnnouncements ?? "—"} color="oklch(0.55 0.15 300)" />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="announcements">
          <TabsList className="flex-wrap h-auto gap-1 bg-gray-100 p-1">
            <TabsTrigger value="announcements" className="text-xs"><Megaphone className="w-3.5 h-3.5 mr-1" />Announcements</TabsTrigger>
            <TabsTrigger value="events" className="text-xs"><CalendarDays className="w-3.5 h-3.5 mr-1" />Events</TabsTrigger>
            <TabsTrigger value="members" className="text-xs"><Users className="w-3.5 h-3.5 mr-1" />Members</TabsTrigger>
            <TabsTrigger value="passes" className="text-xs"><CreditCard className="w-3.5 h-3.5 mr-1" />Passes</TabsTrigger>
            <TabsTrigger value="library" className="text-xs"><Music className="w-3.5 h-3.5 mr-1" />Library</TabsTrigger>
            <TabsTrigger value="groups" className="text-xs"><MessageSquare className="w-3.5 h-3.5 mr-1" />Groups</TabsTrigger>
            <TabsTrigger value="orders" className="text-xs"><BarChart3 className="w-3.5 h-3.5 mr-1" />Orders</TabsTrigger>
            <TabsTrigger value="financial" className="text-xs"><DollarSign className="w-3.5 h-3.5 mr-1" />Financial Members</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs"><History className="w-3.5 h-3.5 mr-1" />Activity Log</TabsTrigger>
          </TabsList>
          <div className="mt-4">
            <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
            <TabsContent value="events"><EventsTab /></TabsContent>
            <TabsContent value="members"><MembersTab /></TabsContent>
            <TabsContent value="passes"><PassesTab /></TabsContent>
            <TabsContent value="library"><LibraryTab /></TabsContent>
            <TabsContent value="groups"><GroupsTab /></TabsContent>
            <TabsContent value="orders"><OrdersTab /></TabsContent>
            <TabsContent value="financial"><FinancialMembersTab /></TabsContent>
            <TabsContent value="activity"><ActivityLogTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </BVCLayout>
  );
}
