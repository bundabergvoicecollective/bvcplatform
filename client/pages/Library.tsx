import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import BVCLayout from "@/components/BVCLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Music2, FileText, Upload, Download, Play, Pause, Trash2, Search, CheckCircle2, ArrowUpDown, Pencil } from "lucide-react";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";

function UploadDialog({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [type, setType] = useState<"sheet_music" | "backing_track" | "lyrics" | "chord_chart">("sheet_music");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const resetForm = () => {
    setTitle("");
    setArtist("");
    setFile(null);
    setProgress(0);
    setDone(false);
    setUploading(false);
  };

  const handleUpload = async () => {
    if (!file || !title) return;
    setUploading(true);
    setProgress(0);
    setDone(false);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      if (artist) formData.append("artist", artist);
      formData.append("type", type);

      // Use XMLHttpRequest so we can track upload progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload/library");

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 95));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve();
          } else {
            let msg = "Upload failed";
            try { msg = JSON.parse(xhr.responseText)?.error ?? msg; } catch {}
            reject(new Error(msg));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

        xhr.send(formData);
      });

      setDone(true);
      utils.library.list.invalidate();
      onUploaded();
      toast.success("File uploaded to library");
      setTimeout(() => { setOpen(false); resetForm(); }, 800);
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
      <DialogTrigger asChild>
        <Button
          className="flex items-center gap-2 font-semibold"
          style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
        >
          <Upload className="w-4 h-4" /> Upload File
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload to Music Library</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input
              placeholder="e.g. Hallelujah"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Artist / Composer (optional)</Label>
            <Input
              placeholder="e.g. Leonard Cohen"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sheet_music">Sheet Music</SelectItem>
                <SelectItem value="backing_track">Backing Track (Audio)</SelectItem>
                <SelectItem value="lyrics">Lyrics / Words</SelectItem>
                <SelectItem value="chord_chart">Chord Chart</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>File *</Label>
            <div
              className="mt-1 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ borderColor: "oklch(0.78 0.17 75)" }}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-6 h-6 mx-auto mb-2" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                {file ? file.name : "Click to select a file (PDF, Word, audio, etc.)"}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept={type === "backing_track" ? "audio/*" : ".pdf,.doc,.docx,.odt,.rtf,.txt,.pages,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain,text/rtf"}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          {/* Progress bar — shown while uploading */}
          {uploading && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
                <span>{done ? "Upload complete!" : `Uploading… ${progress}%`}</span>
                {done && <CheckCircle2 className="w-4 h-4" style={{ color: "oklch(0.55 0.14 185)" }} />}
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
          <Button
            className="w-full font-semibold"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            disabled={!title || !file || uploading}
            onClick={handleUpload}
          >
            {uploading ? (done ? "Done!" : "Uploading…") : "Upload"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AudioPlayer({ url, fileName }: { url: string; fileName: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  };

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} />
      <button
        onClick={toggle}
        className="w-8 h-8 rounded-full flex items-center justify-center transition-transform active:scale-95"
        style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <span className="text-xs truncate max-w-[120px]" style={{ color: "oklch(0.52 0.03 240)" }}>
        {playing ? "Playing..." : "Preview"}
      </span>
    </div>
  );
}

