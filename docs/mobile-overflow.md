# When a page sits shifted sideways on a phone

The symptom: headings cut off at the left, cards cut off at the right, and the
page slides horizontally when it should not. One element somewhere is wider
than the screen, and a document that *can* scroll sideways does.

`client/components/BVCLayout.tsx` now contains that by default — `<main>` has
`min-w-0` so it respects the screen rather than its widest child, and
`overflow-x-clip` so anything still too wide is clipped instead of pushing the
page across. (`clip`, not `hidden`: hidden would make `main` a scroll container
and break normal page scrolling.)

That stops the page shifting. It does not fix whatever is too wide, which is
usually still worth finding — clipped content is content a member cannot read.

## Finding the actual offender

On the phone or browser showing the problem, open the console and paste this.
It names every element crossing the edge, outermost first.

```js
(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      out.push({
        tag: el.tagName.toLowerCase(),
        class: (typeof el.className === "string" ? el.className : "").slice(0, 70),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        text: (el.textContent || "").trim().slice(0, 40),
      });
    }
  }
  console.log("viewport", vw, "document", document.documentElement.scrollWidth);
  console.table(out.slice(0, 20));
})();
```

On a phone, connect it to a desktop browser first — iPhone: Settings → Safari →
Advanced → Web Inspector, then Safari on a Mac → Develop → your phone.

## The usual causes

- **A long unbroken string** — an email address or URL. Fix with `truncate` or
  `break-words`, and `min-w-0` on every flex ancestor between it and the page.
  `truncate` alone does nothing inside a flex item that has not been told it may
  shrink: it sets `white-space: nowrap`, which makes the item *wider*.
- **A table.** Wrap it in a `div` with `overflow-x-auto` so the table scrolls
  rather than the page.
- **A chart.** Recharts measures its parent; if the parent has no settled width
  at that moment it can render wider than the screen and stay that way.
- **A negative margin** such as `-ml-2` on a full-width block, which makes the
  element wider than its container by that amount.
