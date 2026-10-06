# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install              # pnpm 10; the lockfile is authoritative (CI uses --frozen-lockfile)
pnpm run dev              # tsx watch server/index.ts; Vite dev server proxies /api and /r2-storage to :3000
pnpm run check            # tsc --noEmit — run this before every push, see "Types are not checked by the build"
pnpm run build            # vite build (client) + esbuild bundle (server) into dist/
pnpm run start            # node dist/index.js, expects NODE_ENV=production
```

There is no test suite. `vitest` is installed but nothing uses it, so `pnpm run check` plus a real build is the only automated signal. Do not claim tests pass.

Schema changes go out through the deploy workflow, which runs `drizzle-kit push` against the live database. `pnpm run db:push` (generate + migrate) exists but is not what production uses.

## Architecture

**Single Express process serves both halves.** `server/index.ts` mounts the tRPC router, the multipart upload routes and the static client build, then listens on `PORT` (8080 in production). There is no separate API service.

**Application modules live at the repository root, not under `server/`.** `routers.ts` (~2300 lines, all tRPC procedures), `db.ts`, `storage.ts`, `email.ts`, `square.ts` and `passReceipt.ts` sit beside `package.json`. `server/` holds only the HTTP entry point, auth routes, the R2 proxy and the Vite middleware. `_core/` holds cross-cutting setup (tRPC init, request context, env, cookies) and in places re-exports the root modules, so the same helper can be reachable by two paths.

**tRPC is mounted at `/api/trpc`, not `/trpc`.** Both sides must agree on three things or the app breaks silently: the URL, the `superjson` transformer (set in `_core/trpc.ts` on the server and on `httpBatchLink` in `client/main.tsx`), and `credentials: "include"`. A mismatch in any of them produces responses the client cannot read, with no error in the build.

**Auth is a JWT in a cookie named `__session`.** The name comes from `shared/const.ts` and is deliberate — see the comment there before changing it; renaming invalidates every live session. `_core/context.ts` reads it for tRPC, `_core/auth-helper.ts` for the non-tRPC upload routes.

**Uploads go through the server, never browser-to-R2.** Gallery and Documents use tRPC mutations; Library and rehearsal recordings POST multipart to `/api/upload/*`. The server then calls `storage.ts`, which talks to Cloudflare R2 over the S3 API. This is why no CORS policy is needed on the bucket. `storagePrepareUpload` returns a presigned URL and is currently unused — wiring it to a browser would make bucket CORS a new requirement.

**Files are read back one of two ways.** With `R2_PUBLIC_URL` set, `keyToUrl` returns a direct public URL; without it, `/r2-storage/<key>` served by `server/storageProxy.ts`. Setting the variable while the bucket is not actually public makes uploads succeed and every image 404.

**The app bootstraps its own database.** On boot `server/index.ts` connects to `sys`, issues `CREATE DATABASE IF NOT EXISTS bvc`, then reconnects. A fresh TiDB cluster needs no manual setup beyond `DATABASE_URL`.

**Config funnels through `_core/env.ts`.** Every value has a fallback, so a missing secret degrades a feature rather than stopping boot — R2 and Square both fail at call time, not at import. The deploy workflow passes only non-empty values, so an unset secret leaves the default in place. The upshot: misconfiguration is quiet. When a feature misbehaves in production, check the `Runtime vars set:` line in the deploy log before reading code.

**`APP_URL` is the origin for every emailed link** — password set-up, reset, and invites. It exists because the alternatives are attacker-controlled (`x-forwarded-host`) or sender-controlled (the admin's `window.location.origin`). Both have been fixed to prefer it. Do not reintroduce a link built from request or client data.

## Things that have cost real time here

**Types are not checked by the build.** `esbuild` strips TypeScript without checking it, so type errors ship happily. Ten had accumulated on `main` before CI gained a `pnpm run check` step, one of which broke every request the front end made. That step runs before the image is built — keep it there.

**`tsconfig.json`'s `include` covers `client`, `server`, `shared` and `drizzle` only.** Root modules are typechecked only because included files import them. A new root file nothing imports is invisible to `tsc`.

**Deployment is Cloud Run in `australia-southeast1`, via `.github/workflows/deploy.yml` on push to `main`.** The site is served from its `run.app` URL. Firebase Hosting was tried and removed: its Cloud Run rewrite needs a paid plan, and `australia-southeast1` offers no Cloud Run domain mapping. A GoDaddy redirect provides a friendly link, which is why `APP_URL` and any webhook URL must stay the `run.app` host — a redirect drops the path and query string.

**GitHub's secrets page has a Secrets tab and a Variables tab.** The workflow reads `secrets.*`. Values added under Variables are invisible to it and look identical once saved. This has already silently cost a round of debugging.

**Deleting Artifact Registry images from CI does not work.** The deploy service account has no `artifactregistry.tags.delete`. Retention belongs in a repository cleanup policy, not a workflow step.

**`min-instances=0`**, so the first request after an idle period pays a cold start. Slow first load is expected, not a regression.

## Deployment environment

Sessions started from claude.ai run in a cloud container that cannot reach the deployed site — `run.app` is refused by the network policy — and has no `gcloud`, `firebase` or `wrangler`. Anything needing the live app or a cloud console has to happen on a local machine or be handed to the user. GitHub, however, is reachable: pushing, opening PRs, triggering workflows and reading job logs all work from here.
