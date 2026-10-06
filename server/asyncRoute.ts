import type { Request, Response } from "express";

/**
 * Express 4 does not catch a rejection from an async handler, and Node exits
 * the process on an unhandled rejection — so one throwing request takes the
 * whole service down for everyone rather than failing just that request.
 * Wrap every async handler in this.
 */
export const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => {
    handler(req, res).catch((err) => {
      console.error(`[Route] ${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our end." });
    });
  };
