import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { verifySquareWebhook } from "../square";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./auth";
import { registerEmailCheck } from "./emailCheck";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "../_core/context";
import { serveStatic, setupVite } from "./vite";
import {
  assignPass,
  createNotification,
  createLibraryItem,
  createDocument,
  getActivePassForUser,
  getAllMembers,
  getPassOrderByStripeSession,
  topUpPass,
  updatePassOrderStatus,
  grantLiveStreamAccess,
  hasLiveStreamAccess,
  getLiveStreamById,
  notifyAllMembers,
  markShopOrderPaid,
  logActivity,
  markPassOrderReceiptSent,
  createSession,
  createRehearsalRecording,
} from "../db";
import { storagePut, storagePutStream } from "../storage";
import { notifyOwner } from "../_core/notification";
import { getRequestUser } from "../_core/auth-helper";
import { sendOnlinePassReceipt, shouldIssueOnlinePassReceipt } from "../passReceipt";
import { getDisplayName } from "@shared/const";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/** Ensure the `bvc` database exists before any Drizzle queries run. */
async function ensureDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  // Replace the target database with `sys` (always exists on TiDB/MySQL)
  const sysUrl = dbUrl.replace(/\/([^/?]+)(\?|$)/, "/sys$2");
  try {
    const { createConnection } = await import("mysql2/promise");
    const conn = await createConnection(sysUrl);
    await conn.execute("CREATE DATABASE IF NOT EXISTS `bvc`");
    await conn.end();
    console.log("[DB Init] Database `bvc` is ready");
  } catch (err) {
    // Non-fatal: if the DB already exists the app will work fine
    console.warn("[DB Init] Could not auto-create database (may already exist):", (err as Error).message);
  }
}

