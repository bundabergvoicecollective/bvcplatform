# Bundaberg Voice Collective — members' platform

The site members sign in to at
[members.bundabergvoicecollective.com.au](https://members.bundabergvoicecollective.com.au):
rehearsal sessions and attendance, the music library, documents, the gallery,
passes and shop payments through Square.

One Express process serves the API and the built client. React + Vite on the
front, tRPC and Drizzle against TiDB on the back, deployed to Cloud Run.
`CLAUDE.md` explains how the pieces fit and which of them have bitten before —
read it before changing anything structural.

## Getting set up

You need **Node 22 or newer** (production builds on `node:22-alpine`; 24 is
fine locally) and **pnpm 10**. The version of pnpm is pinned in
`package.json`, so let Corepack supply it rather than installing pnpm
globally:

```bash
git clone https://github.com/bundabergvoicecollective/bvcplatform.git
cd bvcplatform
corepack enable          # one-off; makes `pnpm` the version this repo pins
pnpm install             # the lockfile is authoritative (CI uses --frozen-lockfile)
cp .env.example .env     # then fill it in — see below
pnpm run dev             # http://localhost:3000
```

### Filling in `.env`

The server refuses to start without `DATABASE_URL` and `JWT_SECRET`, and names
whatever is missing. Everything else is optional: an unset secret disables its
feature and logs a `[Config]` line saying so, rather than stopping boot.

- **`DATABASE_URL`** — a MySQL-compatible database. There is no local
  equivalent in this repo and no Docker setup, so in practice this is a
  [TiDB Serverless](https://tidbcloud.com) cluster; the free tier is enough for
  development. Point it at your own cluster, never at the production one. The
  app issues `CREATE DATABASE IF NOT EXISTS bvc` on boot, so an empty cluster
  needs nothing else.
- **`JWT_SECRET`** — any random string: `openssl rand -hex 32`. Sessions are
  signed with it, so changing it signs everyone out.
- **`APP_URL`** — the origin for emailed password and invite links.
  `http://localhost:3000` locally. Required in production, because without it
  the links get built from the request's `Host` header.

Schema is not created by `pnpm run dev`. Tables arrive through the deploy
workflow, which runs `scripts/dbSchema.ts`; to create them in your own cluster,
run that script by hand — `CLAUDE.md` has the invocation, including the
report-only form.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm run dev` | `tsx watch` on the server, with Vite in middleware mode — API, client and HMR all on one port |
| `pnpm run check` | `tsc --noEmit`. **Run before every push** |
| `pnpm run build` | Vite build of the client plus an esbuild bundle of the server into `dist/` |
| `pnpm run start` | Runs the build; expects `NODE_ENV=production` |

There is no test suite. `vitest` is installed but nothing uses it, so
`pnpm run check` and a real build are the only automated signals — and the
build strips types without checking them, which is why `check` matters.

## Deployment

Pushing to `main` builds and deploys to Cloud Run in `australia-southeast1`
via `.github/workflows/deploy.yml`, which also applies schema changes. The
custom domain, and why it needs a Cloudflare Worker, is in
`docs/members-domain.md`. `docs/migration-status.md` records where the move
from the old site has got to.
