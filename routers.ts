import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "./_core/env";
import { createSquarePaymentLink, getSquareOrderStatus } from "./_core/square";
import { COOKIE_NAME, getDisplayName } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  assignPass,
  createAnnouncement,
  createEvent,
  createGroup,
  createLibraryItem,
  createNotification,
  notifyAllMembers,
  createPassOrder,
  createSession,
  deductPassSession,
  deleteAnnouncement,
  deleteEvent,
  deleteGroup,
  deleteLibraryItem,
  updateLibraryItem,
  deleteSession,
  acceptGroupInvite,
  getAllMembers,
  getAllNotifications,
  getAllPassesForUser,
  getAllPassOrders,
  getMonthlyOnlinePassSalesSummary,
  getActivePassForUser,
  getAdminStats,
  getAttendanceForSession,
  getAttendanceForUser,
  getConversation,
  getConversationList,
  getGroupById,
  getGroupMembers,
  getGroupMembership,
  getGroupMessages,
  getPassOrderByStripeSession,
  getPassOrdersForUser,
  getReadAnnouncementIds,
  getUnreadMessageCount,
  getUnreadConversationPreviews,
  getUnreadNotifications,
  getUserGroups,
  getUserPendingInvites,
  inviteToGroup,
  listAnnouncements,
  listEvents,
  listGroups,
  listLibraryItems,
  listSessions,
  markAllNotificationsRead,
  markAnnouncementRead,
  markMessagesRead,
  markNotificationRead,
  removeGroupMember,
  requestJoinGroup,
  respondToGroupRequest,
  sendDirectMessage,
  sendGroupMessage,
  topUpPass,
  restorePassSession,
  updateAnnouncement,
  updateEvent,
  updateGroup,
  updatePassOrderStatus,
  updateUserRole,
  updateUserStatus,
  getPendingMembers,
  upsertAttendance,
  registerLiveStreamAttendance,
  getMembersForDM,
  getAdminUsers,
  upsertEventRsvp,
  getEventRsvp,
  getEventRsvpCounts,
  getEventRsvpList,
  deleteUser,
  getFinancialMembers,
  getLastSessionStats,
  getSessionStats,
  createManualMember,
  recordCashPayment,
  updateUserProfile,
  listLiveStreams,
  getLiveStreamById,
  createLiveStream,
  updateLiveStream,
  deleteLiveStream,
  getLiveStreamAccessForUser,
  getLiveStreamAccessForStream,
  hasLiveStreamAccess,
  grantLiveStreamAccess,
  getLiveStreamAccessByStripeSession,
  setLiveStreamRecordingUrl,
  getRecordingAccessStatus,
  grantRecordingAccessWithPass,
  getRecordingAccessList,
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  createInviteToken,
  getInviteByToken,
  markInviteUsed,
  markInviteEmailVerified,
  saveInviteOtp,
  listInvites,
  createGroupConversation,
  getGroupConversationsForUser,
  getGroupConversationMessages,
  sendGroupConversationMessage,
  isConversationParticipant,
  getAttendanceHistoryForUser,
  addGroupMemberDirectly,
  listShopProducts,
  getShopProductWithVariants,
  createShopProduct,
  updateShopProduct,
  deleteShopProduct,
  setShopProductVariants,
  createShopOrder,
  markShopOrderPaid,
  getShopOrdersByUser,
  getAllShopOrders,
  listAllRehearsalRecordings,
  listAccessibleRehearsalRecordings,
  createRehearsalRecording,
  deleteRehearsalRecording,
  getAnnouncementViewers,
  getAnnouncementViewCount,
  deletePassById,
  getExpiredPasses,
  getLowPasses,
  getLastSessionIncome,
  createGalleryPost,
  insertGalleryMedia,
  listApprovedGalleryPosts,
  listPendingGalleryPosts,
  listMyPendingGalleryPosts,
  updateGalleryPostStatus,
  deleteGalleryPost,
  getGalleryPost,
  upsertGalleryReaction,
  addGalleryComment,
  listGalleryComments,
  deleteGalleryComment,
  getGalleryComment,
  logActivity,
  markPassOrderReceiptSent,
  getActivityLogForUser,
  getGlobalActivityLog,
} from "./db";
import { storagePrepareUpload, storagePut } from "./storage";
import { notifyOwner } from "./_core/notification";
import { PASS_PRODUCTS, PassProductKey } from "./products";
import { sendOnlinePassReceipt, shouldIssueOnlinePassReceipt } from "./passReceipt";
import { savePushSubscription, deletePushSubscription, sendPushToAll } from "./webPush";

// Square is used for payments (see server/_core/square.ts)

// ─── Admin guard ──────────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