function EditLibraryDialog({ item, onSaved }: { item: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [artist, setArtist] = useState(item.artist ?? "");
  const [type, setType] = useState<"sheet_music" | "backing_track" | "lyrics" | "chord_chart">(item.type);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const updateMeta = trpc.library.update.useMutation({
    onSuccess: () => {
      utils.library.list.invalidate();
      onSaved();
      toast.success("Library item updated");
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const replaceFile = trpc.library.replaceFile.useMutation({
    onSuccess: () => {
      utils.library.list.invalidate();
      onSaved();
      toast.success("File replaced successfully");
      setOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = async () => {
    if (!title.trim()) return;
    setUploading(true);
    try {
      // Update metadata first
      await updateMeta.mutateAsync({ id: item.id, title: title.trim(), artist: artist.trim() || null, type });
      // If a new file was selected, replace it too
      if (newFile) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve) => {
          reader.onload = (e) => resolve((e.target?.result as string).split(",")[1]);
          reader.readAsDataURL(newFile);
        });
        await replaceFile.mutateAsync({ id: item.id, fileName: newFile.name, mimeType: newFile.type, fileBase64: base64 });
      }
    } finally {
      setUploading(false);
    }
  };

  const isAudio = type === "backing_track";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="p-1 rounded hover:bg-blue-50 transition-colors"
        style={{ color: "oklch(0.45 0.14 240)" }}
        title="Edit"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Library Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Artist / Composer (optional)</Label>
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Leonard Cohen" className="mt-1" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sheet_music">Sheet Music</SelectItem>
                <SelectItem value="backing_track">Backing Track (Audio)</SelectItem>
                <SelectItem value="lyrics">Lyrics / Words</SelectItem>
                <SelectItem value="chord_chart">Chord Chart</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Replace File (optional)</Label>
            <div
              className="mt-1 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ borderColor: "oklch(0.78 0.17 75)" }}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-5 h-5 mx-auto mb-1" style={{ color: "oklch(0.78 0.17 75)" }} />
              <p className="text-xs" style={{ color: "oklch(0.52 0.03 240)" }}>
                {newFile ? newFile.name : `Current: ${item.fileName} — click to replace`}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept={isAudio ? "audio/*" : ".pdf,.doc,.docx,.odt,.rtf,.txt,.pages,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain,text/rtf"}
                className="hidden"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <Button
            className="w-full font-semibold"
            style={{ background: "oklch(0.55 0.14 185)", color: "white" }}
            disabled={!title.trim() || uploading}
            onClick={handleSave}
          >
            {uploading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LibraryItemCard({
  item,
  isAdmin,
  onDeleted,
}: {
  item: any;
  isAdmin: boolean;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const del = trpc.library.delete.useMutation({
    onSuccess: () => {
      utils.library.list.invalidate();
      onDeleted();
      toast.success("Item removed from library");
    },
    onError: (e) => toast.error(e.message),
  });

  const isAudio = item.type === "backing_track";

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: isAudio ? "oklch(0.94 0.06 185)" : "oklch(0.97 0.04 75)",
            }}
          >
            {isAudio ? (
              <Music2 className="w-5 h-5" style={{ color: "oklch(0.55 0.14 185)" }} />
            ) : (
              <FileText className="w-5 h-5" style={{ color: "oklch(0.78 0.17 75)" }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: "oklch(0.22 0.07 240)" }}>
              {item.title}
            </p>
            {item.artist && (
              <p className="text-xs truncate" style={{ color: "oklch(0.52 0.03 240)" }}>
                {item.artist}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge
                className="text-xs"
                style={{
                  background: isAudio
                    ? "oklch(0.94 0.06 185)"
                    : item.type === "chord_chart"
                    ? "oklch(0.94 0.05 300)"
                    : item.type === "lyrics"
                    ? "oklch(0.94 0.05 140)"
                    : "oklch(0.97 0.04 75)",
                  color: isAudio
                    ? "oklch(0.35 0.10 185)"
                    : item.type === "chord_chart"
                    ? "oklch(0.35 0.10 300)"
                    : item.type === "lyrics"
                    ? "oklch(0.35 0.10 140)"
                    : "oklch(0.45 0.10 75)",
                }}
              >
                {isAudio ? "Backing Track" : item.type === "chord_chart" ? "Chord Chart" : item.type === "lyrics" ? "Lyrics" : "Sheet Music"}
              </Badge>
              <span className="text-xs" style={{ color: "oklch(0.65 0.02 240)" }}>
                {format(new Date(item.createdAt), "d MMM yyyy")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "oklch(0.94 0.01 240)" }}>
          {isAudio ? (
            <AudioPlayer url={item.fileUrl} fileName={item.fileName} />
          ) : (
            <a
              href={item.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-medium"
              style={{ color: "oklch(0.55 0.14 185)" }}
            >
              <FileText className="w-3.5 h-3.5" />
              View PDF
            </a>
          )}
          <a
            href={item.fileUrl}
            download={item.fileName}
            className="flex items-center gap-1.5 text-xs font-medium ml-auto"
            style={{ color: "oklch(0.52 0.03 240)" }}
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
          {isAdmin && (
            <div className="flex items-center gap-1">
              <EditLibraryDialog item={item} onSaved={() => {}} />
              <button
                onClick={() => {
                  if (confirm("Remove this item from the library?")) {
                    del.mutate({ id: item.id });
                  }
                }}
                className="p-1 rounded hover:bg-red-50 transition-colors"
                style={{ color: "oklch(0.577 0.245 27.325)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = "az" | "za" | "artist_az" | "artist_za" | "date_desc" | "date_asc" | "length_desc" | "length_asc";

function sortItems(list: any[], sort: SortKey) {
  return [...list].sort((a, b) => {
    switch (sort) {
      case "az":          return a.title.localeCompare(b.title);
      case "za":          return b.title.localeCompare(a.title);
      case "artist_az":   return (a.artist ?? "").localeCompare(b.artist ?? "") || a.title.localeCompare(b.title);
      case "artist_za":   return (b.artist ?? "").localeCompare(a.artist ?? "") || a.title.localeCompare(b.title);
      case "date_desc":   return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "date_asc":    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case "length_desc": return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
      case "length_asc":  return (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
      default: return 0;
    }
  });
}

export default function Library() {
  const { user } = useAuth();
  const { data: items, isLoading, refetch } = trpc.library.list.useQuery();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("az");
  const isAdmin = user?.role === "admin";

  const filtered = sortItems(
    (items ?? []).filter(
      (i) =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        (i.artist ?? "").toLowerCase().includes(search.toLowerCase())
    ),
    sort
  );

  const sheetMusic = filtered.filter((i) => i.type === "sheet_music");
  const backingTracks = filtered.filter((i) => i.type === "backing_track");
  const lyrics = filtered.filter((i) => i.type === "lyrics");
  const chordCharts = filtered.filter((i) => i.type === "chord_chart");

  return (
    <BVCLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold" style={{ color: "oklch(0.22 0.07 240)" }}>
              Music Library
            </h1>
            <p className="text-sm mt-1" style={{ color: "oklch(0.52 0.03 240)" }}>
              Sheet music and backing tracks for the choir.
            </p>
          </div>
          {isAdmin && <UploadDialog onUploaded={() => refetch()} />}
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "oklch(0.65 0.02 240)" }} />
            <Input
              placeholder="Search by title or artist..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[180px] gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: "oklch(0.55 0.14 185)" }} />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="az">Title A → Z</SelectItem>
              <SelectItem value="za">Title Z → A</SelectItem>
              <SelectItem value="artist_az">Artist A → Z</SelectItem>
              <SelectItem value="artist_za">Artist Z → A</SelectItem>
              <SelectItem value="date_desc">Date Added (Newest)</SelectItem>
              <SelectItem value="date_asc">Date Added (Oldest)</SelectItem>
              <SelectItem value="length_desc">Length (Longest)</SelectItem>
              <SelectItem value="length_asc">Length (Shortest)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-36 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <Tabs defaultValue="all">
            <TabsList className="mb-4 flex-wrap h-auto gap-1">
              <TabsTrigger value="all">All ({filtered.length})</TabsTrigger>
              <TabsTrigger value="sheet">Sheet Music ({sheetMusic.length})</TabsTrigger>
              <TabsTrigger value="tracks">Backing Tracks ({backingTracks.length})</TabsTrigger>
              <TabsTrigger value="lyrics">Lyrics ({lyrics.length})</TabsTrigger>
              <TabsTrigger value="chords">Chord Charts ({chordCharts.length})</TabsTrigger>
            </TabsList>

            {(["all", "sheet", "tracks", "lyrics", "chords"] as const).map((tab) => {
              const list =
                tab === "all" ? filtered
                : tab === "sheet" ? sheetMusic
                : tab === "tracks" ? backingTracks
                : tab === "lyrics" ? lyrics
                : chordCharts;
              return (
                <TabsContent key={tab} value={tab}>
                  {list.length === 0 ? (
                    <Card className="border-0 shadow-sm">
                      <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                        <Music2 className="w-10 h-10" style={{ color: "oklch(0.78 0.17 75)" }} />
                        <p className="font-medium" style={{ color: "oklch(0.22 0.07 240)" }}>
                          {search ? "No results found" : "No files yet"}
                        </p>
                        {isAdmin && !search && (
                          <p className="text-sm" style={{ color: "oklch(0.52 0.03 240)" }}>
                            Upload your first file using the button above.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {list.map((item) => (
                        <LibraryItemCard
                          key={item.id}
                          item={item}
                          isAdmin={isAdmin}
                          onDeleted={() => refetch()}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </BVCLayout>
  );
}
