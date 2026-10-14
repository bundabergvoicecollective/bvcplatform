import DOMPurify from "dompurify";
import { useMemo } from "react";

/**
 * Renders a description that may be rich text (HTML from RichTextEditor) or
 * may be plain text typed before that editor existed.
 *
 * Both have to work. The Carols description was written in Manus as plain
 * text with real line breaks in it, and rendering that through
 * dangerouslySetInnerHTML would collapse every one of them into a single
 * run-on paragraph — which is exactly what it looked like on the live site.
 * So: anything without a tag in it is rendered as text with `pre-wrap`, which
 * keeps the breaks the author typed.
 *
 * Everything else is sanitised. The authors are admins, but "only admins can
 * write it" is not a reason to inject unsanitised HTML into every member's
 * browser — an admin account is exactly what an attacker would want, and a
 * stored script would run for all 76 of them.
 */

/** Tags the editor can produce, and nothing else. No script, no iframe, no style. */
const ALLOWED_TAGS = [
  "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "a", "img",
  "h3", "h4", "blockquote", "div", "span",
];
const ALLOWED_ATTR = ["href", "target", "rel", "src", "alt", "title"];

/**
 * ALLOWED_URI_REGEXP does not cover data: URIs on an <img>: DOMPurify permits
 * those separately, by tag, and a test of `<img src="data:text/html;base64,…">`
 * came back through the allowlist untouched. A browser will not execute HTML
 * from an img, so this was not an open door — but an allowlist that quietly
 * admits something it was written to exclude is not one you can reason about,
 * and the next person to widen ALLOWED_TAGS would inherit the hole.
 *
 * Every image we place is uploaded to our own bucket and referenced by URL, so
 * nothing legitimate loses anything.
 *
 * The hook is global to DOMPurify and registered once. Nothing else in this
 * app sanitises, and if something starts to, it wants this rule too.
 */
let hooked = false;
function installDataUriGuard() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    for (const attr of ["src", "href"]) {
      const value = (node as Element).getAttribute?.(attr);
      if (value && /^\s*data:/i.test(value)) (node as Element).removeAttribute(attr);
    }
  });
}

export function sanitizeRichText(html: string): string {
  installDataUriGuard();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // javascript: in an href or src is the whole attack; data: is handled by
    // the hook above, which this regex does not reach.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/(?!\/))/i,
    ADD_ATTR: ["target"],
  });
}

const looksLikeHtml = (s: string) => /<\/?(?:p|br|ul|ol|li|strong|b|em|i|u|a|img|h3|h4|div)\b/i.test(s);

export function RichText({ html, className, style }: { html: string; className?: string; style?: React.CSSProperties }) {
  const clean = useMemo(() => (looksLikeHtml(html) ? sanitizeRichText(html) : null), [html]);

  if (clean === null) {
    // Plain text from before the editor — keep the author's line breaks.
    return (
      <div className={className} style={{ whiteSpace: "pre-wrap", ...style }}>
        {html}
      </div>
    );
  }

  return (
    <div
      className={`bvc-rich ${className ?? ""}`}
      style={style}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