const coreRouter = router({
  system: systemRouter,

  // ─── Auth ──────────────────────────────────────────────────────────────────
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Members ───────────────────────────────────────────────────────────────
  members: router({
    list: adminProcedure.query(() => getAllMembers()),
    listAll: protectedProcedure.query(() => getAllMembers()), // for messaging
    updateRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.enum(["user", "admin"]) }))
      .mutation(async ({ input, ctx }) => {
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own role." });
        }
        await updateUserRole(input.userId, input.role);
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: "role_changed",
          detail: `Role changed to '${input.role}' by admin.`,
        }).catch(() => {});
        return { success: true };
      }),
    listPending: adminProcedure.query(() => getPendingMembers()),
    approve: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        await updateUserStatus(input.userId, "active");
        return { success: true };
      }),
    deny: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        await updateUserStatus(input.userId, "denied");
        return { success: true };
      }),
    delete: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account." });
        }
        // Log before deletion so the record exists
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: "member_deleted",
          detail: `Member account deleted by admin.`,
        }).catch(() => {});
        await deleteUser(input.userId);
        return { success: true };
      }),
    financialMembers: adminProcedure.query(() => getFinancialMembers()),
    // Member: update own profile fields
    updateProfile: protectedProcedure
      .input(
        z.object({
          firstName: z.string().max(128).optional(),
          lastName: z.string().max(128).optional(),
          phone: z.string().max(32).optional(),
          address: z.string().optional(),
          dateOfBirth: z.string().max(16).optional(),
          allergens: z.string().optional(),
          avatarUrl: z.string().optional(),
          voicePart: z.enum(["soprano1", "soprano2", "altoHigh", "altoLow", "tenor", "bass"]).optional(),
          singingExperience: z.enum(["beginner", "some_experience", "intermediate", "advanced", "professional"]).optional().nullable(),
        })
      )
      .mutation(({ input, ctx }) => updateUserProfile(ctx.user.id, input as Parameters<typeof updateUserProfile>[1])),
    // Member: upload their own avatar
    uploadAvatar: protectedProcedure
      .input(
        z.object({
          base64: z.string(),
          mimeType: z.string().default("image/jpeg"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const ext = input.mimeType.split("/")[1] ?? "jpg";
        const fileKey = `avatars/user-${ctx.user.id}-${Date.now()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        await updateUserProfile(ctx.user.id, { avatarUrl: url });
        return { avatarUrl: url };
      }),
    // Admin: update any member's profile
    adminUpdateProfile: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          firstName: z.string().max(128).optional(),
          lastName: z.string().max(128).optional(),
          phone: z.string().max(32).optional(),
          address: z.string().optional(),
          dateOfBirth: z.string().max(16).optional(),
          allergens: z.string().optional(),
          avatarUrl: z.string().optional(),
          voicePart: z.enum(["soprano1", "soprano2", "altoHigh", "altoLow", "tenor", "bass"]).optional(),
          memberSince: z.string().max(7).optional().nullable(),
          singingExperience: z.enum(["beginner", "some_experience", "intermediate", "advanced", "professional"]).optional().nullable(),
        })
      )
      .mutation(({ input }) => {
        const { userId, ...fields } = input;
        return updateUserProfile(userId, fields as Parameters<typeof updateUserProfile>[1]);
      }),
    // Admin: upload avatar on behalf of any member
    adminUploadAvatar: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          base64: z.string(),
          mimeType: z.string().default("image/jpeg"),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, "base64");
        const ext = input.mimeType.split("/")[1] ?? "jpg";
        const fileKey = `avatars/user-${input.userId}-${Date.now()}.${ext}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        await updateUserProfile(input.userId, { avatarUrl: url });
        return { avatarUrl: url };
      }),
    // Admin: manually create a member account (no OAuth required)
    create: adminProcedure
      .input(
        z.object({
          firstName: z.string().min(1, "First name is required"),
          lastName: z.string().min(1, "Last name is required"),
          email: z.string().email("Valid email required"),
          phone: z.string().max(32).optional(),
          address: z.string().optional(),
          dateOfBirth: z.string().max(16).optional(),
          allergens: z.string().optional(),
          voicePart: z.enum(["soprano1", "soprano2", "altoHigh", "altoLow", "tenor", "bass"]).optional(),
          singingExperience: z.enum(["beginner", "some_experience", "intermediate", "advanced", "professional"]).optional(),
          role: z.enum(["user", "admin"]).default("user"),
        })
      )
      .mutation(({ input }) =>
        createManualMember({
          name: `${input.firstName} ${input.lastName}`.trim(),
          email: input.email,
          role: input.role,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          address: input.address,
          dateOfBirth: input.dateOfBirth,
          allergens: input.allergens,
          voicePart: input.voicePart,
          singingExperience: input.singingExperience,
        })
      ),
    // Admin: record a cash/manual payment or complimentary pass and assign the pass
    recordCashPayment: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          passType: z.enum(["10-pass", "5-pass", "single", "10-pass-comp", "5-pass-comp", "single-comp", "custom-carryover"]),
          customSessionCount: z.number().int().min(0).max(100).optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const product = PASS_PRODUCTS[input.passType as keyof typeof PASS_PRODUCTS];
        const isComp = input.passType.endsWith("-comp") || input.passType === "custom-carryover";
        const sessionCount = input.passType === "custom-carryover"
          ? (input.customSessionCount ?? 1)
          : product.sessionCount;
        const result = await recordCashPayment({
          userId: input.userId,
          passType: input.passType,
          sessionCount,
          amountCents: product.amountCents,
          adminId: ctx.user.id,
          notes: input.notes,
          paymentMethod: isComp ? "complimentary" : "cash",
        });

        // ── Notifications for complimentary / free session grants ──────────
        if (isComp) {
          const sessionWord = sessionCount === 1 ? "session" : "sessions";
          const passLabel = input.passType === "custom-carryover"
            ? `${sessionCount} carry-over ${sessionWord}`
            : product.name ?? `${sessionCount} complimentary ${sessionWord}`;

          // In-app notification
          await createNotification({
            userId: input.userId,
            type: "general",
            title: "🎁 Free Session Granted",
            message: `The admin has gifted you ${sessionCount} free ${sessionWord} (${passLabel}). Your pass balance has been updated. Enjoy your rehearsals!`,
          }).catch((e) => console.warn("[recordCashPayment] in-app notification failed:", e));

          // Email notification
          try {
            const members = await getAllMembers();
            const member = members.find((m) => m.id === input.userId);
            if (member?.email) {
              const { sendEmail } = await import("./email");
              const subject = `🎁 You've been gifted ${sessionCount} free ${sessionWord} — Bundaberg Voice Collective`;
              const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e1a2b;padding:32px 40px;text-align:center;">
          <p style="margin:0;color:#c9922a;font-size:22px;font-weight:bold;letter-spacing:1px;">Bundaberg Voice Collective</p>
        </td></tr>
        <tr><td style="padding:40px 40px 32px;">
          <h1 style="margin:0 0 16px;font-size:24px;color:#0e1a2b;font-weight:bold;">🎁 You've received a free session!</h1>
          <p style="margin:0 0 16px;font-size:16px;color:#444;line-height:1.6;">
            Hi ${member.name ?? "there"},
          </p>
          <p style="margin:0 0 16px;font-size:16px;color:#444;line-height:1.6;">
            Great news! The admin has gifted you <strong>${sessionCount} free ${sessionWord}</strong> (${passLabel}).
            Your pass balance has been updated and the sessions are ready to use.
          </p>
          ${input.notes ? `<p style="margin:0 0 16px;font-size:15px;color:#555;line-height:1.6;font-style:italic;">Note from admin: ${input.notes}</p>` : ""}
          <p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">
            Log in to the BVC app to see your updated balance and book your next rehearsal.
          </p>
          <p style="margin:0;font-size:15px;color:#2a8a7a;">See you at rehearsal! 🎶</p>
        </td></tr>
        <tr><td style="background:#f9f9f7;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#bbb;">Bundaberg Voice Collective &mdash; Bundaberg, QLD, Australia</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
              const text = `Hi ${member.name ?? "there"},\n\nThe admin has gifted you ${sessionCount} free ${sessionWord} (${passLabel}). Your pass balance has been updated.\n${input.notes ? `\nNote from admin: ${input.notes}\n` : ""}\nLog in to the BVC app to see your updated balance.\n\nSee you at rehearsal!\n— Bundaberg Voice Collective`;
              await sendEmail({ to: member.email, subject, html, text })
                .catch((e) => console.warn("[recordCashPayment] email notification failed:", e));
            }
          } catch (e) {
            console.warn("[recordCashPayment] email lookup failed:", e);
          }
        }

        // Audit log: cash payment or comp grant
        const passAction = isComp ? "comp_granted" : "cash_payment";
        const passDetail = isComp
          ? `Admin granted ${sessionCount} complimentary session${sessionCount === 1 ? "" : "s"} (${input.passType}).${input.notes ? ` Note: ${input.notes}` : ""}`
          : `Admin recorded cash payment: ${sessionCount} session${sessionCount === 1 ? "" : "s"} (${input.passType}).${input.notes ? ` Note: ${input.notes}` : ""}`;
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: passAction,
          detail: passDetail,
        }).catch(() => {});

        return result;
      }),
    // Admin: view activity log for a member
    activityLog: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getActivityLogForUser(input.userId)),
    // Admin: global activity feed across all members
    globalActivityLog: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(1000).default(500) }).optional())
      .query(({ input }) => getGlobalActivityLog(input?.limit ?? 500)),
  }),

  // ─── Sessions ──────────────────────────────────────────────────────────────
  sessions: router({
    list: protectedProcedure.query(() => listSessions()),
    create: adminProcedure
      .input(
        z.object({
          title: z.string().min(1),
          sessionDate: z.date(),
          notes: z.string().optional(),
        })
      )
      .mutation(({ input, ctx }) =>
        createSession({ ...input, createdBy: ctx.user.id })
      ),
    delete: adminProcedure
      .input(z.object({ sessionId: z.number() }))
      .mutation(({ input }) => deleteSession(input.sessionId)),
  }),

  // ─── Attendance ─────────────────────────────────────────────────────────────
  attendance: router({
    forSession: adminProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(({ input }) => getAttendanceForSession(input.sessionId)),

    forUser: protectedProcedure
      .input(z.object({ userId: z.number().optional() }))
      .query(({ input, ctx }) => {
        const targetId = input.userId ?? ctx.user.id;
        if (ctx.user.role !== "admin" && targetId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return getAttendanceForUser(targetId);
      }),

    mark: adminProcedure
      .input(
        z.object({
          sessionId: z.number(),
          userId: z.number(),
          attended: z.boolean(),
          // complimentary: true means mark as attended but do NOT deduct from pass
          complimentary: z.boolean().default(false),
          // isSingleSession: true means member has no pass — record as 'single' type
          isSingleSession: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const existing = await getAttendanceForSession(input.sessionId);
        const prev = existing.find((r) => r.userId === input.userId);
        const wasAttended = prev?.attended ?? false;
        const wasPassUsed = prev?.passUsed ?? false;
        const wasComplimentary = prev?.sessionType === "complimentary";

        // Determine session type
        let sessionType: "pass" | "single" | "complimentary" | "online";
        if (!input.attended) {
          // Unmarking — keep previous type or default to pass
          sessionType = (prev?.sessionType as "pass" | "single" | "complimentary" | "online") ?? "pass";
        } else if (wasAttended && prev?.sessionType === "online") {
          // Preserve online attendance as non-deducting if an admin re-saves it.
          sessionType = "online";
        } else if (input.complimentary) {
          sessionType = "complimentary";
        } else {
          const activePass = await getActivePassForUser(input.userId);
          const hasPass = activePass && activePass.remainingSessions > 0;
          sessionType = hasPass ? "pass" : "single";
        }

        const activePass = await getActivePassForUser(input.userId);
        const hasPass = activePass && activePass.remainingSessions > 0;

        const record = await upsertAttendance(
          input.sessionId,
          input.userId,
          input.attended,
          input.attended && !!hasPass && sessionType === "pass", // passUsed only for pass type
          sessionType
        );

        // Auto-deduct: deduct when newly marking attended AND member has a pass AND not complimentary
        const shouldDeduct = input.attended && !!hasPass && !wasPassUsed && sessionType === "pass";
        // Restore: if un-marking attendance and a pass was previously used (not complimentary)
        const shouldRestore = wasPassUsed && !input.attended && !wasComplimentary;
        // Restore if switching FROM pass TO complimentary on an already-attended record
        const switchToComp = input.attended && wasPassUsed && input.complimentary;
        // Restore if switching FROM complimentary TO pass on an already-attended record
        const switchFromComp = input.attended && wasComplimentary && !input.complimentary && !!hasPass;

        if (shouldDeduct) {
          const balanceBefore = activePass?.remainingSessions ?? null;
          const { newBalance } = await deductPassSession(input.userId);
          // Audit log: session deducted
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: "attendance_marked",
            detail: `Marked attended (pass deducted). Balance: ${balanceBefore} → ${newBalance}.`,
            balanceBefore,
            balanceAfter: newBalance,
          }).catch(() => {});

          // Fetch member name for admin notifications
          const allMembers = await getAllMembers();
          const member = allMembers.find((m) => m.id === input.userId);
          const memberName = member
            ? getDisplayName(member, `Member #${input.userId}`)
            : `Member #${input.userId}`;

          if (newBalance === 2) {
            await createNotification({
              userId: input.userId,
              type: "pass_low",
              title: "Pass Running Low — 2 Sessions Remaining",
              message:
                "You only have 2 sessions remaining on your pass. Top up now from the Payments page to keep your balance going.",
            });
            const admins = await getAdminUsers();
            await Promise.all(
              admins.map((admin) =>
                createNotification({
                  userId: admin.id,
                  type: "pass_low",
                  title: `Low Pass Alert: ${memberName}`,
                  message: `${memberName} has only 2 sessions remaining on their pass. You can assign a new pass from the Admin Panel or Passes page.`,
                })
              )
            );
            // Email the member
            const { sendEmail } = await import("./email");
            if (member?.email) {
              await sendEmail({
                to: member.email,
                subject: "Time to top up your BVC pass — 2 sessions remaining",
                html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#0e1a2b;padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;color:#c9922a;font-size:11px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;">Bundaberg Voice Collective</p>
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">Time to top up your pass</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px 8px;">
          <p style="margin:0 0 12px;font-size:16px;color:#444;line-height:1.6;">Hi ${memberName},</p>
          <p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">You have <strong style="color:#0e1a2b;">2 sessions remaining</strong> on your current BVC pass. To keep singing with us without any interruption, please arrange a top-up at your earliest convenience.</p>
        </td></tr>

        <!-- Payment options heading -->
        <tr><td style="padding:0 40px 16px;">
          <p style="margin:0 0 16px;font-size:15px;font-weight:bold;color:#0e1a2b;">How to pay</p>

          <!-- Bank Transfer -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f6;border-radius:8px;margin-bottom:12px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#2a8a7a;text-transform:uppercase;letter-spacing:1px;">&#127968; Bank Transfer</p>
              <table cellpadding="0" cellspacing="0">
                <tr><td style="padding:2px 0;font-size:14px;color:#444;"><span style="color:#888;width:140px;display:inline-block;">Account Name</span> <strong>Christie Jacobsen</strong></td></tr>
                <tr><td style="padding:2px 0;font-size:14px;color:#444;"><span style="color:#888;width:140px;display:inline-block;">BSB</span> <strong>062&thinsp;948</strong></td></tr>
                <tr><td style="padding:2px 0;font-size:14px;color:#444;"><span style="color:#888;width:140px;display:inline-block;">Account Number</span> <strong>3498&thinsp;2377</strong></td></tr>
                <tr><td style="padding:2px 0;font-size:14px;color:#444;"><span style="color:#888;width:140px;display:inline-block;">PayID</span> <strong>0407 576 731</strong></td></tr>
              </table>
              <p style="margin:8px 0 0;font-size:13px;color:#888;">Please include your name as the payment reference.</p>
            </td></tr>
          </table>

          <!-- In-person options -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8f0;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#c9922a;text-transform:uppercase;letter-spacing:1px;">&#127925; At Rehearsal</p>
              <p style="margin:0 0 6px;font-size:14px;color:#444;">&#8226;&nbsp; Cash at your next rehearsal</p>
              <p style="margin:0;font-size:14px;color:#444;">&#8226;&nbsp; EFTPOS at your next rehearsal</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Pass options reminder -->
        <tr><td style="padding:0 40px 32px;">
          <p style="margin:0;font-size:14px;color:#888;line-height:1.6;">Pass options: <strong>10-Pass — $140</strong> &nbsp;|&nbsp; <strong>5-Pass — $75</strong> &nbsp;|&nbsp; <strong>Single Session — $16</strong></p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0e1a2b;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#c9922a;">Bundaberg Voice Collective</p>
          <p style="margin:0;font-size:11px;color:#666;">Bundaberg, QLD, Australia</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
                text: `Hi ${memberName},\n\nYou have 2 sessions remaining on your BVC pass. Please arrange a top-up soon.\n\nHOW TO PAY\n\nBank Transfer:\n  Account Name: Christie Jacobsen\n  BSB: 062 948\n  Account Number: 3498 2377\n  PayID: 0407 576 731\n  (Please include your name as the reference)\n\nAt Rehearsal:\n  - Cash at your next rehearsal\n  - EFTPOS at your next rehearsal\n\nPass options: 10-Pass $140 | 5-Pass $75 | Single Session $16\n\n— Bundaberg Voice Collective`,
              }).catch((e) => console.warn("[Attendance] member low-pass email failed:", e));
            }
          }
          if (newBalance === 0) {
            await createNotification({
              userId: input.userId,
              type: "pass_low",
              title: "Pass Fully Used",
              message:
                "Your pass has been fully used. Purchase a new pass from the Payments page to continue attending sessions.",
            });
            const admins = await getAdminUsers();
            await Promise.all(
              admins.map((admin) =>
                createNotification({
                  userId: admin.id,
                  type: "pass_low",
                  title: `Pass Expired: ${memberName}`,
                  message: `${memberName}'s pass has been fully used. They will need to purchase a new pass to continue attending sessions.`,
                })
              )
            );
            await notifyOwner({
              title: `Pass Expired: ${memberName}`,
              content: `${memberName}'s pass has been fully used. They will need to purchase a new pass to continue attending sessions.`,
            }).catch((e) => console.warn("[Attendance] notifyOwner failed:", e));
          }
        } else if (shouldRestore || switchToComp) {
          // Restore a session to the pass: either un-marking attendance, or switching to complimentary
          // Uses restorePassSession (not topUpPass) so remainingSessions never exceeds totalSessions
          const passBeforeRestore = await getActivePassForUser(input.userId);
          const balanceBeforeRestore = passBeforeRestore?.remainingSessions ?? null;
          if (passBeforeRestore) await restorePassSession(passBeforeRestore.id);
          const passAfterRestore = await getActivePassForUser(input.userId);
          const balanceAfterRestore = passAfterRestore?.remainingSessions ?? null;
          const restoreAction = shouldRestore ? "attendance_unmarked" : "pass_restored";
          const restoreDetail = shouldRestore
            ? `Attendance un-marked (session restored). Balance: ${balanceBeforeRestore} → ${balanceAfterRestore}.`
            : `Switched to complimentary (session restored). Balance: ${balanceBeforeRestore} → ${balanceAfterRestore}.`;
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: restoreAction,
            detail: restoreDetail,
            balanceBefore: balanceBeforeRestore,
            balanceAfter: balanceAfterRestore,
          }).catch(() => {});
        } else if (switchFromComp) {
          // Switching from complimentary to pass — deduct a session now
          const passBeforeSwitch = await getActivePassForUser(input.userId);
          const balanceBeforeSwitch = passBeforeSwitch?.remainingSessions ?? null;
          await deductPassSession(input.userId);
          const passAfterSwitch = await getActivePassForUser(input.userId);
          const balanceAfterSwitch = passAfterSwitch?.remainingSessions ?? null;
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: "pass_deducted",
            detail: `Switched from complimentary to pass (session deducted). Balance: ${balanceBeforeSwitch} → ${balanceAfterSwitch}.`,
            balanceBefore: balanceBeforeSwitch,
            balanceAfter: balanceAfterSwitch,
          }).catch(() => {});
        } else if (input.attended && sessionType === "complimentary") {
          // Marked as complimentary — no pass change, just log it
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: "comp_granted",
            detail: `Marked attended as complimentary (no pass deducted).`,
          }).catch(() => {});
        } else if (input.attended && sessionType === "single") {
          // Marked as single session — no pass change, just log it
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: "attendance_marked",
            detail: `Marked attended as single session (no pass).`,
          }).catch(() => {});
        } else if (!input.attended && !wasPassUsed) {
          // Un-marked but no pass was used — just log the un-mark
          await logActivity({
            userId: input.userId,
            actorId: ctx.user.id,
            action: "attendance_unmarked",
            detail: `Attendance un-marked (no pass change).`,
          }).catch(() => {});
        }

        return record;
      }),

    // Returns headcount + pass-type breakdown for the most recent session
    lastSessionStats: protectedProcedure.query(() => getLastSessionStats()),

    // Returns headcount + pass-type breakdown for a specific session (admin)
    sessionStats: adminProcedure
      .input(z.object({ sessionId: z.number() }))
      .query(({ input }) => getSessionStats(input.sessionId)),

    // Returns all sessions the current user attended (member-facing history)
    myHistory: protectedProcedure.query(({ ctx }) =>
      getAttendanceHistoryForUser(ctx.user.id)
    ),
  }),

  // ─── Passes ─────────────────────────────────────────────────────────────────
  passes: router({
    myPass: protectedProcedure.query(({ ctx }) =>
      getActivePassForUser(ctx.user.id)
    ),
    forUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getAllPassesForUser(input.userId)),
    activeForUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(({ input }) => getActivePassForUser(input.userId)),
    assign: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          totalSessions: z.number().min(1).max(50).default(10),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const result = await assignPass({
          userId: input.userId,
          totalSessions: input.totalSessions,
          assignedBy: ctx.user.id,
          notes: input.notes,
        });
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: "pass_credited",
          detail: `Admin assigned a ${input.totalSessions}-session pass.${input.notes ? ` Note: ${input.notes}` : ""} Balance: 0 → ${input.totalSessions}.`,
          balanceBefore: 0,
          balanceAfter: input.totalSessions,
        }).catch(() => {});
        return result;
      }),
    topUp: adminProcedure
      .input(z.object({ passId: z.number(), userId: z.number(), addSessions: z.number().min(1).max(50) }))
      .mutation(async ({ input, ctx }) => {
        const passBefore = await getActivePassForUser(input.userId);
        const balanceBefore = passBefore?.remainingSessions ?? null;
        const result = await topUpPass(input.passId, input.addSessions);
        const balanceAfter = result?.remainingSessions ?? null;
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: "pass_credited",
          detail: `Admin topped up pass by ${input.addSessions} session${input.addSessions === 1 ? "" : "s"}. Balance: ${balanceBefore} → ${balanceAfter}.`,
          balanceBefore,
          balanceAfter,
        }).catch(() => {});
        return result;
      }),

    // Admin: directly set the remaining session count on a member's active pass
    adminAdjust: adminProcedure
      .input(z.object({
        userId: z.number(),
        newRemaining: z.number().int().min(0).max(200),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { getActivePassForUser, setPassRemaining } = await import("./db");
        const pass = await getActivePassForUser(input.userId);
        if (!pass) throw new TRPCError({ code: "NOT_FOUND", message: "No active pass found for this member." });
        const balanceBefore = pass.remainingSessions;
        const result = await setPassRemaining(pass.id, input.newRemaining, input.reason);
        await logActivity({
          userId: input.userId,
          actorId: ctx.user.id,
          action: "pass_adjusted",
          detail: `Admin manually set session balance to ${input.newRemaining}.${input.reason ? ` Reason: ${input.reason}` : ""} Balance: ${balanceBefore} → ${input.newRemaining}.`,
          balanceBefore,
          balanceAfter: input.newRemaining,
        }).catch(() => {});
        return result;
      }),

    // Admin: delete a pass by ID (undo accidental assignment)
    delete: adminProcedure
      .input(z.object({ passId: z.number() }))
      .mutation(({ input }) => deletePassById(input.passId)),
  }),

  // ─── Notifications ──────────────────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => getAllNotifications(ctx.user.id)),
    unread: protectedProcedure.query(({ ctx }) => getUnreadNotifications(ctx.user.id)),
    markRead: protectedProcedure
      .input(z.object({ notificationId: z.number() }))
      .mutation(({ input, ctx }) =>
        markNotificationRead(input.notificationId, ctx.user.id)
      ),
    markAllRead: protectedProcedure.mutation(({ ctx }) =>
      markAllNotificationsRead(ctx.user.id)
    ),
    unreadSummary: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const [unreadMsgs, allAnnouncements, readIds] = await Promise.all([
        getUnreadMessageCount(userId),
        listAnnouncements(),
        getReadAnnouncementIds(userId),
      ]);
      const unreadAnnouncements = allAnnouncements.filter((a) => !readIds.includes(a.id)).length;
      return { unreadMessages: unreadMsgs, unreadAnnouncements: unreadAnnouncements };
    }),
  }),

  // ─── Push Notifications ────────────────────────────────────────────────────
  push: router({
    // Save a Web Push subscription from the browser
    subscribe: protectedProcedure
      .input(z.object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      }))
      .mutation(({ input, ctx }) => savePushSubscription(ctx.user.id, input)),

    // Remove a Web Push subscription (user unsubscribed)
    unsubscribe: protectedProcedure
      .input(z.object({ endpoint: z.string() }))
      .mutation(({ input, ctx }) => deletePushSubscription(ctx.user.id, input.endpoint)),

    // Return the VAPID public key so the frontend can subscribe
    vapidPublicKey: publicProcedure.query(() => process.env.VITE_VAPID_PUBLIC_KEY ?? ""),
  }),

  // ─── Announcements ──────────────────────────────────────────────────────────
  announcements: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const items = await listAnnouncements();
      const readIds = await getReadAnnouncementIds(ctx.user.id);
      return items.map((a) => ({ ...a, isRead: readIds.includes(a.id) }));
    }),
    uploadAttachment: adminProcedure
      .input(
        z.object({
          fileBase64: z.string(),
          mimeType: z.string(),
          fileName: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileKey = `announcements/${Date.now()}_${safeFileName}`;
        const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
        return { url, key, name: input.fileName, mimeType: input.mimeType };
      }),
    create: adminProcedure
      .input(
        z.object({
          title: z.string().min(1),
          body: z.string().min(1),
          category: z.enum(["event", "rehearsal", "general"]).default("general"),
          pinned: z.boolean().default(false),
          attachmentUrl: z.string().optional(),
          attachmentKey: z.string().optional(),
          attachmentType: z.enum(["image", "video", "document"]).optional(),
          attachmentName: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const announcement = await createAnnouncement({ ...input, authorId: ctx.user.id });
        // Notify all members about the new announcement (in-app)
        notifyAllMembers({
          type: "announcement",
          title: `New announcement: ${input.title}`,
          message: input.body.length > 120 ? input.body.slice(0, 120) + "…" : input.body,
          excludeUserId: ctx.user.id,
        });
        // Send Web Push to all subscribed Android/PWA users
        sendPushToAll({
          title: `BVC: ${input.title}`,
          body: input.body.length > 100 ? input.body.slice(0, 100) + "…" : input.body,
          url: "/announcements",
        }).catch((e) => console.error("[WebPush] Broadcast error:", e));
        return announcement;
      }),
    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).optional(),
          body: z.string().min(1).optional(),
          category: z.enum(["event", "rehearsal", "general"]).optional(),
          pinned: z.boolean().optional(),
          attachmentUrl: z.string().nullable().optional(),
          attachmentKey: z.string().nullable().optional(),
          attachmentType: z.enum(["image", "video", "document"]).nullable().optional(),
          attachmentName: z.string().nullable().optional(),
        })
      )
      .mutation(({ input }) => {
        const { id, ...data } = input;
        return updateAnnouncement(id, data);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteAnnouncement(input.id)),
    markRead: protectedProcedure
      .input(z.object({ announcementId: z.number() }))
      .mutation(({ input, ctx }) =>
        markAnnouncementRead(input.announcementId, ctx.user.id)
      ),
    getViewers: adminProcedure
      .input(z.object({ announcementId: z.number() }))
      .query(({ input }) => getAnnouncementViewers(input.announcementId)),
    getViewCounts: adminProcedure
      .input(z.object({ announcementIds: z.array(z.number()) }))
      .query(async ({ input }) => {
        const counts: Record<number, number> = {};
        await Promise.all(
          input.announcementIds.map(async (id) => {
            counts[id] = await getAnnouncementViewCount(id);
          })
        );
        return counts;
      }),
  }),

  // ─── Library ────────────────────────────────────────────────────────────────
  library: router({
    list: protectedProcedure.query(() => listLibraryItems()),
    upload: adminProcedure
      .input(
        z.object({
          title: z.string().min(1),
          artist: z.string().optional(),
          type: z.enum(["sheet_music", "backing_track"]),
          fileName: z.string(),
          mimeType: z.string().optional(),
          fileBase64: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileKey = `library/${Date.now()}_${safeFileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType ?? "application/octet-stream");
        const item = await createLibraryItem({
          title: input.title,
          artist: input.artist,
          type: input.type,
          fileKey,
          fileUrl: url,
          fileName: input.fileName,
          mimeType: input.mimeType,
          uploadedBy: ctx.user.id,
        });
        // Notify all members about the new library file
        notifyAllMembers({
          type: "library",
          title: `New music added: ${input.title}`,
          message: `${input.type === "sheet_music" ? "Sheet music" : "Backing track"}${input.artist ? ` by ${input.artist}` : ""} has been added to the music library.`,
          excludeUserId: ctx.user.id,
        });
        return item;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => deleteLibraryItem(input.id)),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1),
          artist: z.string().optional().nullable(),
          type: z.enum(["sheet_music", "backing_track", "lyrics", "chord_chart"]),
        })
      )
      .mutation(({ input }) =>
        updateLibraryItem(input.id, {
          title: input.title,
          artist: input.artist ?? null,
          type: input.type,
        })
      ),

    replaceFile: adminProcedure
      .input(
        z.object({
          id: z.number(),
          fileName: z.string(),
          mimeType: z.string().optional(),
          fileBase64: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileKey = `library/${Date.now()}_${safeFileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType ?? "application/octet-stream");
        return updateLibraryItem(input.id, {
          fileKey,
          fileUrl: url,
          fileName: input.fileName,
          mimeType: input.mimeType,
        });
      }),
  }),

  // ─── Square Payments ────────────────────────────────────────────────────────
  payments: router({
    products: publicProcedure.query(() =>
      Object.entries(PASS_PRODUCTS).map(([key, p]) => ({ key, ...p }))
    ),

    createCheckout: protectedProcedure
      .input(
        z.object({
          passProductKey: z.enum(["10-pass", "5-pass", "single", "test"]),
          origin: z.string().url(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const product = PASS_PRODUCTS[input.passProductKey as PassProductKey];
        if (!product) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown product" });

                const referenceId = `pass-${ctx.user.id}-${input.passProductKey}-${Date.now()}`;
        const squareLink = await createSquarePaymentLink({
          name: product.name,
          amountCents: product.amountCents,
          currency: product.currency.toUpperCase(),
          redirectUrl: `${input.origin}/payments?success=1`,
          referenceId,
          note: `user_id:${ctx.user.id}|pass_product_key:${input.passProductKey}|session_count:${product.sessionCount}`,
        });
        // Record pending order
        await createPassOrder({
          userId: ctx.user.id,
          paymentSessionId: squareLink.orderId,
          paymentProvider: "square",
          passType: input.passProductKey,
          sessionCount: product.sessionCount,
          amountCents: product.amountCents,
          currency: product.currency,
        });
        return { checkoutUrl: squareLink.url };
      }),

    myOrders: protectedProcedure.query(({ ctx }) =>
      getPassOrdersForUser(ctx.user.id)
    ),

    allOrders: adminProcedure.query(() => getAllPassOrders()),

    monthlyOnlineSummary: adminProcedure.query(() => getMonthlyOnlinePassSalesSummary()),

    resendReceipt: adminProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const orders = await getAllPassOrders();
        const order = orders.find((candidate) => candidate.id === input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.status !== "paid" || order.paymentMethod !== "square" || order.amountCents <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Receipts are available only for completed online pass purchases" });
        }
        if (!order.userEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This member does not have an email address on file" });
        }
        const memberName = getDisplayName({
          name: order.userName,
          firstName: order.userFirstName,
          lastName: order.userLastName,
          email: order.userEmail,
        });
        const receiptSent = await sendOnlinePassReceipt({
          to: order.userEmail,
          memberName,
          passType: order.passType,
          sessionCount: order.sessionCount,
          amountCents: order.amountCents,
          currency: order.currency,
          paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? `BVC-${order.id}`,
          purchasedAt: new Date(order.createdAt),
        });
        if (!receiptSent) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Receipt email could not be sent. Please try again." });
        }
        await markPassOrderReceiptSent(order.id);
        await logActivity({
          userId: order.userId,
          actorId: ctx.user.id,
          action: "receipt_resent",
          detail: `Receipt resent to ${order.userEmail} for ${order.passType.replace(/-/g, " ")} (${order.sessionCount} sessions).`,
        });
        return { success: true, email: order.userEmail };
      }),

    resendReceipts: adminProcedure
      .input(z.object({ orderIds: z.array(z.number()).min(1).max(50) }))
      .mutation(async ({ input, ctx }) => {
        const uniqueOrderIds = Array.from(new Set(input.orderIds));
        const orders = await getAllPassOrders();
        const sent: number[] = [];
        const skipped: Array<{ id: number; reason: string }> = [];
        const failed: Array<{ id: number; reason: string }> = [];

        for (const orderId of uniqueOrderIds) {
          const order = orders.find((candidate) => candidate.id === orderId);
          if (!order) {
            skipped.push({ id: orderId, reason: "Order not found" });
            continue;
          }
          if (order.status !== "paid" || order.paymentMethod !== "square" || order.amountCents <= 0 || order.receiptSentAt) {
            skipped.push({ id: orderId, reason: "Order is not an eligible unsent online receipt" });
            continue;
          }
          if (!order.userEmail) {
            skipped.push({ id: orderId, reason: "Member does not have an email address" });
            continue;
          }

          try {
            const memberName = getDisplayName({
              name: order.userName,
              firstName: order.userFirstName,
              lastName: order.userLastName,
              email: order.userEmail,
            });
            const receiptSent = await sendOnlinePassReceipt({
              to: order.userEmail,
              memberName,
              passType: order.passType,
              sessionCount: order.sessionCount,
              amountCents: order.amountCents,
              currency: order.currency,
              paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? `BVC-${order.id}`,
              purchasedAt: new Date(order.createdAt),
            });
            if (!receiptSent) throw new Error("Receipt email could not be sent");

            await markPassOrderReceiptSent(order.id);
            await logActivity({
              userId: order.userId,
              actorId: ctx.user.id,
              action: "receipt_resent",
              detail: `Receipt sent in bulk to ${order.userEmail} for ${order.passType.replace(/-/g, " ")} (${order.sessionCount} sessions).`,
            });
            sent.push(order.id);
          } catch (error) {
            failed.push({
              id: orderId,
              reason: error instanceof Error ? error.message : "Receipt email could not be sent",
            });
          }
        }

        return { sent, skipped, failed };
      }),

    // Admin: sync all pending orders against Square to auto-activate paid ones
    syncPendingOrders: adminProcedure.mutation(async () => {
      const allOrders = await getAllPassOrders();
      const pending = allOrders.filter((o) => o.status === "pending" && o.stripeSessionId);
      let activated = 0;
      let skipped = 0;
      for (const order of pending) {
        try {
          const squareStatus = await getSquareOrderStatus(order.stripeSessionId!);
          if (!squareStatus) { skipped++; continue; }
          if (!squareStatus.paid) { skipped++; continue; }
          // Order is paid — activate the pass
          const existingPass = await getActivePassForUser(order.userId);
          let finalPass;
          if (existingPass) {
            finalPass = await topUpPass(existingPass.id, order.sessionCount);
          } else {
            finalPass = await assignPass({
              userId: order.userId,
              totalSessions: order.sessionCount,
              assignedBy: 0,
              notes: `Purchased via Square —  ${order.passType} (synced)`,
            });
          }
          await updatePassOrderStatus(order.stripeSessionId!, "paid", { passId: finalPass?.id });
          const newBalance = finalPass?.remainingSessions ?? order.sessionCount;
          const wasTopUp = !!existingPass;
          await createNotification({
            userId: order.userId,
            type: "general",
            title: wasTopUp ? "Pass Topped Up" : "Pass Activated",
            message: wasTopUp
              ? `Your pass has been topped up by ${order.sessionCount} sessions. You now have ${newBalance} sessions remaining.`
              : `Your ${order.passType} (${order.sessionCount} sessions) has been activated. Enjoy your rehearsals!`,
          });
          const oldBal = existingPass?.remainingSessions ?? 0;
          await logActivity({
            userId: order.userId,
            actorId: null,
            action: "pass_online_purchase",
            detail: wasTopUp
              ? `Admin sync: Square order #${order.id} paid — +${order.sessionCount} sessions (${order.passType}). Balance: ${oldBal} → ${newBalance}.`
              : `Admin sync: Square order #${order.id} paid — ${order.passType} (${order.sessionCount} sessions) activated. Balance: 0 → ${newBalance}.`,
            balanceBefore: wasTopUp ? oldBal : 0,
            balanceAfter: newBalance,
          }).catch(() => {});
          const members = await getAllMembers();
          const member = members.find((m) => m.id === order.userId);
          const paidOrder = { ...order, status: "paid" as const };
          if (member?.email && shouldIssueOnlinePassReceipt(paidOrder)) {
            const receiptSent = await sendOnlinePassReceipt({
              to: member.email,
              memberName: getDisplayName(member),
              passType: order.passType,
              sessionCount: order.sessionCount,
              amountCents: order.amountCents,
              currency: order.currency,
              paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? `BVC-${order.id}`,
              purchasedAt: new Date(),
            });
            if (receiptSent) await markPassOrderReceiptSent(order.id);
          }
          activated++;
        } catch (err) {
          console.error(`[SyncOrders] Error processing order ${order.id}:`, err);
          skipped++;
        }
      }
      return { activated, skipped, total: pending.length };
    }),

    // Admin: manually activate a specific pending order
    manualActivateOrder: adminProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ input }) => {
        const allOrders = await getAllPassOrders();
        const order = allOrders.find((o) => o.id === input.orderId);
        if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        if (order.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Order already paid" });
        const existingPass = await getActivePassForUser(order.userId);
        let finalPass;
        if (existingPass) {
          finalPass = await topUpPass(existingPass.id, order.sessionCount);
        } else {
          finalPass = await assignPass({
            userId: order.userId,
            totalSessions: order.sessionCount,
            assignedBy: 0,
            notes: `Purchased via Square —  ${order.passType} (manually activated)`,
          });
        }
        if (order.stripeSessionId) {
          await updatePassOrderStatus(order.stripeSessionId, "paid", { passId: finalPass?.id });
        }
        const newBalance = finalPass?.remainingSessions ?? order.sessionCount;
        const wasTopUp = !!existingPass;
        await createNotification({
          userId: order.userId,
          type: "general",
          title: wasTopUp ? "Pass Topped Up" : "Pass Activated",
          message: wasTopUp
            ? `Your pass has been topped up by ${order.sessionCount} sessions. You now have ${newBalance} sessions remaining.`
            : `Your ${order.passType} (${order.sessionCount} sessions) has been activated. Enjoy your rehearsals!`,
        });
        const oldBal2 = existingPass?.remainingSessions ?? 0;
        await logActivity({
          userId: order.userId,
          actorId: null,
          action: "pass_manual_activated",
          detail: wasTopUp
            ? `Admin manually activated Square order #${order.id} — +${order.sessionCount} sessions (${order.passType}). Balance: ${oldBal2} → ${newBalance}.`
            : `Admin manually activated Square order #${order.id} — ${order.passType} (${order.sessionCount} sessions). Balance: 0 → ${newBalance}.`,
          balanceBefore: wasTopUp ? oldBal2 : 0,
          balanceAfter: newBalance,
        }).catch(() => {});
        const members = await getAllMembers();
        const member = members.find((m) => m.id === order.userId);
        const paidOrder = { ...order, status: "paid" as const };
        if (member?.email && shouldIssueOnlinePassReceipt(paidOrder)) {
          const receiptSent = await sendOnlinePassReceipt({
            to: member.email,
            memberName: getDisplayName(member),
            passType: order.passType,
            sessionCount: order.sessionCount,
            amountCents: order.amountCents,
            currency: order.currency,
            paymentReference: order.paymentSessionId ?? order.stripeSessionId ?? `BVC-${order.id}`,
            purchasedAt: new Date(),
          });
          if (receiptSent) await markPassOrderReceiptSent(order.id);
        }
        return { success: true, newBalance, wasTopUp };
      }),
  }),

  // ─── Direct Messages ─────────────────────────────────────────────────────────
  messages: router({
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      const count = await getUnreadMessageCount(ctx.user.id);
      return { count };
    }),

    conversations: protectedProcedure.query(async ({ ctx }) => {
      const convos = await getConversationList(ctx.user.id);
      // Enrich with partner info
      const allMembers = await getMembersForDM();
      return convos.map((msg) => {
        const partnerId = msg.fromUserId === ctx.user.id ? msg.toUserId : msg.fromUserId;
        const partner = allMembers.find((m) => m.id === partnerId);
        return {
          ...msg,
          partnerId,
          // Only expose the partner's display name — no email or other details
          partnerName: partner ? getDisplayName(partner) : "Member",
        };
      });
    }),

    thread: protectedProcedure
      .input(z.object({ partnerId: z.number() }))
      .query(async ({ input, ctx }) => {
        // Mark messages from partner as read
        await markMessagesRead(input.partnerId, ctx.user.id);
        return getConversation(ctx.user.id, input.partnerId);
      }),

    send: protectedProcedure
      .input(z.object({ toUserId: z.number(), body: z.string().min(1).max(2000) }))
      .mutation(async ({ input, ctx }) => {
        if (input.toUserId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot message yourself" });
        }
        return sendDirectMessage(ctx.user.id, input.toUserId, input.body);
      }),

    // Returns only id + name — no email, role, or other sensitive fields
    members: protectedProcedure.query(() => getMembersForDM()),

    // ─── Group Conversations (multi-person DMs) ───────────────────────────────
    groupConversations: protectedProcedure.query(async ({ ctx }) => {
      return getGroupConversationsForUser(ctx.user.id);
    }),

    groupThread: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ input, ctx }) => {
        const isMember = await isConversationParticipant(input.conversationId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a participant" });
        return getGroupConversationMessages(input.conversationId);
      }),

    createGroupConversation: protectedProcedure
      .input(
        z.object({
          participantIds: z.array(z.number()).min(1).max(20),
          name: z.string().max(100).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // Always include the creator
        const allIds = Array.from(new Set([ctx.user.id, ...input.participantIds]));
        if (allIds.length < 2) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Select at least one other member" });
        }
        return createGroupConversation(ctx.user.id, allIds, input.name);
      }),

    sendGroupMessage: protectedProcedure
      .input(
        z.object({
          conversationId: z.number(),
          body: z.string().min(1).max(2000),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const isMember = await isConversationParticipant(input.conversationId, ctx.user.id);
        if (!isMember) throw new TRPCError({ code: "FORBIDDEN", message: "Not a participant" });
        return sendGroupConversationMessage(input.conversationId, ctx.user.id, input.body);
      }),
  }),

  // ─── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: router({
    adminStats: adminProcedure.query(() => getAdminStats()),
    memberSummary: protectedProcedure.query(async ({ ctx }) => {
      const [pass, attendance, unreadNotifications, announcements, unreadMsgCount, rawChatPreviews] =
        await Promise.all([
          getActivePassForUser(ctx.user.id),
          getAttendanceForUser(ctx.user.id),
          getUnreadNotifications(ctx.user.id),
          listAnnouncements(),
          getUnreadMessageCount(ctx.user.id),
          getUnreadConversationPreviews(ctx.user.id),
        ]);
      const readIds = await getReadAnnouncementIds(ctx.user.id);
      const unreadAnnouncements = announcements
        .filter((a) => !readIds.includes(a.id))
        .slice(0, 3);
      // Enrich chat previews with sender names
      const allMembers = await getMembersForDM();
      const unreadChatPreviews = rawChatPreviews.map((msg) => ({
        id: msg.id,
        fromUserId: msg.fromUserId,
        body: msg.body,
        createdAt: msg.createdAt,
        senderName: (() => { const m = allMembers.find((x) => x.id === msg.fromUserId); return m ? getDisplayName(m) : "Member"; })(),
      }));
      return {
        pass,
        recentAttendance: attendance.slice(0, 5),
        totalAttended: attendance.length,
        unreadNotificationCount: unreadNotifications.length,
        unreadAnnouncementCount: announcements.filter((a) => !readIds.includes(a.id)).length,
        unreadAnnouncements,
        unreadMessageCount: unreadMsgCount,
        unreadChatPreviews,
      };
    }),
    expiredPasses: adminProcedure.query(() => getExpiredPasses()),
    lowPasses: adminProcedure.query(() => getLowPasses()),
    lastSessionIncome: adminProcedure.query(async () => {
      const base = await getLastSessionIncome();
      if (!base) return null;
      // Fetch live Square payments for the session date
      let squarePayments: { id: string; createdAt: string; status: string; amountCents: number; currency: string; buyerEmail: string | null; note: string | null; sourceType: string | null }[] = [];
      try {
        const { getSquarePaymentsForDate } = await import("./_core/square");
        squarePayments = await getSquarePaymentsForDate(base.sessionDateStr);
      } catch (e) {
        console.warn("[Square] Could not fetch payments:", e);
      }
      const squareTotalCents = squarePayments.reduce((s, p) => s + p.amountCents, 0);
      const grandTotalCents = squareTotalCents + base.cashTotalCents;
      return {
        ...base,
        squarePayments,
        squareTotalCents,
        grandTotalCents,
      };
    }),
  }),
});

