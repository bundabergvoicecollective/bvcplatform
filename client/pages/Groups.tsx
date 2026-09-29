import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Users, Plus, Send, CheckCircle, XCircle, UserPlus, ArrowLeft,
  MessageCircle, Crown, UserMinus, Globe, Lock, Settings, Pencil, Trash2
} from "lucide-react";
import { useState, useRef, useEffect, useLayoutEffect } from "react";
import BVCLayout from "@/components/BVCLayout";
import { getDisplayName } from "@shared/const";

const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";

// ─── Group Settings Dialog (admin only) ──────────────────────────────────────
function GroupSettingsDialog({
  group,
  open,
  onClose,
  onGroupUpdated,
}: {
  group: any;
  open: boolean;
  onClose: () => void;
  onGroupUpdated: () => void;
}) {
  const { data: members, refetch: refetchMembers } = trpc.groups.members.useQuery(
    { groupId: group.id },
    { enabled: open }
  );
  const { data: allMembers } = trpc.members.list.useQuery();
  const [newName, setNewName] = useState(group.name);
  const [addUserId, setAddUserId] = useState("");

  // Reset name when dialog opens
  useEffect(() => { if (open) setNewName(group.name); }, [open, group.name]);

  const utils = trpc.useUtils();

  const rename = trpc.groups.rename.useMutation({
    onSuccess: () => {
      toast.success("Group renamed");
      onGroupUpdated();
      utils.groups.list.invalidate();
      utils.groups.myGroups.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const addMember = trpc.groups.adminAddMember.useMutation({
    onSuccess: () => {
      toast.success("Member added");
      setAddUserId("");
      refetchMembers();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMember = trpc.groups.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      refetchMembers();
    },
    onError: (e) => toast.error(e.message),
  });

  const approvedMembers = (members ?? []).filter((m: any) => m.status === "approved");
  const currentMemberIds = new Set((members ?? []).map((m: any) => m.userId));
  const availableToAdd = (allMembers ?? []).filter((m) => !currentMemberIds.has(m.id));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4" style={{ color: TEAL }} />
            Group Settings
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-1">
          <div className="space-y-5 py-1">
            {/* Rename */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold" style={{ color: NAVY }}>Group Name</Label>
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                  placeholder="Group name…"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  style={{ background: TEAL, color: "white" }}
                  disabled={!newName.trim() || newName === group.name || rename.isPending}
                  onClick={() => rename.mutate({ groupId: group.id, name: newName.trim() })}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Save
                </Button>
              </div>
            </div>

            <Separator />

            {/* Current members */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold" style={{ color: NAVY }}>
                Current Members ({approvedMembers.length})
              </Label>
              {approvedMembers.length === 0 ? (
                <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>No approved members yet.</p>
              ) : (
                <div className="space-y-1">
                  {approvedMembers.map((m: any) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: "oklch(0.97 0.005 240)" }}
                    >
                      <div className="flex items-center gap-2">
                        {m.role === "owner" && <Crown className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />}
                        <span className="text-sm font-medium" style={{ color: NAVY }}>
                          {m.userName ?? `User ${m.userId}`}
                        </span>
                        {m.role === "owner" && (
                          <Badge className="text-xs border-0 bg-amber-100 text-amber-700 py-0">Owner</Badge>
                        )}
                      </div>
                      {m.role !== "owner" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 hover:bg-red-50"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate({ groupId: group.id, userId: m.userId })}
                          title="Remove member"
                        >
                          <UserMinus className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Add member */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold" style={{ color: NAVY }}>Add Member</Label>
              {availableToAdd.length === 0 ? (
                <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>All members are already in this group.</p>
              ) : (
                <div className="flex gap-2">
                  <Select value={addUserId} onValueChange={setAddUserId}>
                    <SelectTrigger className="flex-1 text-sm">
                      <SelectValue placeholder="Select a member to add…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()} className="text-sm">
                          {getDisplayName(m, m.email ?? "Member")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    style={{ background: TEAL, color: "white" }}
                    disabled={!addUserId || addMember.isPending}
                    onClick={() => addMember.mutate({ groupId: group.id, userId: Number(addUserId) })}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" /> Add
                  </Button>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Group Chat View ──────────────────────────────────────────────────────────
function GroupChat({ group, onBack, onGroupUpdated }: { group: any; onBack: () => void; onGroupUpdated: () => void }) {
  const { user } = useAuth();
  const { data: messages, refetch } = trpc.groups.messages.useQuery({ groupId: group.id }, { refetchInterval: 3000 });
  const { data: members } = trpc.groups.members.useQuery({ groupId: group.id });
  const [body, setBody] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState<string>("");
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Mobile keyboard fix — Android + iOS
  // Android Chrome doesn't scroll inputs into view on keyboard open; we fix with
  // scrollIntoView on focus + visualViewport resize listener.
  const chatInputRef = useRef<HTMLInputElement>(null);

  const scrollChatInputIntoView = () => {
    setTimeout(() => {
      chatInputRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 100);
  };

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const focused = document.activeElement as HTMLElement | null;
      if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")) {
        setTimeout(() => focused.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
      }
      if (chatContainerRef.current) {
        const offset = window.innerHeight - vv.height - vv.offsetTop;
        chatContainerRef.current.style.setProperty("--kb-offset", `${Math.max(0, offset)}px`);
      }
    };
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);
  const { data: allMembers } = trpc.members.list.useQuery();
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMsg = trpc.groups.sendMessage.useMutation({
    onSuccess: () => { setBody(""); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const invite = trpc.groups.invite.useMutation({
    onSuccess: () => { toast.success("Invitation sent"); setInviteUserId(""); },
    onError: (e) => toast.error(e.message),
  });
  const respond = trpc.groups.respondRequest.useMutation({
    onSuccess: () => { toast.success("Request processed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const removeMember = trpc.groups.removeMember.useMutation({
    onSuccess: () => { toast.success("Member removed"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const isOwner = group.createdBy === user?.id || user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const pendingRequests = (members ?? []).filter((m: any) => m.status === "pending");
  const approvedMembers = (members ?? []).filter((m: any) => m.status === "approved");
  const invitedMembers = (members ?? []).filter((m: any) => m.status === "invited");

  const availableToInvite = (allMembers ?? []).filter(
    (m) => !(members ?? []).some((gm: any) => gm.userId === m.id)
  );

  return (
    <div ref={chatContainerRef} className="flex flex-col" style={{ height: "calc(100dvh - 8rem - var(--kb-offset, 0px))" }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" style={{ color: NAVY }} />
          </Button>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${TEAL}22` }}>
            <Users className="w-4 h-4" style={{ color: TEAL }} />
          </div>
          <div>
            <p className="font-semibold text-sm" style={{ color: NAVY }}>{group.name}</p>
            <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{approvedMembers.length} members</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Admin settings gear */}
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Group settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="w-4 h-4" style={{ color: TEAL }} />
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-xs" style={{ color: TEAL }} onClick={() => setShowMembers(!showMembers)}>
            <Users className="w-3.5 h-3.5 mr-1" /> Members
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Chat */}
        <div className="flex flex-col flex-1 min-w-0">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {(messages ?? []).map((msg: any) => {
                const isMe = msg.fromUserId === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                      {!isMe && (
                        <p className="text-xs font-medium mb-1 px-1" style={{ color: TEAL }}>{msg.fromUserName ?? "Member"}</p>
                      )}
                      <div
                        className="px-3.5 py-2 rounded-2xl text-sm"
                        style={{
                          background: isMe ? TEAL : "oklch(0.96 0.005 240)",
                          color: isMe ? "white" : NAVY,
                          borderBottomRightRadius: isMe ? "4px" : undefined,
                          borderBottomLeftRadius: !isMe ? "4px" : undefined,
                        }}
                      >
                        {msg.body}
                      </div>
                      <p className="text-xs mt-0.5 px-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              {(!messages || messages.length === 0) && (
                <div className="text-center py-12">
                  <MessageCircle className="w-10 h-10 mx-auto mb-2" style={{ color: "oklch(0.85 0.02 240)" }} />
                  <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>No messages yet. Start the conversation!</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Message input */}
          <div className="p-3 border-t flex gap-2" style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}>
            <Input
              ref={chatInputRef}
              placeholder="Type a message…"
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && body.trim()) { e.preventDefault(); sendMsg.mutate({ groupId: group.id, body: body.trim() }); } }}
              onFocus={scrollChatInputIntoView}
              className="flex-1"
              enterKeyHint="send"
            />
            <Button
              style={{ background: TEAL, color: "white" }}
              className="shrink-0"
              disabled={!body.trim() || sendMsg.isPending}
              onClick={() => sendMsg.mutate({ groupId: group.id, body: body.trim() })}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Members sidebar */}
        {showMembers && (
          <div className="w-64 border-l flex flex-col" style={{ borderColor: "oklch(0.92 0.01 240)", background: "oklch(0.98 0.005 240)" }}>
            <div className="p-3 border-b" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
              <p className="text-xs font-semibold" style={{ color: NAVY }}>Group Members</p>
            </div>
            <ScrollArea className="flex-1 p-2">
              {/* Pending requests (owner/admin only) */}
              {isOwner && pendingRequests.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold px-1 mb-1" style={{ color: "oklch(0.65 0.12 30)" }}>Pending Requests ({pendingRequests.length})</p>
                  {pendingRequests.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-1.5 rounded-lg mb-1 bg-orange-50">
                      <p className="text-xs font-medium" style={{ color: NAVY }}>{m.userName ?? `User ${m.userId}`}</p>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => respond.mutate({ groupId: group.id, userId: m.userId, approve: true })}><CheckCircle className="w-3.5 h-3.5 text-green-600" /></Button>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => respond.mutate({ groupId: group.id, userId: m.userId, approve: false })}><XCircle className="w-3.5 h-3.5 text-red-500" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Invited (pending acceptance) */}
              {isOwner && invitedMembers.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold px-1 mb-1" style={{ color: "oklch(0.55 0.03 240)" }}>Invited (awaiting)</p>
                  {invitedMembers.map((m: any) => (
                    <div key={m.id} className="flex items-center p-1.5 rounded-lg mb-1 bg-blue-50">
                      <p className="text-xs" style={{ color: NAVY }}>{m.userName ?? `User ${m.userId}`}</p>
                      <Badge className="ml-auto text-xs border-0 bg-blue-100 text-blue-700">Invited</Badge>
                    </div>
                  ))}
                </div>
              )}

              {/* Approved members */}
              <div className="mb-3">
                <p className="text-xs font-semibold px-1 mb-1" style={{ color: "oklch(0.55 0.03 240)" }}>Members</p>
                {approvedMembers.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between p-1.5 rounded-lg mb-1 hover:bg-white transition-colors">
                    <div className="flex items-center gap-1.5">
                      {m.role === "owner" && <Crown className="w-3 h-3" style={{ color: GOLD }} />}
                      <p className="text-xs font-medium" style={{ color: NAVY }}>{m.userName ?? `User ${m.userId}`}</p>
                    </div>
                    {isOwner && m.userId !== user?.id && (
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 opacity-60 hover:opacity-100" onClick={() => removeMember.mutate({ groupId: group.id, userId: m.userId })}>
                        <UserMinus className="w-3 h-3 text-red-400" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {/* Invite member (owner/admin only) — non-admin invite flow */}
              {isOwner && !isAdmin && availableToInvite.length > 0 && (
                <div className="mt-2 p-2 rounded-lg border" style={{ borderColor: "oklch(0.88 0.01 240)", background: "white" }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: NAVY }}>Invite Member</p>
                  <Select value={inviteUserId} onValueChange={setInviteUserId}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select member…" /></SelectTrigger>
                    <SelectContent>{availableToInvite.map(m => <SelectItem key={m.id} value={m.id.toString()} className="text-xs">{getDisplayName(m, m.email ?? "Member")}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" className="w-full mt-2 h-7 text-xs" style={{ background: TEAL, color: "white" }} disabled={!inviteUserId} onClick={() => { invite.mutate({ groupId: group.id, userId: Number(inviteUserId) }); setInviteUserId(""); }}>
                    <UserPlus className="w-3 h-3 mr-1" /> Send Invite
                  </Button>
                </div>
              )}
              {/* Admin: hint to use settings gear */}
              {isAdmin && (
                <div className="mt-2 p-2 rounded-lg border text-center" style={{ borderColor: "oklch(0.88 0.01 240)", background: "white" }}>
                  <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>
                    Use the <Settings className="w-3 h-3 inline" /> settings icon in the header to add or remove members.
                  </p>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Admin group settings dialog */}
      {isAdmin && (
        <GroupSettingsDialog
          group={group}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onGroupUpdated={onGroupUpdated}
        />
      )}
    </div>
  );
}

// ─── Group List ───────────────────────────────────────────────────────────────
export default function Groups() {
  const { user } = useAuth();
  const { data: allGroups, refetch: refetchAll } = trpc.groups.list.useQuery();
  const { data: myGroups, refetch: refetchMine } = trpc.groups.myGroups.useQuery();
  const { data: myInvites, refetch: refetchInvites } = trpc.groups.myInvites.useQuery();
  const [activeGroup, setActiveGroup] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<any>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [tab, setTab] = useState<"my" | "all">("my");

  const createGroup = trpc.groups.create.useMutation({
    onSuccess: () => { toast.success("Group created!"); refetchAll(); refetchMine(); setCreateOpen(false); setForm({ name: "", description: "" }); },
    onError: (e) => toast.error(e.message),
  });
  const requestJoin = trpc.groups.requestJoin.useMutation({
    onSuccess: () => { toast.success("Join request sent"); refetchAll(); },
    onError: (e) => toast.error(e.message),
  });
  const acceptInvite = trpc.groups.acceptInvite.useMutation({
    onSuccess: () => { toast.success("Joined group!"); refetchMine(); refetchInvites(); },
    onError: (e) => toast.error(e.message),
  });

  const handleGroupUpdated = () => {
    refetchAll();
    refetchMine();
    // If the active group was renamed, update the local reference
    if (activeGroup) {
      // The group will be refreshed from the list on next render
    }
  };

  if (activeGroup) {
    return (
      <BVCLayout>
        <GroupChat
          group={activeGroup}
          onBack={() => { setActiveGroup(null); refetchAll(); refetchMine(); }}
          onGroupUpdated={handleGroupUpdated}
        />
      </BVCLayout>
    );
  }

  const myGroupIds = new Set((myGroups ?? []).map((g: any) => g.id));
  const inviteGroupIds = new Set((myInvites ?? []).map((i: any) => i.groupId));

  return (
    <BVCLayout>
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${TEAL}22` }}>
              <Users className="w-5 h-5" style={{ color: TEAL }} />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold" style={{ color: NAVY }}>Groups</h1>
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>Join groups created by your choir director</p>
            </div>
          </div>
          {/* Only admins can create groups */}
          {user?.role === "admin" && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <Button style={{ background: TEAL, color: "white" }} size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Create Group
              </Button>
              <DialogContent>
                <DialogHeader><DialogTitle>Create a New Group</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <Input placeholder="Group name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={100} />
                  <Textarea placeholder="Description (optional)" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} maxLength={500} />
                  <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>You will be the group owner and can invite members and approve join requests.</p>
                  <Button className="w-full" style={{ background: TEAL, color: "white" }} disabled={!form.name.trim() || createGroup.isPending} onClick={() => createGroup.mutate(form)}>
                    Create Group
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Pending invites */}
        {(myInvites ?? []).length > 0 && (
          <div className="p-4 rounded-xl border-2" style={{ borderColor: `${GOLD}66`, background: `${GOLD}11` }}>
            <p className="text-sm font-semibold mb-2" style={{ color: NAVY }}>You have {myInvites!.length} pending group invitation{myInvites!.length > 1 ? "s" : ""}</p>
            <div className="space-y-2">
              {(myInvites ?? []).map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-2.5 rounded-lg bg-white border" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: NAVY }}>{inv.groupName}</p>
                    {inv.groupDescription && <p className="text-xs" style={{ color: "oklch(0.55 0.03 240)" }}>{inv.groupDescription}</p>}
                  </div>
                  <Button size="sm" style={{ background: TEAL, color: "white" }} className="text-xs ml-3" onClick={() => acceptInvite.mutate({ groupId: inv.groupId })}>
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Accept
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs — admin sees both; members see only My Groups */}
        {user?.role === "admin" && (
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: "oklch(0.95 0.005 240)" }}>
            <button
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === "my" ? "bg-white shadow-sm" : ""}`}
              style={{ color: tab === "my" ? NAVY : "oklch(0.55 0.03 240)" }}
              onClick={() => setTab("my")}
            >
              My Groups ({myGroups?.length ?? 0})
            </button>
            <button
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${tab === "all" ? "bg-white shadow-sm" : ""}`}
              style={{ color: tab === "all" ? NAVY : "oklch(0.55 0.03 240)" }}
              onClick={() => setTab("all")}
            >
              All Groups ({allGroups?.length ?? 0})
            </button>
          </div>
        )}

        {/* Group list — members always see My Groups; admin can switch tabs */}
        {(tab === "my" || user?.role !== "admin") && (
          <div className="space-y-2">
            {(myGroups ?? []).length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-10 h-10 mx-auto mb-2" style={{ color: "oklch(0.85 0.02 240)" }} />
                <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>You haven't joined any groups yet.</p>
                {user?.role === "admin" && (
                  <p className="text-xs mt-1" style={{ color: "oklch(0.72 0.02 240)" }}>Switch to All Groups to browse and manage groups.</p>
                )}
              </div>
            ) : (myGroups ?? []).map((g: any) => (
              <div
                key={g.id}
                className="flex items-center justify-between p-4 rounded-xl border cursor-pointer hover:shadow-md transition-all"
                style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}
                onClick={() => setActiveGroup(g)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${TEAL}22` }}>
                    <Users className="w-5 h-5" style={{ color: TEAL }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm" style={{ color: NAVY }}>{g.name}</p>
                      {g.role === "owner" && <Crown className="w-3.5 h-3.5" style={{ color: GOLD }} />}
                    </div>
                    {g.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "oklch(0.55 0.03 240)" }}>{g.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                  {user?.role === "admin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      title="Group settings"
                      onClick={(e) => { e.stopPropagation(); setSettingsGroup(g); }}
                    >
                      <Settings className="w-4 h-4" style={{ color: TEAL }} />
                    </Button>
                  )}
                  <MessageCircle className="w-4 h-4" style={{ color: "oklch(0.75 0.02 240)" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "all" && user?.role === "admin" && (
          <div className="space-y-2">
            {(allGroups ?? []).length === 0 ? (
              <div className="text-center py-12">
                <Globe className="w-10 h-10 mx-auto mb-2" style={{ color: "oklch(0.85 0.02 240)" }} />
                <p className="text-sm" style={{ color: "oklch(0.65 0.02 240)" }}>No groups have been created yet.</p>
              </div>
            ) : (allGroups ?? []).map((g: any) => {
              const isMember = myGroupIds.has(g.id);
              const isInvited = inviteGroupIds.has(g.id);
              return (
                <div
                  key={g.id}
                  className="flex items-center justify-between p-4 rounded-xl border"
                  style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${TEAL}22` }}>
                      <Users className="w-5 h-5" style={{ color: TEAL }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: NAVY }}>{g.name}</p>
                      {g.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "oklch(0.55 0.03 240)" }}>{g.description}</p>}
                    </div>
                  </div>
                  <div className="shrink-0 ml-3 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {/* Settings gear always visible for admin in All Groups */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      title="Group settings"
                      onClick={() => setSettingsGroup(g)}
                    >
                      <Settings className="w-4 h-4" style={{ color: TEAL }} />
                    </Button>
                    {isMember ? (
                      <Button size="sm" style={{ background: TEAL, color: "white" }} className="text-xs" onClick={() => setActiveGroup(g)}>
                        <MessageCircle className="w-3.5 h-3.5 mr-1" /> Open
                      </Button>
                    ) : isInvited ? (
                      <Badge className="bg-amber-100 text-amber-800 border-0 text-xs">Invited</Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="text-xs" style={{ color: TEAL, borderColor: TEAL }} onClick={() => requestJoin.mutate({ groupId: g.id })}>
                        <Lock className="w-3.5 h-3.5 mr-1" /> Request to Join
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Global group settings dialog (from list view) */}
      {settingsGroup && (
        <GroupSettingsDialog
          group={settingsGroup}
          open={!!settingsGroup}
          onClose={() => setSettingsGroup(null)}
          onGroupUpdated={() => { refetchAll(); refetchMine(); setSettingsGroup(null); }}
        />
      )}
    </BVCLayout>
  );
}
