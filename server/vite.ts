/**
 * Vite dev-server integration (development) and static file serving (production).
 *
 * In development: mounts Vite's HMR middleware so the Express server also serves
 * the Vite dev build with hot-module replacement.
 *
 * In production: serves the pre-built client from `dist/public`.
 */
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import sirv from "sirv";
import type { Server } from "node:http";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const DIST_PUBLIC = path.join(ROOT, "dist", "public");

/** Mount Vite's dev middleware (development only). */
export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });
  app.use(vite.middlewares);
}

/** Serve pre-built static assets (production). */
export function serveStatic(app: Express): void {
  if (!fs.existsSync(DIST_PUBLIC)) {
    console.warn("[Static] dist/public not found — client not built yet.");
    return;
  }

  app.use(sirv(DIST_PUBLIC, { extensions: ["html"], single: true }));
}