// ─── Events ─────────────────────────────────────────────────────────────────
const eventsRouter = router({
  list: protectedProcedure.query(() => listEvents()),
  uploadImage: adminProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        mimeType: z.string(),
        fileName: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `events/${Date.now()}_${safeFileName}`;
      const { key, url } = await storagePut(fileKey, buffer, input.mimeType);
      return { url, key };
    }),
  create: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        eventDate: z.date(),
        endDate: z.date().optional(),
        category: z.enum(["concert", "rehearsal", "social", "workshop", "other"]).default("other"),
        imageUrl: z.string().optional(),
        imageKey: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const event = await createEvent({ ...input, createdBy: ctx.user.id });
      // Notify all members about the new event/performance
      const dateStr = input.eventDate.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      notifyAllMembers({
        type: "event",
        title: `New event: ${input.title}`,
        message: `${input.category === "concert" ? "Performance" : input.category === "rehearsal" ? "Rehearsal" : "Event"} on ${dateStr}${input.location ? ` at ${input.location}` : ""}.`,
        excludeUserId: ctx.user.id,
      });
      return event;
    }),
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        eventDate: z.date().optional(),
        endDate: z.date().optional(),
        category: z.enum(["concert", "rehearsal", "social", "workshop", "other"]).optional(),
        imageUrl: z.string().nullable().optional(),
        imageKey: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => { const { id, ...data } = input; return updateEvent(id, data); }),
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteEvent(input.id)),

  // Member sets their RSVP for an event
  rsvp: protectedProcedure
    .input(z.object({
      eventId: z.number(),
      status: z.enum(["attending", "not_attending"]),
    }))
    .mutation(({ input, ctx }) => upsertEventRsvp(input.eventId, ctx.user.id, input.status)),

  // Get the current user's RSVP for a specific event
  myRsvp: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .query(({ input, ctx }) => getEventRsvp(input.eventId, ctx.user.id)),

  // Get RSVP counts for an event (attending / not_attending)
  rsvpCounts: protectedProcedure
    .input(z.object({ eventId: z.number() }))
    .query(({ input }) => getEventRsvpCounts(input.eventId)),

  // Admin: get full RSVP list with names for an event
  rsvpList: adminProcedure
    .input(z.object({ eventId: z.number() }))
    .query(({ input }) => getEventRsvpList(input.eventId)),
});

