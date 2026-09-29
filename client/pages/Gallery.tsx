import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Camera,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  ThumbsUp,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Play,
  Film,
} from "lucide-react";
import BVCLayout from "@/components/BVCLayout";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

const TEAL = "oklch(0.6 0.12 195)";
const GOLD = "oklch(0.78 0.17 75)";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayName(u: { userFirstName?: string | null; userLastName?: string | null; userName?: string | null }) {
  if (u.userFirstName || u.userLastName) {
    return [u.userFirstName, u.userLastName].filter(Boolean).join(" ");
  }
  return u.userName ?? "Member";
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

type MediaItem = { mediaUrl: string; mimeType: string };

function Lightbox({
  items,
  startIndex,
  alt,
  onClose,
}: {
  items: MediaItem[];
  startIndex: number;
  alt: string;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const item = items[idx];
  const isVideo = item?.mimeType.startsWith("video/");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, items.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={onClose}
    >
      {/* Close */}
      <button
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
        onClick={onClose}
        title="Close"
      >
        <X className="w-5 h-5 text-white" />
      </button>

      {/* Prev */}
      {items.length > 1 && idx > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/25 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i - 1); }}
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Next */}
      {items.length > 1 && idx < items.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/10 hover:bg-white/25 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i + 1); }}
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>
      )}

      {/* Media */}
      <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-3">
        {isVideo ? (
          <video
            src={item.mediaUrl}
            controls
            autoPlay
            className="rounded-lg shadow-2xl"
            style={{ maxHeight: "85vh", maxWidth: "90vw" }}
          />
        ) : (
          <img
            src={item.mediaUrl}
            alt={alt}
            className="rounded-lg shadow-2xl object-contain"
            style={{ maxHeight: "85vh", maxWidth: "90vw" }}
          />
        )}
        {items.length > 1 && (
          <p className="text-white/60 text-sm">{idx + 1} / {items.length}</p>
        )}
      </div>
    </div>
  );
}

// ─── Comment Thread ────────────────────────────────────────────────────────────

type CommentRow = {
  id: number;
  postId: number;
  userId: number;
  parentId: number | null;
  body: string;
  createdAt: Date;
  userName: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  userAvatarUrl: string | null;
};

