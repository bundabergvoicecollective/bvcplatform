import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, MessageCircle, ArrowLeft, Search, Users, X, Plus, Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import BVCLayout from "@/components/BVCLayout";
import { cn } from "@/lib/utils";
import { getDisplayName } from "@shared/const";

const GOLD = "oklch(0.78 0.17 75)";
const TEAL = "oklch(0.55 0.14 185)";
const NAVY = "oklch(0.22 0.07 240)";

function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function memberDisplayName(m: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!m) return "Member";
  return getDisplayName(m);
}

function timeAgo(date: Date | string) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ChatMode =
  | { type: "none" }
  | { type: "dm"; partnerId: number }
  | { type: "group"; conversationId: number };

export default function Messages() {
  const { user } = useAuth();
  const [chat, setChat] = useState<ChatMode>({ type: "none" });
  const [messageText, setMessageText] = useState("");
  const [search, setSearch] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);

  // Multi-select state for new group chat
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  // ─── Mobile keyboard fix ─────────────────────────────────────────────────────
  // Android Chrome doesn't scroll the focused input into view when the soft
  // keyboard opens (unlike iOS which does this automatically). We fix this by:
  // 1. scrollIntoView on input focus (immediate)
  // 2. visualViewport resize listener → scrollIntoView again after keyboard settles
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollInputIntoView = () => {
    setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 100);
  };

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // After keyboard opens, scroll the focused element into view
      const focused = document.activeElement as HTMLElement | null;
      if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")) {
        setTimeout(() => focused.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
      }
      // Also update the container height offset for older iOS fallback
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

  // ─── Queries ────────────────────────────────────────────────────────────────
  const { data: conversations, refetch: refetchConvos } = trpc.messages.conversations.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: groupConversations, refetch: refetchGroupConvos } = trpc.messages.groupConversations.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: allMembers } = trpc.messages.members.useQuery();

  const { data: dmThread, refetch: refetchDmThread } = trpc.messages.thread.useQuery(
    { partnerId: chat.type === "dm" ? chat.partnerId : 0 },
    { enabled: chat.type === "dm", refetchInterval: 3000 }
  );

  const { data: groupThread, refetch: refetchGroupThread } = trpc.messages.groupThread.useQuery(
    { conversationId: chat.type === "group" ? chat.conversationId : 0 },
    { enabled: chat.type === "group", refetchInterval: 3000 }
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const sendDm = trpc.messages.send.useMutation({
    onSuccess: () => {
      setMessageText("");
      refetchDmThread();
      refetchConvos();
      utils.messages.unreadCount.invalidate();
    },
    onError: (err) => toast.error(err.message ?? "Failed to send message"),
  });

  const sendGroupMsg = trpc.messages.sendGroupMessage.useMutation({
    onSuccess: () => {
      setMessageText("");
      refetchGroupThread();
      refetchGroupConvos();
    },
    onError: (err) => toast.error(err.message ?? "Failed to send message"),
  });

  const createGroup = trpc.messages.createGroupConversation.useMutation({
    onSuccess: (conv) => {
      setShowNewChat(false);
      setSelectedMembers([]);
      setGroupName("");
      setSearch("");
      refetchGroupConvos();
      setChat({ type: "group", conversationId: conv.id });
    },
    onError: (err) => toast.error(err.message ?? "Failed to create group chat"),
  });

  // ─── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dmThread, groupThread]);

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSend = () => {
    if (!messageText.trim()) return;
    if (chat.type === "dm") {
      sendDm.mutate({ toUserId: chat.partnerId, body: messageText.trim() });
    } else if (chat.type === "group") {
      sendGroupMsg.mutate({ conversationId: chat.conversationId, body: messageText.trim() });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleMemberSelect = (id: number) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleStartChat = () => {
    if (selectedMembers.length === 0) return;
    if (selectedMembers.length === 1) {
      // Single person → open as DM (no need for group overhead)
      setChat({ type: "dm", partnerId: selectedMembers[0] });
      setShowNewChat(false);
      setSelectedMembers([]);
      setSearch("");
      return;
    }
    // Multiple people → create group conversation
    createGroup.mutate({ participantIds: selectedMembers, name: groupName.trim() || undefined });
  };

  // ─── Derived state ──────────────────────────────────────────────────────────
  const selectedPartner = chat.type === "dm" ? allMembers?.find((m) => m.id === chat.partnerId) : null;
  const selectedGroupConv = chat.type === "group"
    ? groupConversations?.find((c) => c.id === chat.conversationId)
    : null;

  const availableMembers = (allMembers ?? []).filter(
    (m) => m.id !== user?.id && memberDisplayName(m).toLowerCase().includes(search.toLowerCase())
  );

  const filteredDmConvos = (conversations ?? []).filter((c: any) =>
    (c.partnerName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredGroupConvos = (groupConversations ?? []).filter((c: any) => {
    const names = (c.participants ?? []).map((p: any) => p.name ?? "").join(" ");
    return names.toLowerCase().includes(search.toLowerCase()) ||
      (c.name ?? "").toLowerCase().includes(search.toLowerCase());
  });

  const groupChatName = (conv: any) => {
    if (conv?.name) return conv.name;
    const others = (conv?.participants ?? []).filter((p: any) => p.userId !== user?.id);
    return others.map((p: any) => memberDisplayName(p).split(" ")[0] ?? "Member").join(", ");
  };

  const activeThread = chat.type === "dm" ? dmThread : chat.type === "group" ? groupThread : null;
  const isSending = sendDm.isPending || sendGroupMsg.isPending;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <BVCLayout noPadding>
      <div
        ref={chatContainerRef}
        className="flex flex-col min-h-0"
        style={{ height: "calc(100dvh - var(--kb-offset, 0px))", maxHeight: "calc(100dvh - var(--kb-offset, 0px))" }}
      >
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h1 className="text-2xl font-display font-bold" style={{ color: NAVY }}>
            Chat
          </h1>
          <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
            Private messages between choir members.
          </p>
        </div>

        <div className="flex flex-1 mx-6 mb-6 rounded-xl overflow-hidden shadow-sm border min-h-0" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
          {/* ── Conversation list ─────────────────────────────────────────── */}
          <div
            className={cn(
              "w-full md:w-72 shrink-0 flex flex-col border-r",
              chat.type !== "none" ? "hidden md:flex" : "flex"
            )}
            style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}
          >
            {/* Search + New Chat */}
            <div className="p-3 border-b space-y-2" style={{ borderColor: "oklch(0.92 0.01 240)" }}>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5" style={{ color: "oklch(0.65 0.02 240)" }} />
                <Input
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm border-0 bg-gray-50"
                />
              </div>
              <Button
                size="sm"
                className="w-full text-xs font-semibold"
                style={{ background: TEAL, color: "white" }}
                onClick={() => {
                  setShowNewChat(!showNewChat);
                  setSelectedMembers([]);
                  setGroupName("");
                  setSearch("");
                }}
              >
                {showNewChat ? "← Back to messages" : "+ New Conversation"}
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {showNewChat ? (
                /* ── New chat member picker ─────────────────────────── */
                <div className="p-2 space-y-2">
                  {/* Selected chips */}
                  {selectedMembers.length > 0 && (
                    <div className="px-2 pt-1 flex flex-wrap gap-1">
                      {selectedMembers.map((id) => {
                        const m = allMembers?.find((x) => x.id === id);
                        return (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="flex items-center gap-1 text-xs pr-1"
                            style={{ background: "oklch(0.92 0.05 185)", color: TEAL }}
                          >
                            {memberDisplayName(m).split(" ")[0] ?? "Member"}
                            <button onClick={() => toggleMemberSelect(id)} className="ml-0.5 hover:opacity-70">
                              <X className="w-3 h-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {/* Group name (only when 2+ selected) */}
                  {selectedMembers.length >= 2 && (
                    <div className="px-2">
                      <Input
                        placeholder="Group name (optional)"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="h-7 text-xs border-gray-200"
                      />
                    </div>
                  )}

                  {/* Start chat button */}
                  {selectedMembers.length > 0 && (
                    <div className="px-2">
                      <Button
                        size="sm"
                        className="w-full text-xs font-semibold gap-1"
                        style={{ background: GOLD, color: "#0a0a0a" }}
                        onClick={handleStartChat}
                        disabled={createGroup.isPending}
                      >
                        {selectedMembers.length === 1 ? (
                          <><Send className="w-3 h-3" /> Open Chat</>
                        ) : (
                          <><Users className="w-3 h-3" /> Start Group Chat ({selectedMembers.length + 1})</>
                        )}
                      </Button>
                    </div>
                  )}

                  <p className="text-xs font-semibold px-2 py-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                    {selectedMembers.length === 0
                      ? "Select one or more members"
                      : `${selectedMembers.length} selected — tap more to add`}
                  </p>

                  {availableMembers.length === 0 && (
                    <p className="text-xs px-2 py-4 text-center" style={{ color: "oklch(0.65 0.02 240)" }}>
                      No members found.
                    </p>
                  )}

                  {availableMembers.map((m) => {
                    const isSelected = selectedMembers.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMemberSelect(m.id)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                          isSelected ? "bg-teal-50" : "hover:bg-gray-50"
                        )}
                      >
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarFallback
                            style={{
                              background: isSelected ? TEAL : "oklch(0.92 0.01 240)",
                              color: isSelected ? "white" : NAVY,
                              fontSize: "11px",
                            }}
                          >
                            {isSelected ? <Check className="w-3.5 h-3.5" /> : initials(memberDisplayName(m))}
                          </AvatarFallback>
                        </Avatar>
                        <p className="text-sm font-medium truncate flex-1" style={{ color: NAVY }}>
                          {memberDisplayName(m)}
                        </p>
                        {isSelected && <Plus className="w-3.5 h-3.5 rotate-45 shrink-0" style={{ color: TEAL }} />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* ── Conversation list ──────────────────────────────── */
                <div className="p-2 space-y-1">
                  {/* Group conversations */}
                  {filteredGroupConvos.map((c: any) => {
                    const isSelected = chat.type === "group" && chat.conversationId === c.id;
                    return (
                      <button
                        key={`g-${c.id}`}
                        onClick={() => setChat({ type: "group", conversationId: c.id })}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                          isSelected ? "bg-gray-100" : "hover:bg-gray-50"
                        )}
                      >
                        <div
                          className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: isSelected ? GOLD : "oklch(0.88 0.04 75)", color: isSelected ? "#0a0a0a" : NAVY }}
                        >
                          <Users className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium truncate" style={{ color: NAVY }}>
                              {groupChatName(c)}
                            </p>
                            {c.latestMsg && (
                              <span className="text-xs shrink-0 ml-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                                {timeAgo(c.latestMsg.createdAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
                            {c.latestMsg
                              ? (c.latestMsg.fromUserId === user?.id ? "You: " : "") + c.latestMsg.body
                              : `${(c.participants ?? []).length} members`}
                          </p>
                        </div>
                      </button>
                    );
                  })}

                  {/* 1:1 DMs */}
                  {filteredDmConvos.map((c: any) => {
                    const isSelected = chat.type === "dm" && chat.partnerId === c.partnerId;
                    const isUnread = !c.readAt && c.toUserId === user?.id;
                    return (
                      <button
                        key={`dm-${c.partnerId}`}
                        onClick={() => setChat({ type: "dm", partnerId: c.partnerId })}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                          isSelected ? "bg-gray-100" : "hover:bg-gray-50"
                        )}
                      >
                        <Avatar className="w-9 h-9 shrink-0">
                          <AvatarFallback
                            style={{ background: isSelected ? GOLD : TEAL, color: isSelected ? "#0a0a0a" : "white", fontSize: "12px" }}
                          >
                            {initials(c.partnerName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className={cn("text-sm truncate", isUnread ? "font-bold" : "font-medium")} style={{ color: NAVY }}>
                              {c.partnerName}
                            </p>
                            <span className="text-xs shrink-0 ml-1" style={{ color: "oklch(0.65 0.02 240)" }}>
                              {timeAgo(c.createdAt)}
                            </span>
                          </div>
                          <p className={cn("text-xs truncate", isUnread ? "font-semibold" : "")} style={{ color: "oklch(0.52 0.03 240)" }}>
                            {c.fromUserId === user?.id ? "You: " : ""}{c.body}
                          </p>
                        </div>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TEAL }} />
                        )}
                      </button>
                    );
                  })}

                  {filteredDmConvos.length === 0 && filteredGroupConvos.length === 0 && (
                    <div className="text-center py-10">
                      <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-20" />
                      <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                        No conversations yet. Start one above!
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* ── Right panelad view ───────────────────────────────────────────────── */}
          <div
            className={cn(
              "flex-1 flex flex-col",
              chat.type === "none" ? "hidden md:flex" : "flex"
            )}
            style={{ background: "oklch(0.98 0.005 240)" }}
          >
            {chat.type === "none" ? (
              <div className="flex-1 flex flex-col items-center justify-center" style={{ color: "oklch(0.65 0.02 240)" }}>
                <MessageCircle className="w-14 h-14 mb-4 opacity-20" />
                <p className="text-sm font-medium">Select a conversation to start messaging</p>
              </div>
            ) : (
              <>
                {/* Thread header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 border-b"
                  style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}
                >
                  <button
                    className="md:hidden mr-1"
                    onClick={() => setChat({ type: "none" })}
                    style={{ color: TEAL }}
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  {chat.type === "dm" ? (
                    <>
                      <Avatar className="w-9 h-9">
                        <AvatarFallback style={{ background: TEAL, color: "white", fontSize: "12px" }}>
                          {initials(memberDisplayName(selectedPartner))}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: NAVY }}>
                          {memberDisplayName(selectedPartner)}
                        </p>
                        <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>Choir member</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center"
                        style={{ background: "oklch(0.88 0.04 75)", color: NAVY }}
                      >
                        <Users className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: NAVY }}>
                          {groupChatName(selectedGroupConv)}
                        </p>
                        <p className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                          {(selectedGroupConv?.participants ?? []).length} members
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  {(!activeThread || activeThread.length === 0) && (
                    <div className="text-center py-10" style={{ color: "oklch(0.65 0.02 240)" }}>
                      <p className="text-sm">No messages yet. Say hello!</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    {(activeThread ?? []).map((msg: any) => {
                      const isMine = msg.fromUserId === user?.id;
                      const senderName = chat.type === "group"
                        ? (msg.senderFirstName || msg.senderLastName
                            ? getDisplayName({ firstName: msg.senderFirstName, lastName: msg.senderLastName, name: msg.senderName })
                            : (msg.senderName ?? "Member"))
                        : memberDisplayName(selectedPartner);
                      return (
                        <div
                          key={msg.id}
                          className={cn("flex", isMine ? "justify-end" : "justify-start")}
                        >
                          {!isMine && (
                            <Avatar className="w-7 h-7 mr-2 shrink-0 self-end">
                              <AvatarFallback style={{ background: TEAL, color: "white", fontSize: "10px" }}>
                                {initials(senderName)}
                              </AvatarFallback>
                            </Avatar>
                          )}
                          <div className="flex flex-col max-w-[70%]">
                            {!isMine && chat.type === "group" && (
                              <p className="text-xs mb-0.5 ml-1" style={{ color: "oklch(0.52 0.03 240)" }}>
                                {senderName}
                              </p>
                            )}
                            <div
                              className={cn(
                                "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                                isMine ? "rounded-br-sm" : "rounded-bl-sm"
                              )}
                              style={
                                isMine
                                  ? { background: TEAL, color: "white" }
                                  : { background: "white", color: NAVY, border: "1px solid oklch(0.92 0.01 240)" }
                              }
                            >
                              <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                              <p
                                className={cn("text-xs mt-1", isMine ? "text-right" : "text-left")}
                                style={{ opacity: 0.7 }}
                              >
                                {timeAgo(msg.createdAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                {/* Input */}
                <div
                  className="p-3 border-t flex gap-2"
                  style={{ borderColor: "oklch(0.92 0.01 240)", background: "white" }}
                >
                  <Input
                    ref={inputRef}
                    placeholder="Type a message…"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={scrollInputIntoView}
                    className="flex-1 border-gray-200"
                    maxLength={2000}
                    enterKeyHint="send"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!messageText.trim() || isSending}
                    className="shrink-0 transition-transform active:scale-95"
                    style={{ background: TEAL, color: "white" }}
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </BVCLayout>
  );
}
