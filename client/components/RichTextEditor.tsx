import { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Image as ImageIcon, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { sanitizeRichText } from "./RichText";

/**
 * A plain-English editor for a performance description: bold, bullets,
 * numbered lists, real line breaks, and a photo dropped in among the text.
 *
 * Written against contenteditable rather than pulling in an editor library.
 * What is needed here is four buttons and an image; a framework for that
 * would be several packages to install, keep current and understand later,
 * for a single field on one page.
 *
 * ── the contenteditable rules, which are not obvious ──
 *
 * The box is UNCONTROLLED. Writing `value` back into innerHTML on every
 * keystroke is the obvious React shape and it puts the caret at position 0
 * after every character, so the text comes out backwards. innerHTML is set
 * once when the editor opens and when the caller swaps to a different record,
 * tracked by `loadedFor` — never on the user's own typing.
 *
 * Pasting is forced to plain text. Admins write these in email or Word first,
 * and pasting from there carries fonts, colours and Office markup that
 * survives sanitising, looks wrong against the site, and is impossible to get
 * out again without clearing the box. Line breaks in what they paste are kept.
 */

const TEAL = "oklch(0.45 0.12 185)";

type Props = {
  value: string;
  onChange: (html: string) => void;
  /** Changes when the caller moves to a different record, so the box reloads. */
  recordKey?: string | number;
  placeholder?: string;
  minHeight?: number;
};

export function RichTextEditor({
  value,
  onChange,
  recordKey = "new",
  placeholder = "Describe the performance…",
  minHeight = 220,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | number | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = trpc.events.uploadImage.useMutation();

  // Load the starting content once per record. A description written before
  // this editor existed is plain text with real newlines in it; dropping that
  // into innerHTML would collapse every break, so it is converted first.
  useEffect(() => {
    if (loadedFor.current === recordKey) return;
    loadedFor.current = recordKey;
    const box = boxRef.current;
    if (!box) return;
    const looksLikeHtml = /<\/?(?:p|br|ul|ol|li|strong|b|em|i|u|a|img|h3|h4|div)\b/i.test(value);
    box.innerHTML = looksLikeHtml
      ? sanitizeRichText(value)
      : value
          .split("\n")
          .map((line) => line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!))
          .join("<br>");
  }, [recordKey, value]);

  const emit = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    // An "empty" contenteditable still holds <br> or an empty div; save that
    // as nothing so the card does not render a blank paragraph.
    const html = box.innerHTML;
    onChange(box.textContent?.trim() || box.querySelector("img") ? html : "");
  }, [onChange]);

  /**
   * execCommand is deprecated and every browser still implements it, because
   * the whole web's editors rely on it. The replacements are not finished.
   */
  const run = (command: string) => {
    boxRef.current?.focus();
    document.execCommand(command, false);
    emit();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const html = text
      .split("\n")
      .map((line) => line.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!))
      .join("<br>");
    document.execCommand("insertHTML", false, html);
    emit();
  };

  const insertImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("That is not an image file.");
      return;
    }
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`That image is too big. The limit is ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve((ev.target?.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
      const result = await upload.mutateAsync({
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });
      boxRef.current?.focus();
      // The alt text is the file name: a screen reader and a broken image both
      // need something, and the person who chose the file is the only one who
      // can say what it shows.
      const alt = file.name.replace(/\.[^.]+$/, "").replace(/[&<>"]/g, "");
      document.execCommand("insertHTML", false, `<img src="${result.url}" alt="${alt}">`);
      emit();
    } catch (err) {
      toast.error(`The image did not upload: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const Btn = ({
    onClick,
    title,
    children,
    disabled,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      // Keep the caret where it is: a toolbar button that steals focus applies
      // its formatting to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40"
      style={{ color: "oklch(0.35 0.04 240)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "oklch(0.94 0.01 240)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "oklch(0.88 0.02 240)", background: "white" }}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 border-b"
        style={{ borderColor: "oklch(0.92 0.02 240)", background: "oklch(0.985 0.005 240)" }}
      >
        <Btn onClick={() => run("bold")} title="Bold"><Bold className="w-4 h-4" /></Btn>
        <Btn onClick={() => run("italic")} title="Italic"><Italic className="w-4 h-4" /></Btn>
        <div className="w-px h-5 mx-1" style={{ background: "oklch(0.90 0.02 240)" }} />
        <Btn onClick={() => run("insertUnorderedList")} title="Bullet points"><List className="w-4 h-4" /></Btn>
        <Btn onClick={() => run("insertOrderedList")} title="Numbered list"><ListOrdered className="w-4 h-4" /></Btn>
        <div className="w-px h-5 mx-1" style={{ background: "oklch(0.90 0.02 240)" }} />
        <Btn onClick={() => fileRef.current?.click()} title="Add a photo" disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
        </Btn>
        <div className="flex-1" />
        <Btn onClick={() => run("undo")} title="Undo"><Undo2 className="w-4 h-4" /></Btn>
      </div>

      <div
        ref={boxRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Description"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onPaste={handlePaste}
        className="bvc-rich bvc-rich-editor px-3 py-2.5 text-sm overflow-y-auto"
        style={{ minHeight, maxHeight: 420, color: "oklch(0.25 0.03 240)", lineHeight: 1.55 }}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertImage(f);
        }}
      />
      <p className="px-3 py-1.5 text-xs border-t" style={{ borderColor: "oklch(0.94 0.01 240)", color: "oklch(0.55 0.02 240)", background: "oklch(0.99 0.003 240)" }}>
        Enter starts a new line. Use the buttons for bold, bullet points and photos — pasted text keeps its line breaks but drops other formatting.
      </p>
    </div>
  );
}

export { TEAL as RICH_TEXT_ACCENT };