function CommentItem({
  comment,
  replies,
  currentUserId,
  isAdmin,
  postId,
  onReply,
  onDelete,
}: {
  comment: CommentRow;
  replies: CommentRow[];
  currentUserId: number;
  isAdmin: boolean;
  postId: number;
  onReply: (parentId: number, parentName: string) => void;
  onDelete: (commentId: number) => void;
}) {
  const [showReplies, setShowReplies] = useState(true);
  const name = getDisplayName(comment);
  const canDelete = isAdmin || comment.userId === currentUserId;

  return (
    <div className="flex gap-2.5">
      <Avatar className="w-7 h-7 flex-shrink-0 mt-0.5">
        <AvatarImage src={comment.userAvatarUrl ?? undefined} />
        <AvatarFallback className="text-[10px]" style={{ background: TEAL, color: "white" }}>
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl px-3 py-2 inline-block max-w-full" style={{ background: "var(--color-muted)" }}>
          <p className="text-xs font-semibold leading-tight">{name}</p>
          <p className="text-sm mt-0.5 break-words">{comment.body}</p>
        </div>
        <div className="flex items-center gap-3 mt-1 pl-1">
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
            onClick={() => onReply(comment.id, name)}
          >
            Reply
          </button>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </span>
          {canDelete && (
            <button
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
              onClick={() => onDelete(comment.id)}
            >
              Delete
            </button>
          )}
        </div>

        {/* Replies */}
        {replies.length > 0 && (
          <div className="mt-2">
            <button
              className="flex items-center gap-1 text-xs font-medium mb-2"
              style={{ color: TEAL }}
              onClick={() => setShowReplies((v) => !v)}
            >
              {showReplies ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showReplies ? "Hide" : "View"} {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </button>
            {showReplies && (
              <div className="flex flex-col gap-2 pl-2 border-l-2" style={{ borderColor: "var(--color-border)" }}>
                {replies.map((reply) => (
                  <div key={reply.id} className="flex gap-2">
                    <Avatar className="w-6 h-6 flex-shrink-0 mt-0.5">
                      <AvatarImage src={reply.userAvatarUrl ?? undefined} />
                      <AvatarFallback className="text-[9px]" style={{ background: TEAL, color: "white" }}>
                        {getInitials(getDisplayName(reply))}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="rounded-2xl px-3 py-2 inline-block max-w-full" style={{ background: "var(--color-muted)" }}>
                        <p className="text-xs font-semibold leading-tight">{getDisplayName(reply)}</p>
                        <p className="text-sm mt-0.5 break-words">{reply.body}</p>
                      </div>
                      <div className="flex items-center gap-3 mt-1 pl-1">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
                        </span>
                        {(isAdmin || reply.userId === currentUserId) && (
                          <button
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => onDelete(reply.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Media Carousel ─────────────────────────────────────────────────────────────

function MediaCarousel({
  media,
  caption,
  onOpenLightbox,
}: {
  media: MediaItem[];
  caption?: string | null;
  onOpenLightbox: (index: number) => void;
}) {
  const [current, setCurrent] = useState(0);
  const item = media[current];
  const isVideo = item?.mimeType.startsWith("video/");

  return (
    <div className="relative w-full" style={{ background: "#000" }}>
      {/* Main media */}
      <div
        className="relative group cursor-zoom-in w-full overflow-hidden"
        style={{ maxHeight: 480 }}
        onClick={() => onOpenLightbox(current)}
      >
        {isVideo ? (
          <video
            src={item.mediaUrl}
            className="w-full object-contain"
            style={{ maxHeight: 480 }}
            onClick={(e) => { e.stopPropagation(); onOpenLightbox(current); }}
          />
        ) : (
          <img
            src={item.mediaUrl}
            alt={caption ?? "Gallery photo"}
            className="w-full object-contain"
            style={{ maxHeight: 480 }}
          />
        )}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(0,0,0,0.15)" }}
        >
          {isVideo ? (
            <Play className="w-10 h-10 text-white drop-shadow" />
          ) : (
            <ZoomIn className="w-8 h-8 text-white drop-shadow" />
          )}
        </div>
      </div>

      {/* Prev/Next arrows for multi-media */}
      {media.length > 1 && current > 0 && (
        <button
          className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); setCurrent((c) => c - 1); }}
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
      )}
      {media.length > 1 && current < media.length - 1 && (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/40 hover:bg-black/60 transition-colors z-10"
          onClick={(e) => { e.stopPropagation(); setCurrent((c) => c + 1); }}
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Dot indicators */}
      {media.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {media.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
              className="rounded-full transition-all"
              style={{
                width: i === current ? 16 : 6,
                height: 6,
                background: i === current ? "white" : "rgba(255,255,255,0.5)",
              }}
            />
          ))}
        </div>
      )}

      {/* Media count badge */}
      {media.length > 1 && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white font-medium"
          style={{ background: "rgba(0,0,0,0.55)" }}
        >
          <Film className="w-3 h-3" />
          {current + 1}/{media.length}
        </div>
      )}
    </div>
  );
}

// ─── Post Card ─────────────────────────────────────────────────────────────────

function PostCard({
  post,
  currentUserId,
  isAdmin,
}: {
  post: any;
  currentUserId: number;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: number; name: string } | null>(null);
  const [deletePostOpen, setDeletePostOpen] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const { data: comments = [] } = trpc.gallery.listComments.useQuery(
    { postId: post.id },
    { enabled: showComments }
  );

  const reactMut = trpc.gallery.react.useMutation({
    onMutate: async ({ type }) => {
      await utils.gallery.list.cancel();
      const prev = utils.gallery.list.getData();
      utils.gallery.list.setData(undefined, (old) =>
        old?.map((p) => {
          if (p.id !== post.id) return p;
          const alreadyMine = p.myReaction === type;
          const likeCount = type === "like"
            ? p.likeCount + (alreadyMine ? -1 : p.myReaction === "like" ? -1 : 1)
            : p.likeCount + (p.myReaction === "like" ? -1 : 0);
          const loveCount = type === "love"
            ? p.loveCount + (alreadyMine ? -1 : p.myReaction === "love" ? -1 : 1)
            : p.loveCount + (p.myReaction === "love" ? -1 : 0);
          return { ...p, myReaction: alreadyMine ? null : type, likeCount, loveCount };
        })
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.gallery.list.setData(undefined, ctx.prev);
    },
    onSettled: () => utils.gallery.list.invalidate(),
  });

  const addCommentMut = trpc.gallery.addComment.useMutation({
    onSuccess: () => {
      setCommentText("");
      setReplyTo(null);
      utils.gallery.listComments.invalidate({ postId: post.id });
      utils.gallery.list.invalidate();
    },
  });

  const deleteCommentMut = trpc.gallery.deleteComment.useMutation({
    onSuccess: () => {
      utils.gallery.listComments.invalidate({ postId: post.id });
      utils.gallery.list.invalidate();
    },
  });

  const deletePostMut = trpc.gallery.delete.useMutation({
    onSuccess: () => {
      utils.gallery.list.invalidate();
      toast.success("Post deleted");
    },
  });

  const handleReply = (parentId: number, parentName: string) => {
    setReplyTo({ id: parentId, name: parentName });
    setShowComments(true);
    setTimeout(() => commentInputRef.current?.focus(), 100);
  };

  const handleSubmitComment = () => {
    const body = commentText.trim();
    if (!body) return;
    addCommentMut.mutate({
      postId: post.id,
      body,
      parentId: replyTo?.id,
    });
  };

  const name = getDisplayName(post);
  const canDelete = isAdmin || post.userId === currentUserId;

  // Thread comments: top-level and replies
  const topLevel = (comments as CommentRow[]).filter((c) => !c.parentId);
  const repliesMap = (comments as CommentRow[]).reduce<Record<number, CommentRow[]>>((acc, c) => {
    if (c.parentId) {
      acc[c.parentId] = [...(acc[c.parentId] ?? []), c];
    }
    return acc;
  }, {});

  return (
    <>
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarImage src={post.userAvatarUrl ?? undefined} />
                <AvatarFallback style={{ background: TEAL, color: "white" }}>
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm leading-tight">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
            {canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeletePostOpen(true)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete post
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Caption */}
          {post.caption && (
            <p className="px-4 pb-3 text-sm">{post.caption}</p>
          )}

          {/* Media carousel */}
          <MediaCarousel
            media={post.media?.length > 0 ? post.media : [{ mediaUrl: post.imageUrl, mimeType: "image/jpeg" }]}
            caption={post.caption}
            onOpenLightbox={(i) => setLightboxIndex(i)}
          />

          {/* Reaction counts */}
          {(post.likeCount > 0 || post.loveCount > 0) && (
            <div className="px-4 pt-2 flex items-center gap-2">
              {post.likeCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="text-base">👍</span> {post.likeCount}
                </span>
              )}
              {post.loveCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="text-base">❤️</span> {post.loveCount}
                </span>
              )}
              {post.commentCount > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
                </span>
              )}
            </div>
          )}

          <Separator className="mx-4 my-2" style={{ width: "calc(100% - 2rem)" }} />

          {/* Action bar */}
          <div className="flex items-center gap-1 px-2 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 gap-2 rounded-lg"
              style={post.myReaction === "like" ? { color: TEAL } : {}}
              onClick={() => reactMut.mutate({ postId: post.id, type: "like" })}
            >
              <ThumbsUp className="w-4 h-4" fill={post.myReaction === "like" ? "currentColor" : "none"} />
              Like
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 gap-2 rounded-lg"
              style={post.myReaction === "love" ? { color: "#e0245e" } : {}}
              onClick={() => reactMut.mutate({ postId: post.id, type: "love" })}
            >
              <Heart className="w-4 h-4" fill={post.myReaction === "love" ? "currentColor" : "none"} />
              Love
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 gap-2 rounded-lg"
              onClick={() => {
                setShowComments((v) => !v);
                setTimeout(() => commentInputRef.current?.focus(), 100);
              }}
            >
              <MessageCircle className="w-4 h-4" />
              Comment
            </Button>
          </div>

          {/* Comments section */}
          {showComments && (
            <div className="px-4 pb-4 flex flex-col gap-3">
              <Separator />

              {topLevel.length > 0 && (
                <div className="flex flex-col gap-3 mt-1">
                  {topLevel.map((c) => (
                    <CommentItem
                      key={c.id}
                      comment={c}
                      replies={repliesMap[c.id] ?? []}
                      currentUserId={currentUserId}
                      isAdmin={isAdmin}
                      postId={post.id}
                      onReply={handleReply}
                      onDelete={(id) => deleteCommentMut.mutate({ commentId: id })}
                    />
                  ))}
                </div>
              )}

              {/* Comment input */}
              <div className="flex gap-2 items-start mt-1">
                <Avatar className="w-8 h-8 flex-shrink-0">
                  <AvatarFallback style={{ background: TEAL, color: "white", fontSize: 11 }}>
                    Me
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 flex flex-col gap-1">
                  {replyTo && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Replying to <strong>{replyTo.name}</strong></span>
                      <button onClick={() => setReplyTo(null)} className="ml-1 hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Textarea
                      ref={commentInputRef}
                      placeholder={replyTo ? `Reply to ${replyTo.name}...` : "Write a comment..."}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      className="min-h-[36px] max-h-[120px] resize-none rounded-2xl text-sm py-2"
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmitComment();
                        }
                      }}
                    />
                    <Button
                      size="icon"
                      className="rounded-full w-9 h-9 flex-shrink-0 self-end"
                      style={{ background: TEAL }}
                      disabled={!commentText.trim() || addCommentMut.isPending}
                      onClick={handleSubmitComment}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {lightboxIndex !== null && (
        <Lightbox
          items={post.media?.length > 0 ? post.media : [{ mediaUrl: post.imageUrl, mimeType: "image/jpeg" }]}
          startIndex={lightboxIndex}
          alt={post.caption ?? "Gallery photo"}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <AlertDialog open={deletePostOpen} onOpenChange={setDeletePostOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the photo and all its comments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePostMut.mutate({ postId: post.id })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Upload Dialog ─────────────────────────────────────────────────────────────

type FileEntry = { preview: string; base64: string; mime: string; name: string };

function UploadDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [caption, setCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX_FILES = 10;
  const MAX_SIZE_MB = 50;

  const uploadMut = trpc.gallery.upload.useMutation({
    onSuccess: () => {
      const count = files.length;
      toast.success(count === 1 ? "Photo posted to the gallery!" : `${count} files posted to the gallery!`);
      onSuccess();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const readFiles = (selected: File[]) => {
    const remaining = MAX_FILES - files.length;
    const toAdd = selected.slice(0, remaining);
    let oversized = false;
    toAdd.forEach((file) => {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) { oversized = true; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        setFiles((prev) => [
          ...prev,
          { preview: result, base64, mime: file.type, name: file.name },
        ]);
      };
      reader.readAsDataURL(file);
    });
    if (oversized) toast.error(`Each file must be under ${MAX_SIZE_MB} MB`);
    if (selected.length > remaining) toast.error(`Maximum ${MAX_FILES} files per post`);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    readFiles(selected);
    e.target.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (files.length === 0) return;
    uploadMut.mutate({
      files: files.map((f) => ({ fileBase64: f.base64, mimeType: f.mime })),
      caption: caption.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl p-6 flex flex-col gap-4"
        style={{ background: "var(--color-card)", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Share photos or videos</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Up to {MAX_FILES} files per post</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview grid */}
        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {files.map((f, i) => {
              const isVid = f.mime.startsWith("video/");
              return (
                <div key={i} className="relative rounded-lg overflow-hidden aspect-square bg-black">
                  {isVid ? (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <Film className="w-8 h-8 text-muted-foreground" />
                      <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/60 rounded px-1 truncate max-w-[90%]">{f.name}</span>
                    </div>
                  ) : (
                    <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />
                  )}
                  <button
                    className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
                    onClick={() => removeFile(i)}
                  >
                    <X className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              );
            })}
            {/* Add more button */}
            {files.length < MAX_FILES && (
              <button
                className="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed aspect-square transition-colors hover:border-primary"
                style={{ borderColor: "var(--color-border)" }}
                onClick={() => fileRef.current?.click()}
              >
                <ImageIcon className="w-6 h-6 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Add more</span>
              </button>
            )}
          </div>
        )}

        {/* Empty picker */}
        {files.length === 0 && (
          <button
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border)" }}
            onClick={() => fileRef.current?.click()}
          >
            <ImageIcon className="w-10 h-10 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Click to choose photos or videos</span>
            <span className="text-xs text-muted-foreground">JPEG, PNG, WEBP, MP4, MOV up to {MAX_SIZE_MB} MB each</span>
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Caption */}
        <Textarea
          placeholder="Add a caption (optional)..."
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={500}
          rows={2}
          className="resize-none"
        />

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {files.length}/{MAX_FILES} files selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={files.length === 0 || uploadMut.isPending}
              onClick={handleSubmit}
              style={{ background: TEAL, color: "white" }}
            >
              {uploadMut.isPending ? "Uploading..." : `Post ${files.length > 1 ? `${files.length} files` : "photo"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Gallery Page ─────────────────────────────────────────────────────────

export default function Gallery() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: posts = [], isLoading } = trpc.gallery.list.useQuery();

  const handleUploadSuccess = useCallback(() => {
    utils.gallery.list.invalidate();
  }, [utils]);

  return (
    <BVCLayout>
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Gallery</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Share photos with the group</p>
          </div>
          <Button
            className="gap-2"
            style={{ background: TEAL, color: "white" }}
            onClick={() => setUploadOpen(true)}
          >
            <Camera className="w-4 h-4" />
            <span className="hidden sm:inline">Share photo</span>
          </Button>
        </div>

        <FeedList posts={posts as any[]} isLoading={isLoading} currentUserId={user?.id ?? 0} isAdmin={isAdmin} />
      </div>

      {uploadOpen && (
        <UploadDialog onClose={() => setUploadOpen(false)} onSuccess={handleUploadSuccess} />
      )}
    </BVCLayout>
  );
}

function FeedList({
  posts,
  isLoading,
  currentUserId,
  isAdmin,
}: {
  posts: any[];
  isLoading: boolean;
  currentUserId: number;
  isAdmin: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-muted animate-pulse" />
                <div className="flex-1">
                  <div className="h-3 w-24 bg-muted rounded animate-pulse mb-1" />
                  <div className="h-2 w-16 bg-muted rounded animate-pulse" />
                </div>
              </div>
              <div className="w-full h-48 bg-muted rounded-lg animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Upload className="w-14 h-14 mb-4 text-muted-foreground" />
        <p className="font-semibold text-lg">No photos yet</p>
        <p className="text-sm text-muted-foreground mt-1">Be the first to share a photo with the group!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} currentUserId={currentUserId} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