// ─── Groups ──────────────────────────────────────────────────────────────────
const groupsRouter = router({
  // List all groups (admin sees all; members see public list)
  list: protectedProcedure.query(() => listGroups()),

  // Admin-only: see all groups with member counts
  adminList: adminProcedure.query(async () => {
    const allGroups = await listGroups();
    const results = await Promise.all(
      allGroups.map(async (g) => {
        const members = await getGroupMembers(g.id);
        return { ...g, memberCount: members.filter((m) => m.status === "approved").length, members };
      })
    );
    return results;
  }),

  // My groups (approved membership)
  myGroups: protectedProcedure.query(({ ctx }) => getUserGroups(ctx.user.id)),

  // Pending invites for the current user
  myInvites: protectedProcedure.query(({ ctx }) => getUserPendingInvites(ctx.user.id)),

  // Create a group (admin only — members cannot bypass the UI restriction)
  create: adminProcedure
    .input(z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional() }))
    .mutation(({ input, ctx }) => createGroup({ ...input, createdBy: ctx.user.id })),

  // Update group (owner or admin)
  update: protectedProcedure
    .input(z.object({ groupId: z.number(), name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && group.createdBy !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      const { groupId, ...data } = input;
      return updateGroup(groupId, data);
    }),

  // Delete group (owner or admin)
  delete: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && group.createdBy !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return deleteGroup(input.groupId);
    }),

  // Get members of a group
  members: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input, ctx }) => {
      // Must be a member or admin
      const membership = await getGroupMembership(input.groupId, ctx.user.id);
      if (ctx.user.role !== "admin" && (!membership || membership.status !== "approved"))
        throw new TRPCError({ code: "FORBIDDEN" });
      return getGroupMembers(input.groupId);
    }),

  // Invite a member to a group (owner or admin)
  invite: protectedProcedure
    .input(z.object({ groupId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && group.createdBy !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return inviteToGroup(input.groupId, input.userId, ctx.user.id);
    }),

  // Accept an invite
  acceptInvite: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(({ input, ctx }) => acceptGroupInvite(input.groupId, ctx.user.id)),

  // Request to join a group (any member)
  requestJoin: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(({ input, ctx }) => requestJoinGroup(input.groupId, ctx.user.id)),

  // Approve or reject a join request (owner or admin)
  respondRequest: protectedProcedure
    .input(z.object({ groupId: z.number(), userId: z.number(), approve: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && group.createdBy !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return respondToGroupRequest(input.groupId, input.userId, input.approve);
    }),

  // Remove a member (owner or admin)
  removeMember: protectedProcedure
    .input(z.object({ groupId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      if (ctx.user.role !== "admin" && group.createdBy !== ctx.user.id)
        throw new TRPCError({ code: "FORBIDDEN" });
      return removeGroupMember(input.groupId, input.userId);
    }),

  // Admin: directly add a member (approved immediately, no invite needed)
  adminAddMember: adminProcedure
    .input(z.object({ groupId: z.number(), userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      return addGroupMemberDirectly(input.groupId, input.userId, ctx.user.id);
    }),

  // Admin: rename a group
  rename: adminProcedure
    .input(z.object({ groupId: z.number(), name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const group = await getGroupById(input.groupId);
      if (!group) throw new TRPCError({ code: "NOT_FOUND" });
      return updateGroup(input.groupId, { name: input.name });
    }),

  // Get messages for a group
  messages: protectedProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input, ctx }) => {
      const membership = await getGroupMembership(input.groupId, ctx.user.id);
      if (ctx.user.role !== "admin" && (!membership || membership.status !== "approved"))
        throw new TRPCError({ code: "FORBIDDEN" });
      return getGroupMessages(input.groupId);
    }),

  // Send a message to a group
  sendMessage: protectedProcedure
    .input(z.object({ groupId: z.number(), body: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      const membership = await getGroupMembership(input.groupId, ctx.user.id);
      if (!membership || membership.status !== "approved")
        throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
      return sendGroupMessage(input.groupId, ctx.user.id, input.body);
    }),
});

// ─── Live Stream Rehearsals ─────────────────────────────────────────────────────────────────────────────
const liveStreamsRouter = router({
  // List all streams; members only see streamUrl if they have access
  list: protectedProcedure.query(async ({ ctx }) => {
    const streams = await listLiveStreams();
    if (ctx.user.role === "admin") return streams.map((s) => ({ ...s, hasAccess: true }));
    const accessList = await getLiveStreamAccessForUser(ctx.user.id);
    const accessSet = new Set(accessList.map((a) => a.streamId));
    return streams.map((s) => ({
      ...s,
      streamUrl: accessSet.has(s.id) ? s.streamUrl : null,
      hasAccess: accessSet.has(s.id),
    }));
  }),

  // Admin: get full access list for a stream
  accessList: adminProcedure
    .input(z.object({ streamId: z.number() }))
    .query(({ input }) => getLiveStreamAccessForStream(input.streamId)),

  // Admin: create a stream
  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      description: z.string().optional(),
      streamUrl: z.string().url(),
      scheduledAt: z.date(),
      endsAt: z.date().optional(),
    }))
    .mutation(({ input, ctx }) => createLiveStream({ ...input, createdBy: ctx.user.id })),

  // Admin: update a stream
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      streamUrl: z.string().url().optional(),
      scheduledAt: z.date().optional(),
      endsAt: z.date().nullable().optional(),
    }))
    .mutation(({ input }) => { const { id, ...data } = input; return updateLiveStream(id, data); }),

  // Admin: delete a stream
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteLiveStream(input.id)),

  // Member: use 1 session from their active pass to unlock a stream
  unlockWithPass: protectedProcedure
    .input(z.object({ streamId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const stream = await getLiveStreamById(input.streamId);
      if (!stream) throw new TRPCError({ code: "NOT_FOUND", message: "Stream not found" });

      // Guard: already has access?
      const alreadyHas = await hasLiveStreamAccess(input.streamId, ctx.user.id);
      if (alreadyHas) throw new TRPCError({ code: "BAD_REQUEST", message: "You already have access to this stream" });

      // Guard: sufficient pass balance?
      const pass = await getActivePassForUser(ctx.user.id);
      if (!pass || pass.remainingSessions < 1)
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pass sessions remaining. Please purchase a pass or a single session." });

      // Atomic: deduct first, then grant. If grant fails, top the session back up.
      const deducted = await deductPassSession(ctx.user.id);
      if (!deducted.pass) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deduct pass session" });

      try {
        await grantLiveStreamAccess({ streamId: input.streamId, userId: ctx.user.id, accessType: "pass" });
      } catch (err) {
        // Rollback: restore the deducted session
        await topUpPass(deducted.pass.id, 1);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to grant stream access. Your pass session has been restored." });
      }

      return { success: true, streamUrl: stream.streamUrl };
    }),

  // Member: record actual live attendance immediately before opening the stream.
  // This never deducts a second pass because access was already unlocked.
  joinLiveRehearsal: protectedProcedure
    .input(z.object({ streamId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const stream = await getLiveStreamById(input.streamId);
      if (!stream) throw new TRPCError({ code: "NOT_FOUND", message: "Stream not found" });
      const hasAccess = await hasLiveStreamAccess(input.streamId, ctx.user.id);
      if (!hasAccess) throw new TRPCError({ code: "FORBIDDEN", message: "Unlock access before joining this rehearsal" });

      const now = new Date();
      const endsAt = stream.endsAt ?? new Date(new Date(stream.scheduledAt).getTime() + 3 * 60 * 60 * 1000);
      const isLive = new Date(stream.scheduledAt) <= now && now <= endsAt;
      const attendance = isLive
        ? await registerLiveStreamAttendance(input.streamId, ctx.user.id)
        : { recorded: false, reason: "outside_live_window" as const };

      return { streamUrl: stream.streamUrl, attendance };
    }),

  // Member: create a Square checkout link to pay for single-session access
  createCheckout: protectedProcedure
    .input(z.object({
      streamId: z.number(),
      origin: z.string(),
      purchaseType: z.enum(["single", "5-pass", "10-pass"]).default("single"),
    }))
    .mutation(async ({ input, ctx }) => {
      const stream = await getLiveStreamById(input.streamId);
      if (!stream) throw new TRPCError({ code: "NOT_FOUND", message: "Stream not found" });

      const alreadyHas = await hasLiveStreamAccess(input.streamId, ctx.user.id);
      if (alreadyHas) throw new TRPCError({ code: "BAD_REQUEST", message: "You already have access to this stream" });

      const product = PASS_PRODUCTS[input.purchaseType];
      const isPassPurchase = input.purchaseType !== "single";

      // For pass purchases, use a descriptive name that makes it clear they also get stream access
      const productName = isPassPurchase
        ? `${product.name} (includes access to ${stream.title})`
        : `Live Stream Access: ${stream.title}`;

            const streamRefId = `stream-${ctx.user.id}-${input.streamId}-${Date.now()}`;
      const squareStreamLink = await createSquarePaymentLink({
        name: productName,
        amountCents: product.amountCents,
        currency: product.currency.toUpperCase(),
        redirectUrl: `${input.origin}/live-streams?success=1&stream=${input.streamId}`,
        referenceId: streamRefId,
        note: `user_id:${ctx.user.id}|purchase_type:${isPassPurchase ? "pass" : "live_stream_access"}|pass_product_key:${isPassPurchase ? input.purchaseType : ""}|stream_id:${input.streamId}|grant_stream_access:1`,
      });
            return { checkoutUrl: squareStreamLink.url };
    }),

  // ─── Recording Archive ──────────────────────────────────────────────────────

  // Admin: set or clear the recording URL for a past stream
  setRecordingUrl: adminProcedure
    .input(z.object({ streamId: z.number(), recordingUrl: z.string().url().nullable() }))
    .mutation(({ input }) => setLiveStreamRecordingUrl(input.streamId, input.recordingUrl)),

  // Member/Admin: check if the current user has access to a recording
  recordingAccessStatus: protectedProcedure
    .input(z.object({ streamId: z.number() }))
    .query(({ input, ctx }) => getRecordingAccessStatus(input.streamId, ctx.user.id)),

  // Member: unlock a recording by spending 1 session pass
  unlockRecordingWithPass: protectedProcedure
    .input(z.object({ streamId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const stream = await getLiveStreamById(input.streamId);
      if (!stream) throw new TRPCError({ code: "NOT_FOUND", message: "Stream not found" });
      if (!stream.recordingUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "No recording available for this stream" });
      // Check if already has access
      const status = await getRecordingAccessStatus(input.streamId, ctx.user.id);
      if (status.hasAccess) throw new TRPCError({ code: "BAD_REQUEST", message: "You already have access to this recording" });
      // Deduct 1 session from pass
      const pass = await getActivePassForUser(ctx.user.id);
      if (!pass || pass.remainingSessions < 1)
        throw new TRPCError({ code: "BAD_REQUEST", message: "No pass sessions remaining. Please purchase a pass first." });
      const deducted = await deductPassSession(ctx.user.id);
      if (!deducted.pass) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to deduct pass session" });
      try {
        await grantRecordingAccessWithPass(input.streamId, ctx.user.id);
      } catch (err) {
        await topUpPass(deducted.pass.id, 1);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to grant recording access. Your pass session has been restored." });
      }
      return { success: true, recordingUrl: stream.recordingUrl };
    }),

  // Admin: view list of who has accessed a recording
  recordingAccessList: adminProcedure
    .input(z.object({ streamId: z.number() }))
    .query(({ input }) => getRecordingAccessList(input.streamId)),
});
const documentsRouter = router({
  list: protectedProcedure.query(async () => {
    return listDocuments();
  }),

  create: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        fileName: z.string(),
        fileKey: z.string(),
        fileUrl: z.string(),
        mimeType: z.string(),
        fileSizeBytes: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await createDocument({ ...input, uploadedBy: ctx.user.id });
      // Notify all members about the new document
      notifyAllMembers({
        type: "document",
        title: `New document: ${input.title}`,
        message: input.description
          ? input.description.length > 120 ? input.description.slice(0, 120) + "…" : input.description
          : `A new document has been added to Forms & Documents.`,
        excludeUserId: ctx.user.id,
      });
      return doc;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateDocument(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteDocument(input.id);
      return { success: true };
    }),

  uploadFile: adminProcedure
    .input(
      z.object({
        fileName: z.string(),
        mimeType: z.string(),
        base64: z.string(),
        fileSizeBytes: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.base64, "base64");
      const key = `documents/${Date.now()}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { key: storedKey, url } = await storagePut(key, buffer, input.mimeType);
      return { fileKey: storedKey, fileUrl: url, fileName: input.fileName };
    }),
});

// ─── Invites ────────────────────────────────────────────────────────────────────────────────
const invitesRouter = router({
  // Admin: create a new invite token and send it via email
  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        note: z.string().optional(),
        origin: z.string(), // window.location.origin from frontend
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { randomBytes } = await import("crypto");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await createInviteToken({
        token,
        email: input.email,
        note: input.note,
        createdBy: ctx.user.id,
        expiresAt,
      });

      // Prefer the server's own configured origin so every invite carries the
      // same URL regardless of which admin sent it, or what host their browser
      // happened to be on. Falls back to the client's origin for local dev,
      // where APP_URL is usually unset.
      const origin = (ENV.appUrl || input.origin).replace(/\/$/, "");
      const inviteUrl = `${origin}/invite/${token}`;

      // Send the invite email
      const { sendEmail, buildInviteEmail } = await import("./email");
      const emailContent = buildInviteEmail(inviteUrl, expiresAt);
      const emailSent = await sendEmail({ to: input.email, ...emailContent });

      return { token, inviteUrl, expiresAt, emailSent };
    }),

  // Public: look up an invite token (for the landing page)
  get: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      const now = new Date();
      if (invite.expiresAt < now) throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
      if (invite.usedAt) throw new TRPCError({ code: "CONFLICT", message: "This invite has already been used" });
      return {
        token: invite.token,
        email: invite.email,
        emailVerifiedAt: invite.emailVerifiedAt,
        expiresAt: invite.expiresAt,
        codeExpiresAt: invite.codeExpiresAt ?? null,
      };
    }),

  // Public: send a 6-digit OTP to the invite email address
  sendCode: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      const now = new Date();
      if (invite.expiresAt < now) throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
      if (invite.usedAt) throw new TRPCError({ code: "CONFLICT", message: "This invite has already been used" });

      // Rate-limit: don't allow resend within 60 seconds
      if (invite.codeExpiresAt) {
        const codeAge = now.getTime() - (invite.codeExpiresAt.getTime() - 30 * 60 * 1000);
        if (codeAge < 60_000) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait 60 seconds before requesting another code" });
        }
      }

      // Generate a 6-digit numeric OTP
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const codeExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
      await saveInviteOtp(input.token, code, codeExpiresAt);

      // Send the verification code email
      const { sendEmail } = await import("./email");
      const fromName = process.env.EMAIL_FROM_NAME || "Bundaberg Voice Collective";
      await sendEmail({
        to: invite.email,
        subject: `Your verification code — ${fromName}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1a1a1a">Verify your email address</h2>
            <p style="color:#444">To complete your membership invitation, enter this code on the verification page:</p>
            <div style="background:#f4f4f4;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
              <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#1a1a1a">${code}</span>
            </div>
            <p style="color:#888;font-size:14px">This code expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
        text: `Your verification code is: ${code}\n\nThis code expires in 30 minutes.`,
      });

      return { ok: true, expiresAt: codeExpiresAt };
    }),

  // Public: verify the OTP code — marks emailVerifiedAt on success
  verifyCode: publicProcedure
    .input(z.object({ token: z.string(), code: z.string().length(6) }))
    .mutation(async ({ input }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      const now = new Date();
      if (invite.expiresAt < now) throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
      if (invite.usedAt) throw new TRPCError({ code: "CONFLICT", message: "This invite has already been used" });
      if (!invite.emailVerificationCode || !invite.codeExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No verification code found. Please request a new code." });
      }
      if (invite.codeExpiresAt < now) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This code has expired. Please request a new one." });
      }
      if (invite.emailVerificationCode !== input.code) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Incorrect code. Please check your email and try again." });
      }
      await markInviteEmailVerified(input.token);
      return { ok: true };
    }),

  // Legacy alias kept for backwards compatibility
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string(), email: z.string().email() }))
    .mutation(async ({ input }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      if (invite.email.toLowerCase() !== input.email.toLowerCase()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Email address does not match the invite." });
      }
      await markInviteEmailVerified(input.token);
      return { ok: true };
    }),

  // Protected: mark invite as used after successful login (called after email verified + OAuth)
  accept: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const invite = await getInviteByToken(input.token);
      if (!invite) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      if (invite.usedAt) return { ok: true }; // idempotent — already accepted
      if (!invite.emailVerifiedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please verify your email address first." });
      }
      await markInviteUsed(input.token, ctx.user.id);
      return { ok: true };
    }),

  // Admin: list all invites
  list: adminProcedure.query(() => listInvites()),
});

