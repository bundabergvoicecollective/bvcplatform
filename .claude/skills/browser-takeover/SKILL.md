---
name: browser-takeover
description: Chrome is yours to drive for BVC migration work — Manus, Google Cloud Run, TiDB Cloud, Cloudflare, Square, GitHub, GoDaddy and the live member site all need Andy logged in. Use whenever a task needs a web console or the real site rather than the code: before opening a tab, when another session already holds the browser, and when the connection drops. Covers how to take the browser over, which tool to reach for, and what must never be touched in Andy's window.
---

# Taking over Chrome for the migration

Half of this migration lives behind logins, not in the repo: the old Manus
site, Cloud Run (`bvc-production`, australia-southeast1), TiDB Cloud,
Cloudflare (the members CNAME, the Host-rewriting Worker, the R2 bucket),
Square, GoDaddy, GitHub, and the live site at
`members.bundabergvoicecollective.com.au`. Reading those by hand and pasting
screenshots back costs Andy more than it costs you to open them yourself.

Firebase Hosting is **not** one of them any more — it was tried and dropped
(its Cloud Run rewrite needs a paid plan). Don't go looking for it.

**Chrome is enabled for every session on this machine** — the
`mcp__claude-in-chrome__*` tools are allowed in `~/.claude/settings.json`,
so no project needs to re-approve them and no session has to ask. Open the
console and look.

Two Chrome extensions are paired to this account ("Browser 1" and
"Browser 2", both on this Mac). Your actions go to whichever was picked
last — so if a page looks nothing like what Andy describes, you are
probably driving the other one.

## Taking it over

Chrome is a single shared browser. Another Claude session, or Andy himself,
may be in it right now.

1. **`tabs_context_mcp` first, every session.** It tells you what is open
   and gives you tab IDs that are valid *now*.
2. **Never reuse a tab ID from an earlier session or an earlier task.** They
   go stale; a stale ID is the usual cause of "tab doesn't exist".
3. **Work in your own tab.** `tabs_create_mcp` unless Andy pointed you at
   one of his.
4. **If a tool says the browser is held elsewhere or no browser is
   attached**: `list_connected_browsers`, then `select_browser` /
   `switch_browser` to claim the one you want. That is the takeover — do it
   yourself rather than asking.
5. **If a call times out or returns "No result received from the Claude
   Desktop app"**: reconnect silently first (see the
   `anthropic-skills:chrome-connection-recovery` skill). Only tell Andy
   after self-healing has actually failed.

## What not to touch

Andy's Chrome holds long-lived logins — GCP, TiDB, Cloudflare, Square,
GitHub, the bank. Taking the browser over is not permission to tidy it.

- **Never close one of his tabs or windows.** Not one that looks finished,
  not "to clean up". Close only `localhost` tabs **you** opened — and
  closing any tab prompts him first, by design. If the prompt appears for a
  tab that is not your own localhost one, you are about to do the wrong
  thing: cancel.
- **Never sign out, switch account, or clear cookies, storage or history.**
- **Leave your tab on something harmless** and say in your reply what you
  opened.
- **Never trigger a JavaScript `alert`, `confirm` or `prompt`.** A modal
  dialog blocks every later tool call and only Andy can dismiss it. Use
  `console.log` plus `read_console_messages` instead.

## Read, don't change — unless asked

The consoles behind these logins spend money and serve real members.

- **Read by default.** Open the page, take the text, back out with Cancel or
  the dialog's own X — never Save or Delete on a guess.
- **A deploy, a Cloudflare DNS or Worker change, a billing action, a schema
  change in the TiDB console, or anything on the live member site** is
  Andy's call. Find what
  needs doing, report it, and let him press the button — or push a branch
  (see `concurrent-sessions` conventions if this repo has them).
- **Don't accept banners, claim offers or dismiss notices** on his behalf.
- **If a password or 2FA prompt appears, stop and ask him to sign in.** Never
  type a password, never ask him to paste one into the chat.

## Which tool

| Need | Reach for |
| ---- | --------- |
| Read a console page | `get_page_text`, `read_page`, `find` |
| Click, type, scroll | `computer`, `form_input` |
| Why is the app broken | `read_console_messages`, `read_network_requests` |
| Several steps at once | `browser_batch` |
| Show Andy what happened | `gif_creator` (name the file for the task) |

Stay on the task. If the browser fails the same way three times, or the
console sends you somewhere unrelated, stop and say what you tried — don't
wander through his accounts.
