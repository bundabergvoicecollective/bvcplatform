import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import BVCLayout from "@/components/BVCLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Pencil,
  FileIcon,
  FileType2,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Eye,
  X,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "application/zip",
];

const MAX_FILE_SIZE_MB = 16;

function getFileIcon(mimeType: string) {
  if (mimeType === "application/pdf") return <FileType2 className="w-5 h-5 text-red-500" />;
  if (mimeType.startsWith("image/")) return <FileImage className="w-5 h-5 text-blue-500" />;
  if (mimeType.startsWith("audio/")) return <FileAudio className="w-5 h-5 text-purple-500" />;
  if (mimeType.startsWith("video/")) return <FileVideo className="w-5 h-5 text-orange-500" />;
  if (mimeType.includes("zip")) return <FileArchive className="w-5 h-5 text-yellow-600" />;
  return <FileIcon className="w-5 h-5 text-slate-500" />;
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Multi-Upload Dialog ──────────────────────────────────────────────────────

type FileEntry = {
  id: string; // local key
  file: File;
  title: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

function UploadDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFile = trpc.documents.uploadFile.useMutation();
  const createDoc = trpc.documents.create.useMutation();

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const valid: FileEntry[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error(`"${f.name}" exceeds ${MAX_FILE_SIZE_MB} MB — skipped`);
        continue;
      }
      valid.push({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
        file: f,
        title: f.name.replace(/\.[^/.]+$/, ""),
        status: "pending",
      });
    }
    setEntries((prev) => [...prev, ...valid]);
    // Reset input so same files can be re-added if needed
    e.target.value = "";
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const updateTitle = (id: string, title: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, title } : e)));
  };

  const handleUploadAll = async () => {
    if (entries.length === 0) { toast.error("Please select at least one file"); return; }
    const untitled = entries.find((e) => !e.title.trim());
    if (untitled) { toast.error(`Please enter a name for "${untitled.file.name}"`); return; }

    setUploading(true);
    let successCount = 0;

    for (const entry of entries) {
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, status: "uploading" } : e));
      try {
        const base64 = await toBase64(entry.file);
        const { fileKey, fileUrl, fileName } = await uploadFile.mutateAsync({
          fileName: entry.file.name,
          mimeType: entry.file.type,
          base64,
          fileSizeBytes: entry.file.size,
        });
        await createDoc.mutateAsync({
          title: entry.title.trim(),
          fileName,
          fileKey,
          fileUrl,
          mimeType: entry.file.type,
          fileSizeBytes: entry.file.size,
        });
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, status: "done" } : e));
        successCount++;
      } catch (err: any) {
        setEntries((prev) =>
          prev.map((e) => e.id === entry.id ? { ...e, status: "error", error: err?.message ?? "Upload failed" } : e)
        );
      }
    }

    setUploading(false);

    if (successCount > 0) {
      toast.success(
        successCount === entries.length
          ? `${successCount} document${successCount > 1 ? "s" : ""} uploaded successfully`
          : `${successCount} of ${entries.length} documents uploaded`
      );
      onSuccess();
    }

    const hasErrors = entries.some((e) => e.status === "error");
    if (!hasErrors) {
      onClose();
      setEntries([]);
    }
  };

  const handleClose = () => {
    if (uploading) return;
    setEntries([]);
    onClose();
  };

  const doneCount = entries.filter((e) => e.status === "done").length;
  const progress = entries.length > 0 ? Math.round((doneCount / entries.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => !uploading && fileRef.current?.click()}
          >
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Upload className="w-7 h-7" />
              <p className="text-sm font-medium">Click to select files</p>
              <p className="text-xs">PDF, Word, Excel, images, audio, video, ZIP — max {MAX_FILE_SIZE_MB} MB each</p>
              <p className="text-xs text-primary font-medium">Multiple files supported</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              accept={ACCEPTED_MIME_TYPES.join(",")}
              onChange={handleFilesChange}
              disabled={uploading}
            />
          </div>

          {/* File list */}
          {entries.length > 0 && (
            <ScrollArea className="max-h-64">
              <div className="space-y-2 pr-1">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 p-2.5 rounded-lg border"
                    style={{
                      borderColor:
                        entry.status === "done" ? "oklch(0.75 0.15 145)" :
                        entry.status === "error" ? "oklch(0.75 0.15 25)" :
                        "oklch(0.92 0.01 240)",
                      background:
                        entry.status === "done" ? "oklch(0.97 0.02 145)" :
                        entry.status === "error" ? "oklch(0.98 0.02 25)" :
                        "white",
                    }}
                  >
                    <div className="shrink-0">{getFileIcon(entry.file.type)}</div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <Input
                        value={entry.title}
                        onChange={(e) => updateTitle(entry.id, e.target.value)}
                        placeholder="Document name…"
                        className="h-7 text-xs"
                        disabled={uploading || entry.status === "done"}
                      />
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.file.name} · {formatFileSize(entry.file.size)}
                      </p>
                      {entry.status === "error" && (
                        <p className="text-xs text-red-500">{entry.error}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {entry.status === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                      {entry.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {(entry.status === "pending" || entry.status === "error") && !uploading && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeEntry(entry.id)}>
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Progress bar */}
          {uploading && entries.length > 1 && (
            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground text-center">{doneCount} / {entries.length} uploaded</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={uploading}>Cancel</Button>
          <Button onClick={handleUploadAll} disabled={uploading || entries.length === 0}>
            {uploading
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Uploading…</>
              : <><Upload className="w-4 h-4 mr-1.5" /> Upload {entries.length > 0 ? `${entries.length} file${entries.length > 1 ? "s" : ""}` : ""}</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rename Dialog ────────────────────────────────────────────────────────────

function RenameDialog({
  doc,
  onClose,
  onSuccess,
}: {
  doc: { id: number; title: string; description?: string | null };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const update = trpc.documents.update.useMutation();

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Name is required"); return; }
    try {
      await update.mutateAsync({ id: doc.id, title: title.trim() });
      toast.success("Document renamed");
      onSuccess();
      onClose();
    } catch {
      toast.error("Failed to rename document");
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename Document</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={update.isPending || !title.trim()}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Document Card ────────────────────────────────────────────────────────────

type DocRow = {
  id: number;
  title: string;
  description?: string | null;
  fileName: string;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  fileSizeBytes?: number | null;
  uploadedBy: number;
  createdAt: Date;
  uploaderName?: string | null;
};

function DocumentCard({
  doc,
  isAdmin,
  onRename,
  onDelete,
}: {
  doc: DocRow;
  isAdmin: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const isPreviewable =
    doc.mimeType === "application/pdf" ||
    doc.mimeType.startsWith("image/");

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">{getFileIcon(doc.mimeType)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-sm leading-tight truncate">{doc.title}</h3>
                {doc.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{doc.description}</p>
                )}
              </div>
              {isAdmin && (
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Rename"
                    onClick={onRename}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    title="Delete"
                    onClick={onDelete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-xs font-normal">
                {doc.fileName.split(".").pop()?.toUpperCase() ?? "FILE"}
              </Badge>
              {doc.fileSizeBytes && (
                <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSizeBytes)}</span>
              )}
              <span className="text-xs text-muted-foreground">
                Uploaded {format(new Date(doc.createdAt), "d MMM yyyy")}
                {doc.uploaderName ? ` by ${doc.uploaderName}` : ""}
              </span>
            </div>

            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" asChild>
                <a href={doc.fileUrl} download={doc.fileName} target="_blank" rel="noopener noreferrer">
                  <Download className="w-3 h-3" />
                  Download
                </a>
              </Button>
              {isPreviewable && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" asChild>
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                    <Eye className="w-3 h-3" />
                    Preview
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Documents() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: docs = [], refetch } = trpc.documents.list.useQuery();
  const deleteDoc = trpc.documents.delete.useMutation();

  const [showUpload, setShowUpload] = useState(false);
  const [renamingDoc, setRenamingDoc] = useState<DocRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const filtered = docs.filter(
    (d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      (d.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      d.fileName.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteDoc.mutateAsync({ id: deletingId });
      toast.success("Document deleted");
      refetch();
    } catch {
      toast.error("Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <BVCLayout>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="w-6 h-6" />
              Forms &amp; Documents
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isAdmin
                ? "Upload and manage documents for all members."
                : "View and download documents shared by the choir admin."}
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowUpload(true)} className="gap-2 shrink-0">
              <Upload className="w-4 h-4" />
              Upload
            </Button>
          )}
        </div>

        {/* Search */}
        {docs.length > 0 && (
          <Input
            placeholder="Search documents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        )}

        {/* Document list */}
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
              {docs.length === 0 ? (
                <>
                  <p className="font-medium text-muted-foreground">No documents yet</p>
                  {isAdmin && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Click <strong>Upload</strong> to add the first document.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">No documents match your search.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc as DocRow}
                isAdmin={isAdmin}
                onRename={() => setRenamingDoc(doc as DocRow)}
                onDelete={() => setDeletingId(doc.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <UploadDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onSuccess={() => refetch()}
      />

      {/* Rename dialog */}
      {renamingDoc && (
        <RenameDialog
          doc={renamingDoc}
          onClose={() => setRenamingDoc(null)}
          onSuccess={() => { refetch(); setRenamingDoc(null); }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingId} onOpenChange={(v) => !v && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the document and its file. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BVCLayout>
  );
}