// ─── Calendar ────────────────────────────────────────────────────────────────

const calendarRouter = router({
  events: protectedProcedure.query(async ({ ctx }) => {
    const isAdmin = ctx.user.role === "admin";
    const [allSessions, allStreams, allMembers, allPerformances] = await Promise.all([
      listSessions(),
      listLiveStreams(),
      isAdmin ? getAllMembers() : Promise.resolve([]),
      listEvents(),
    ]);

    const rehearsals = allSessions.map((s) => ({
      id: `rehearsal-${s.id}`,
      type: "rehearsal" as const,
      title: s.title,
      date: (s.sessionDate instanceof Date ? s.sessionDate : new Date(s.sessionDate)).toISOString(),
      notes: s.notes ?? undefined,
    }));

    const streams = allStreams.map((s) => ({
      id: `stream-${s.id}`,
      type: "stream" as const,
      title: s.title,
      date: (s.scheduledAt instanceof Date ? s.scheduledAt : new Date(s.scheduledAt)).toISOString(),
      notes: s.description ?? undefined,
    }));

    // Birthdays: admin-only — members do not see other members' birthdays
    const now = new Date();
    const birthdays: Array<{ id: string; type: "birthday"; title: string; date: string; notes?: string }> = [];
    if (isAdmin) {
      for (const m of allMembers) {
        const dob = (m as any).dateOfBirth as string | null;
        if (!dob) continue;
        const dobDate = new Date(dob);
        if (isNaN(dobDate.getTime())) continue;
        const name = getDisplayName({ firstName: (m as any).firstName, lastName: (m as any).lastName, name: (m as any).name, email: (m as any).email }, `Member #${(m as any).id}`);
        for (const yr of [now.getFullYear(), now.getFullYear() + 1]) {
          const bday = new Date(yr, dobDate.getMonth(), dobDate.getDate());
          birthdays.push({
            id: `birthday-${(m as any).id}-${yr}`,
            type: "birthday" as const,
            title: `${name}'s Birthday`,
            date: bday.toISOString(),
          });
        }
      }
    }

    const performances = allPerformances.map((e) => ({
      id: `performance-${e.id}`,
      type: "performance" as const,
      title: e.title,
      date: (e.eventDate instanceof Date ? e.eventDate : new Date(e.eventDate)).toISOString(),
      notes: e.description ?? undefined,
      location: e.location ?? undefined,
      category: e.category,
    }));

    return [...rehearsals, ...streams, ...birthdays, ...performances];
  }),
});