async function startServer() {
  await ensureDatabase();
  const app = express();
  const server = createServer(app);

  // ── Square webhook MUST be registered before express.json() ─────────────
  app.post(
    "/api/square/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.headers["x-square-hmacsha256-signature"] as string ?? "";
      const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "";
      const notificationUrl = process.env.SQUARE_WEBHOOK_URL ?? `${req.protocol}://${req.get("host")}/api/square/webhook`;
      const body = req.body as Buffer;
      const bodyStr = body.toString("utf8");

      // Verify signature if key is configured
      if (signatureKey) {
        const valid = await verifySquareWebhook(bodyStr, signature, signatureKey, notificationUrl);
        if (!valid) {
          console.warn("[Square Webhook] Invalid signature — rejecting");
          return res.status(400).json({ error: "Invalid signature" });
        }
      }

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(bodyStr);
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const eventType = event.type as string;
      console.log(`[Square Webhook] Received event: ${eventType}`);

      // Handle payment completion
      if (eventType === "payment.completed" || eventType === "order.fulfillment.updated") {
        try {
          const data = (event.data as Record<string, unknown>)?.object as Record<string, unknown> ?? {};
          const payment = (data.payment ?? data) as Record<string, unknown>;
          const orderId = (payment.order_id ?? payment.orderId) as string | undefined;
          const note = (payment.note ?? "") as string;

          // Parse metadata from note field: key:value|key:value
          const meta: Record<string, string> = {};
          note.split("|").forEach((part) => {
            const [k, v] = part.split(":");
            if (k && v !== undefined) meta[k.trim()] = v.trim();
          });

          const userId = parseInt(meta["user_id"] ?? "0", 10);
          if (!userId) {
            console.warn("[Square Webhook] No user_id in note metadata, skipping");
            return res.json({ received: true });
          }

          const purchaseType = meta["purchase_type"] ?? "pass";

          // ── Shop order ──────────────────────────────────────────────────
          if (purchaseType === "shop_order") {
            if (orderId) await markShopOrderPaid(orderId);
            console.log(`[Square Webhook] Shop order paid: user ${userId}, order ${orderId}`);
            return res.json({ received: true });
          }

          // ── Live stream single access ────────────────────────────────────
          const grantStreamAccess = meta["grant_stream_access"] === "1";
          const streamId = parseInt(meta["stream_id"] ?? "0", 10);
          if (grantStreamAccess && streamId && purchaseType === "live_stream_access") {
            try {
              const alreadyHas = await hasLiveStreamAccess(streamId, userId);
              if (!alreadyHas) {
                await grantLiveStreamAccess({
                  streamId,
                  userId,
                  accessType: "single_purchase",
                  stripeSessionId: orderId ?? "",
                });
              }
              await createNotification({
                userId,
                type: "general",
                title: "Live Stream Access Granted",
                message: "Your payment was successful. You now have access to the live stream.",
              });
              const stream = await getLiveStreamById(streamId);
              await notifyOwner({
                title: `Live Stream Purchase: User #${userId}`,
                content: `User #${userId} has purchased single-session access to "${stream?.title ?? `Stream #${streamId}`}".`,
              }).catch((e) => console.warn("[Square Webhook] notifyOwner failed:", e));
            } catch (err) {
              console.error("[Square Webhook] Error granting live stream access:", err);
            }
            return res.json({ received: true });
          }

          // ── Pass purchase ────────────────────────────────────────────────
          const passProductKey = meta["pass_product_key"] ?? "10-pass";
          const sessionCount = parseInt(meta["session_count"] ?? "10", 10);

          const order = orderId ? await getPassOrderByStripeSession(orderId) : null;
          if (order && order.status !== "paid") {
            const existingPass = await getActivePassForUser(userId);
            let finalPass;
            if (existingPass) {
              finalPass = await topUpPass(existingPass.id, sessionCount);
              console.log(`[Square Webhook] Topped up pass for user ${userId} by ${sessionCount} sessions`);
            } else {
              finalPass = await assignPass({
                userId,
                totalSessions: sessionCount,
                assignedBy: 0,
                notes: `Purchased via Square — ${passProductKey}`,
              });
              console.log(`[Square Webhook] New pass assigned for user ${userId}, sessions: ${sessionCount}`);
            }
            if (orderId) {
              await updatePassOrderStatus(orderId, "paid", { passId: finalPass?.id });
            }
            const newBalance = finalPass?.remainingSessions ?? sessionCount;
            const wasTopUp = !!existingPass;

            // Also grant stream access if purchased from live stream page
            if (grantStreamAccess && streamId) {
              try {
                const alreadyHas = await hasLiveStreamAccess(streamId, userId);
                if (!alreadyHas) {
                  await grantLiveStreamAccess({
                    streamId,
                    userId,
                    accessType: "single_purchase",
                    stripeSessionId: orderId ?? "",
                  });
                }
              } catch (err) {
                console.error("[Square Webhook] Error granting stream access alongside pass:", err);
              }
            }

            await createNotification({
              userId,
              type: "general",
              title: wasTopUp ? "Pass Topped Up" : "Pass Activated",
              message: wasTopUp
                ? `Your pass has been topped up by ${sessionCount} sessions. You now have ${newBalance} sessions remaining.`
                : `Your ${passProductKey} (${sessionCount} sessions) has been activated. Enjoy your rehearsals!`,
            });

            const members = await getAllMembers();
            const member = members.find((m) => m.id === userId);
            const memberName = member ? getDisplayName(member) : `Member #${userId}`;
            const adminMsg = wasTopUp
              ? `${memberName} topped up their pass by ${sessionCount} sessions (now ${newBalance} remaining).`
              : `${memberName} purchased a ${passProductKey} (${sessionCount} sessions) via Square.`;
            await notifyOwner({
              title: wasTopUp ? `Pass Top-Up: ${memberName}` : `New Pass Purchase: ${memberName}`,
              content: adminMsg,
            }).catch((e) => console.warn("[Square Webhook] notifyOwner failed:", e));

            // Audit log: online pass purchase
            const oldBalance = existingPass?.remainingSessions ?? 0;
            await logActivity({
              userId,
              actorId: null,
              action: "pass_online_purchase",
              detail: wasTopUp
                ? `Online top-up: +${sessionCount} sessions via Square (${passProductKey}). Balance: ${oldBalance} → ${newBalance}.`
                : `Online pass purchase: ${passProductKey} (${sessionCount} sessions) via Square. Balance: 0 → ${newBalance}.`,
              balanceBefore: wasTopUp ? oldBalance : 0,
              balanceAfter: newBalance,
            }).catch(() => {});

            const paidOrder = { ...order, status: "paid" as const };
            if (member?.email && shouldIssueOnlinePassReceipt(paidOrder)) {
              const receiptSent = await sendOnlinePassReceipt({
                to: member.email,
                memberName,
                passType: order.passType,
                sessionCount: order.sessionCount,
                amountCents: order.amountCents,
                currency: order.currency,
                paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? orderId ?? `BVC-${order.id}`,
                purchasedAt: new Date(),
              });
              if (receiptSent) await markPassOrderReceiptSent(order.id);
            }
          }
        } catch (err) {
          console.error("[Square Webhook] Error processing event:", err);
        }
      }

      res.json({ received: true });
    }
  );

  // ── Standard middleware ────────────────────────────────────────────────────
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerAuthRoutes(app);
  registerEmailCheck(app);

  // ── Multipart upload: Music Library ──────────────────────────────────────
  const memUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  });

  const recordingUploadDir = path.join("/tmp", "bvc-recording-uploads");
  fs.mkdirSync(recordingUploadDir, { recursive: true });
  const recordingUpload = multer({
    storage: multer.diskStorage({
      destination: recordingUploadDir,
      filename: (_req, file, callback) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        callback(null, `${crypto.randomUUID()}-${safeName}`);
      },
    }),
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  });

  const recordingChunkUpload = multer({
    storage: multer.diskStorage({
      destination: recordingUploadDir,
      filename: (_req, _file, callback) => callback(null, `chunk-${crypto.randomUUID()}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  type RecordingUploadSession = {
    userId: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
    totalChunks: number;
    sessionId?: number;
    customSessionTitle?: string;
    customSessionDate?: string;
    title: string;
    description?: string;
    chunkPaths: Array<string | undefined>;
    createdAt: number;
  };
  const recordingUploadSessions = new Map<string, RecordingUploadSession>();
  const recordingChunkDir = path.join(recordingUploadDir, "chunks");
  fs.mkdirSync(recordingChunkDir, { recursive: true });

  const cleanUpRecordingChunks = async (upload: RecordingUploadSession) => {
    await Promise.all(
      upload.chunkPaths.filter(Boolean).map((chunkPath) =>
        fs.promises.unlink(chunkPath!).catch(() => undefined)
      )
    );
  };

  const expireRecordingUploadSessions = () => {
    const expiry = Date.now() - 60 * 60 * 1000;
    for (const [uploadId, upload] of Array.from(recordingUploadSessions.entries())) {
      if (upload.createdAt >= expiry) continue;
      recordingUploadSessions.delete(uploadId);
      void cleanUpRecordingChunks(upload);
    }
  };

  // Express 4 does not catch a rejection from an async handler, and Node exits
  // the process on an unhandled rejection — so one throwing request takes the
  // whole service down for everyone, rather than failing just that request.
  // Wrap any async handler in this.
  const asyncRoute =
    (handler: (req: express.Request, res: express.Response) => Promise<unknown>) =>
    (req: express.Request, res: express.Response) => {
      handler(req, res).catch((err) => {
        console.error(`[Route] ${req.method} ${req.path} failed:`, err);
        if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our end." });
      });
    };

  const getRecordingUploadAdmin = async (req: express.Request, res: express.Response) => {
    const user = await getRequestUser(req);
    if (!user) {
      res.status(401).json({ error: "Please sign in before uploading a recording" });
      return null;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin only" });
      return null;
    }
    return user;
  };

  const streamRecordingChunks = async function* (chunkPaths: string[]) {
    for (const chunkPath of chunkPaths) {
      for await (const chunk of fs.createReadStream(chunkPath)) yield chunk;
    }
  };

  app.post("/api/upload/recording/init", asyncRoute(async (req, res) => {
    const user = await getRecordingUploadAdmin(req, res);
    if (!user) return;
    expireRecordingUploadSessions();
    const body = req.body as Record<string, unknown>;
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const customSessionTitle = typeof body.customSessionTitle === "string" ? body.customSessionTitle.trim() : "";
    const customSessionDate = typeof body.customSessionDate === "string" ? body.customSessionDate : "";
    const sessionId = Number(body.sessionId);
    const fileSize = Number(body.fileSize);
    const totalChunks = Number(body.totalChunks);
    if (!fileName || !title || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 500 * 1024 * 1024) {
      return res.status(400).json({ error: "Recording title and a file up to 500 MB are required" });
    }
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 300) {
      return res.status(400).json({ error: "The recording could not be split into a valid upload sequence" });
    }
    if ((!Number.isInteger(sessionId) || sessionId <= 0) && (!customSessionTitle || !customSessionDate)) {
      return res.status(400).json({ error: "Select a rehearsal session or enter a custom session title and date" });
    }
    const uploadId = crypto.randomUUID();
    recordingUploadSessions.set(uploadId, {
      userId: user.id,
      fileName,
      mimeType,
      fileSize,
      totalChunks,
      sessionId: Number.isInteger(sessionId) && sessionId > 0 ? sessionId : undefined,
      customSessionTitle: customSessionTitle || undefined,
      customSessionDate: customSessionDate || undefined,
      title,
      description: description || undefined,
      chunkPaths: Array.from({ length: totalChunks }),
      createdAt: Date.now(),
    });
    return res.status(201).json({ uploadId });
  }));

  app.post("/api/upload/recording/chunk", recordingChunkUpload.single("chunk"), async (req, res) => {
    const temporaryFilePath = req.file?.path;
    try {
      const user = await getRecordingUploadAdmin(req, res);
      if (!user) return;
      const uploadId = typeof req.body.uploadId === "string" ? req.body.uploadId : "";
      const chunkIndex = Number(req.body.chunkIndex);
      const upload = recordingUploadSessions.get(uploadId);
      if (!upload || upload.userId !== user.id) {
        return res.status(404).json({ error: "This recording upload has expired. Please start again." });
      }
      if (!req.file || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= upload.totalChunks) {
        return res.status(400).json({ error: "The recording chunk was invalid" });
      }
      const chunkPath = path.join(recordingChunkDir, `${uploadId}-${chunkIndex}.part`);
      await fs.promises.rename(req.file.path, chunkPath);
      upload.chunkPaths[chunkIndex] = chunkPath;
      return res.status(201).json({ received: chunkIndex + 1, totalChunks: upload.totalChunks });
    } catch (error) {
      console.error("[Upload/Recording] Chunk save failed", error);
      return res.status(500).json({ error: "The recording chunk could not be saved. Please retry the upload." });
    } finally {
      if (temporaryFilePath) await fs.promises.unlink(temporaryFilePath).catch(() => undefined);
    }
  });

  app.post("/api/upload/recording/complete", asyncRoute(async (req, res) => {
    const uploadReference = `recording-${crypto.randomUUID().slice(0, 8)}`;
    res.setHeader("X-Upload-Reference", uploadReference);
    const user = await getRecordingUploadAdmin(req, res);
    if (!user) return;
    const uploadId = typeof req.body?.uploadId === "string" ? req.body.uploadId : "";
    const upload = recordingUploadSessions.get(uploadId);
    if (!upload || upload.userId !== user.id) {
      return res.status(404).json({ error: "This recording upload has expired. Please start again.", reference: uploadReference });
    }
    if (upload.chunkPaths.some((chunkPath) => !chunkPath)) {
      return res.status(400).json({ error: "Not all recording chunks were received. Please retry the upload.", reference: uploadReference });
    }
    try {
      let sessionId = upload.sessionId;
      if (!sessionId) {
        const sessionDate = new Date(`${upload.customSessionDate}T12:00:00`);
        if (Number.isNaN(sessionDate.getTime())) throw new Error("Custom session date is invalid");
        const customSession = await createSession({
          title: upload.customSessionTitle!,
          sessionDate,
          notes: "Created while uploading a rehearsal recording.",
          createdBy: user.id,
        });
        if (!customSession?.id) throw new Error("Could not create the custom rehearsal session");
        sessionId = customSession.id;
      }
      const safeFileName = upload.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `rehearsal-recordings/${sessionId}-${Date.now()}-${safeFileName}`;
      const { url } = await storagePutStream(
        fileKey,
        Readable.from(streamRecordingChunks(upload.chunkPaths as string[])),
        upload.mimeType,
        upload.fileSize,
      );
      const recording = await createRehearsalRecording({
        sessionId,
        title: upload.title,
        description: upload.description,
        fileKey,
        fileUrl: url,
        uploadedBy: user.id,
      });
      if (!recording?.id || !recording.fileUrl) throw new Error("Recording metadata could not be verified");
      recordingUploadSessions.delete(uploadId);
      await cleanUpRecordingChunks(upload);
      return res.status(201).json({ recording });
    } catch (error) {
      console.error(`[Upload/Recording:${uploadReference}] Chunked finalisation failed`, error);
      return res.status(500).json({
        error: "The recording could not be saved after upload.",
        detail: error instanceof Error ? error.message : undefined,
        reference: uploadReference,
      });
    }
  }));

  app.post("/api/upload/library", memUpload.single("file"), async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorised" });
      if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const { title, artist, type } = req.body as { title?: string; artist?: string; type?: string };
      if (!title) return res.status(400).json({ error: "Title is required" });
      if (type !== "sheet_music" && type !== "backing_track")
        return res.status(400).json({ error: "Invalid type" });

      const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `library/${Date.now()}_${safeFileName}`;
      const { url } = await storagePut(fileKey, file.buffer, file.mimetype);

      const item = await createLibraryItem({
        title,
        artist: artist || undefined,
        type: type as "sheet_music" | "backing_track",
        fileKey,
        fileUrl: url,
        fileName: file.originalname,
        mimeType: file.mimetype,
        uploadedBy: user.id,
      });

      notifyAllMembers({
        type: "library",
        title: `New music added: ${title}`,
        message: `${type === "sheet_music" ? "Sheet music" : "Backing track"}${artist ? ` by ${artist}` : ""} has been added to the music library.`,
        excludeUserId: user.id,
      });

      return res.json(item);
    } catch (err: any) {
      console.error("[Upload/Library]", err);
      return res.status(500).json({ error: err.message ?? "Upload failed" });
    }
  });

  app.post(
    "/api/upload/recording",
    recordingUpload.single("file"),
    (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "This recording is larger than the 500 MB upload limit." });
      }
      console.error("[Upload/Recording] Multipart upload error", err);
      return res.status(400).json({ error: "The recording file could not be received. Please try again." });
    },
    async (req: express.Request, res: express.Response) => {
      const temporaryFilePath = req.file?.path;
      const uploadReference = `recording-${crypto.randomUUID().slice(0, 8)}`;
      res.setHeader("X-Upload-Reference", uploadReference);
      try {
        const user = await getRequestUser(req);
        if (!user) return res.status(401).json({ error: "Please sign in before uploading a recording" });
        if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });

        const file = req.file;
        if (!file) return res.status(400).json({ error: "No recording file provided" });

        const { sessionId: rawSessionId, customSessionTitle, customSessionDate, title, description, durationSeconds } =
          req.body as Record<string, string | undefined>;
        if (!title?.trim()) return res.status(400).json({ error: "Recording title is required" });

        let sessionId = Number.parseInt(rawSessionId ?? "", 10);
        if (!Number.isInteger(sessionId) || sessionId <= 0) {
          if (!customSessionTitle?.trim() || !customSessionDate) {
            return res.status(400).json({ error: "Select a rehearsal session or enter a custom session title and date" });
          }
          const sessionDate = new Date(`${customSessionDate}T12:00:00`);
          if (Number.isNaN(sessionDate.getTime())) return res.status(400).json({ error: "Custom session date is invalid" });
          const customSession = await createSession({
            title: customSessionTitle.trim().slice(0, 255),
            sessionDate,
            notes: "Created while uploading a rehearsal recording.",
            createdBy: user.id,
          });
          if (!customSession?.id) throw new Error("Could not create the custom rehearsal session");
          sessionId = customSession.id;
        }

        const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileKey = `rehearsal-recordings/${sessionId}-${Date.now()}-${safeFileName}`;
        const { url } = await storagePutStream(
          fileKey,
          fs.createReadStream(file.path),
          file.mimetype || "application/octet-stream",
          file.size,
        );
        const parsedDuration = Number.parseInt(durationSeconds ?? "", 10);
        const recording = await createRehearsalRecording({
          sessionId,
          title: title.trim().slice(0, 255),
          description: description?.trim() || undefined,
          fileKey,
          fileUrl: url,
          durationSeconds: Number.isInteger(parsedDuration) && parsedDuration > 0 ? parsedDuration : undefined,
          uploadedBy: user.id,
        });
        if (!recording?.id || !recording.fileUrl) {
          throw new Error("Recording storage completed but metadata could not be verified");
        }

        return res.status(201).json({ recording });
      } catch (err: any) {
        console.error(`[Upload/Recording:${uploadReference}]`, err);
        return res.status(500).json({
          error: "The recording could not be saved.",
          detail: err instanceof Error ? err.message : undefined,
          reference: uploadReference,
        });
      } finally {
        if (temporaryFilePath) {
          await fs.promises.unlink(temporaryFilePath).catch(() => undefined);
        }
      }
    }
  );

  app.post("/api/upload/document", memUpload.single("file"), async (req, res) => {
    try {
      const user = await getRequestUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorised" });
      if (user.role !== "admin") return res.status(403).json({ error: "Admin only" });

      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const { title, description } = req.body as { title?: string; description?: string };
      if (!title) return res.status(400).json({ error: "Title is required" });

      const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `documents/${Date.now()}-${safeFileName}`;
      const { key: storedKey, url } = await storagePut(fileKey, file.buffer, file.mimetype);

      const doc = await createDocument({
        title,
        description: description || undefined,
        fileKey: storedKey,
        fileUrl: url,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        uploadedBy: user.id,
      });

      notifyAllMembers({
        type: "document",
        title: `New document: ${title}`,
        message: description
          ? description.length > 120 ? description.slice(0, 120) + "…" : description
          : `A new document has been added to Forms & Documents.`,
        excludeUserId: user.id,
      });

      return res.json(doc);
    } catch (err: any) {
      console.error("[Upload/Document]", err);
      return res.status(500).json({ error: err.message ?? "Upload failed" });
    }
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