// ─── Shop ────────────────────────────────────────────────────────────────────
const shopRouter = router({
  // Public: list active products
  listProducts: protectedProcedure.query(() => listShopProducts(false)),

  // Admin: list all products including inactive
  adminListProducts: adminProcedure.query(() => listShopProducts(true)),

  // Get product with variants
  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => getShopProductWithVariants(input.id)),

  // Admin: create product
  createProduct: adminProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      imageKey: z.string().optional(),
      imageUrl: z.string().optional(),
      priceCents: z.number().int().positive(),
      category: z.string().default("general"),
      stock: z.number().int().min(0).default(0),
      variants: z.array(z.object({ label: z.string(), stock: z.number().int().min(0) })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { variants, ...productData } = input;
      const result = await createShopProduct({ ...productData, createdBy: ctx.user.id });
      const productId = (result as any).insertId as number;
      if (variants && variants.length > 0) {
        await setShopProductVariants(productId, variants);
      }
      return { id: productId };
    }),

  // Admin: update product
  updateProduct: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      imageKey: z.string().optional(),
      imageUrl: z.string().optional(),
      priceCents: z.number().int().positive().optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional(),
      stock: z.number().int().min(0).optional(),
      variants: z.array(z.object({ label: z.string(), stock: z.number().int().min(0) })).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, variants, ...data } = input;
      await updateShopProduct(id, data);
      if (variants !== undefined) {
        await setShopProductVariants(id, variants);
      }
    }),

  // Admin: delete product
  deleteProduct: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => deleteShopProduct(input.id)),

  // Admin: upload product image
  uploadProductImage: adminProcedure
    .input(z.object({
      productId: z.number(),
      fileBase64: z.string(),
      mimeType: z.string(),
      fileName: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const key = `shop-products/${input.productId}-${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      await updateShopProduct(input.productId, { imageKey: key, imageUrl: url });
      return { imageUrl: url };
    }),

  // Member: create checkout session for cart
  createCheckout: protectedProcedure
    .input(z.object({
      items: z.array(z.object({
        productId: z.number(),
        variantId: z.number().optional(),
        quantity: z.number().int().positive(),
        priceCents: z.number().int().positive(),
        productName: z.string(),
        variantLabel: z.string().optional(),
      })),
      origin: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const totalCents = input.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
      const lineItems = input.items.map((item) => ({
        price_data: {
          currency: "aud",
          product_data: { name: item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName },
          unit_amount: item.priceCents,
        },
        quantity: item.quantity,
      }));
      const shopRefId = `shop-${ctx.user.id}-${Date.now()}`;
      const itemSummary = input.items.map((i) => i.productName).join(", ");
      const squareShopLink = await createSquarePaymentLink({
        name: itemSummary.length > 100 ? itemSummary.substring(0, 97) + "..." : itemSummary,
        amountCents: totalCents,
        currency: "AUD",
        redirectUrl: `${input.origin}/shop/success`,
        referenceId: shopRefId,
        note: `purchase_type:shop_order|user_id:${ctx.user.id}`,
      });
      // Pre-create the order in pending state
      await createShopOrder({
        userId: ctx.user.id,
        paymentSessionId: squareShopLink.orderId,
        totalCents,
        items: input.items,
      });
      return { checkoutUrl: squareShopLink.url };
    }),

  // Member: my orders
  myOrders: protectedProcedure.query(({ ctx }) => getShopOrdersByUser(ctx.user.id)),

  // Admin: all orders
  adminOrders: adminProcedure.query(() => getAllShopOrders()),
});

export const appRouter = router({
  ...coreRouter._def.procedures,
  events: eventsRouter,
  groups: groupsRouter,
  invites: invitesRouter,
  liveStreams: liveStreamsRouter,
  documents: documentsRouter,
  calendar: calendarRouter,
  recordings: router({
    // List all recordings (admin sees all; members see only their accessible ones)
    list: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role === "admin") {
        return listAllRehearsalRecordings();
      }
      return listAccessibleRehearsalRecordings(ctx.user.id);
    }),

    // Prepare a short-lived direct-to-storage upload. The video never travels
    // through the app server, so an upload cannot be lost after browser transfer.
    prepareUpload: adminProcedure
      .input(z.object({
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(150),
      }))
      .mutation(async ({ input }) => {
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        return storagePrepareUpload(`rehearsal-recordings/${Date.now()}-${safeName}`);
      }),

    // Persist metadata only after the browser has received a successful response
    // from the direct storage upload.
    completeUpload: adminProcedure
      .input(z.object({
        key: z.string().min(1).max(500),
        sessionId: z.number().int().positive().optional(),
        customSessionTitle: z.string().max(255).optional(),
        customSessionDate: z.string().max(30).optional(),
        title: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        durationSeconds: z.number().int().positive().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!input.key.startsWith("rehearsal-recordings/")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid recording storage key" });
        }
        let sessionId = input.sessionId;
        if (!sessionId) {
          if (!input.customSessionTitle?.trim() || !input.customSessionDate) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Select a rehearsal session or enter a custom session title and date" });
          }
          const sessionDate = new Date(`${input.customSessionDate}T12:00:00`);
          if (Number.isNaN(sessionDate.getTime())) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Custom session date is invalid" });
          }
          const customSession = await createSession({
            title: input.customSessionTitle.trim(),
            sessionDate,
            notes: "Created while uploading a rehearsal recording.",
            createdBy: ctx.user.id,
          });
          if (!customSession?.id) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the custom rehearsal session" });
          }
          sessionId = customSession.id;
        }
        const recording = await createRehearsalRecording({
          sessionId,
          title: input.title.trim(),
          description: input.description?.trim() || undefined,
          fileKey: input.key,
          fileUrl: `/manus-storage/${input.key}`,
          durationSeconds: input.durationSeconds,
          uploadedBy: ctx.user.id,
        });
        if (!recording?.id || !recording.fileUrl) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Recording metadata could not be saved" });
        }
        return recording;
      }),

    // Upload a new recording (admin only)
    upload: protectedProcedure
      .input(
        z.object({
          sessionId: z.number().int().positive(),
          title: z.string().min(1).max(255),
          description: z.string().optional(),
          fileBase64: z.string(),
          fileName: z.string(),
          mimeType: z.string(),
          durationSeconds: z.number().int().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new Error("Forbidden");
        const buffer = Buffer.from(input.fileBase64, "base64");
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const key = `rehearsal-recordings/${input.sessionId}-${Date.now()}-${safeName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        const recording = await createRehearsalRecording({
          sessionId: input.sessionId,
          title: input.title,
          description: input.description,
          fileKey: key,
          fileUrl: url,
          durationSeconds: input.durationSeconds,
          uploadedBy: ctx.user.id,
        });
        return recording;
      }),

    // Delete a recording (admin only)
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new Error("Forbidden");
        await deleteRehearsalRecording(input.id);
        return { success: true };
      }),
    }),
  shop: shopRouter,

  gallery: router({
    // Upload photos/videos (all members, up to 10 per post)
    upload: protectedProcedure
      .input(
        z.object({
          files: z.array(
            z.object({
              fileBase64: z.string(),
              mimeType: z.string(),
            })
          ).min(1).max(10),
          caption: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Upload all files to S3 in parallel
        const uploaded = await Promise.all(
          input.files.map(async (f, i) => {
            const buffer = Buffer.from(f.fileBase64, "base64");
            const ext = f.mimeType.split("/")[1] ?? "bin";
            const key = `gallery/${ctx.user.id}-${Date.now()}-${i}.${ext}`;
            const { url } = await storagePut(key, buffer, f.mimeType);
            return { url, key, mimeType: f.mimeType, sortOrder: i };
          })
        );

        // Use the first file as the legacy imageUrl/imageKey on the post row
        const first = uploaded[0];
        const post = await createGalleryPost({
          userId: ctx.user.id,
          imageUrl: first.url,
          imageKey: first.key,
          caption: input.caption ?? null,
          status: "approved",
        });

        // Insert all files into gallery_media
        if (post?.insertId) {
          const postId = Number(post.insertId);
          await insertGalleryMedia(
            uploaded.map((u) => ({
              postId,
              mediaUrl: u.url,
              mediaKey: u.key,
              mimeType: u.mimeType,
              sortOrder: u.sortOrder,
            }))
          );
        }

        return { status: "approved" };
      }),

    // List approved posts (all members)
    list: protectedProcedure.query(({ ctx }) =>
      listApprovedGalleryPosts(ctx.user.id)
    ),

    // List my pending posts (for the uploader to see their own pending)
    myPending: protectedProcedure.query(({ ctx }) =>
      listMyPendingGalleryPosts(ctx.user.id)
    ),

    // Admin: list pending posts for approval
    pendingList: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return listPendingGalleryPosts();
    }),

    // Admin: approve a post
    approve: protectedProcedure
      .input(z.object({ postId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        await updateGalleryPostStatus(input.postId, "approved");
        return { success: true };
      }),

    // Admin: reject a post
    reject: protectedProcedure
      .input(z.object({ postId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
        await updateGalleryPostStatus(input.postId, "rejected");
        return { success: true };
      }),

    // Delete a post (admin or post owner)
    delete: protectedProcedure
      .input(z.object({ postId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const post = await getGalleryPost(input.postId);
        if (!post) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && post.userId !== ctx.user.id)
          throw new TRPCError({ code: "FORBIDDEN" });
        await deleteGalleryPost(input.postId);
        return { success: true };
      }),

    // React to a post (like or love)
    react: protectedProcedure
      .input(z.object({ postId: z.number().int().positive(), type: z.enum(["like", "love"]) }))
      .mutation(({ ctx, input }) =>
        upsertGalleryReaction(input.postId, ctx.user.id, input.type)
      ),

    // Add a comment (or reply)
    addComment: protectedProcedure
      .input(
        z.object({
          postId: z.number().int().positive(),
          body: z.string().min(1).max(1000),
          parentId: z.number().int().positive().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        addGalleryComment({
          postId: input.postId,
          userId: ctx.user.id,
          parentId: input.parentId ?? null,
          body: input.body,
        })
      ),

    // List comments for a post
    listComments: protectedProcedure
      .input(z.object({ postId: z.number().int().positive() }))
      .query(({ input }) => listGalleryComments(input.postId)),

    // Delete a comment (admin or comment owner)
    deleteComment: protectedProcedure
      .input(z.object({ commentId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const comment = await getGalleryComment(input.commentId);
        if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
        if (ctx.user.role !== "admin" && comment.userId !== ctx.user.id)
          throw new TRPCError({ code: "FORBIDDEN" });
        await deleteGalleryComment(input.commentId);
        return { success: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
