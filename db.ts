import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  announcementReads,
  announcements,
  attendance,
  directMessages,
  eventRsvps,
  events,
  groupMembers,
  groupMessages,
  groups,
  conversations,
  conversationParticipants,
  conversationMessages,
  inviteTokens,
  libraryItems,
  liveStreamAccess,
  liveStreams,
  notifications,
  passOrders,
  passes,
  documents,
  sessions,
  users,
  shopProducts,
  shopProductVariants,
  shopOrders,
  shopOrderItems,
  rehearsalRecordings,
  rehearsalRecordingAccess,
  galleryPosts,
  galleryReactions,
  galleryComments,
  galleryMedia,
  userActivityLog,
} from "./drizzle/schema";
import { ENV } from "./_core/env";
import { calculateSessionAttendanceStats } from "./attendanceStats";

// Synchronous singleton initialised at module load (DATABASE_URL must be set before import)
function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return drizzle(process.env.DATABASE_URL);
}

export const db = createDb();

/** @deprecated use the `db` named export directly */
export async function getDb() {
  return db;
}

/**
 * Matches a member by email address, ignoring case and surrounding whitespace.
 *
 * Every write normalises the address before storing it, but the rows imported
 * from Manus were not written by this code, and an address stored as
 * "Mclucas.Andy@gmail.com" or with a stray leading space does not equal the
 * lowercased, trimmed value a sign-in form produces. An exact comparison then
 * fails in three places at once: the member cannot sign in, cannot get a reset
 * link, and — worst — the duplicate checks in registration and admin
 * member-creation miss them, so a second account gets made on the same real
 * address with their pass and attendance history stranded on the first.
 *
 * Whether the collation makes the comparison case sensitive depends on the
 * server (TiDB and MySQL differ on the default), which is exactly why this does
 * not rely on it. Addresses are case-insensitive in practice regardless, so
 * normalising both sides is the correct comparison either way, and it handles
 * the whitespace case that no collation would.
 *
 * There is no index on users.email, so nothing is lost by wrapping the column.
 */
export function sameEmail(value: string) {
  return sql`lower(trim(${users.email})) = ${value.toLowerCase().trim()}`;
}

// ─── Activity Log ────────────────────────────────────────────────────────────

/**
 * Write an audit log entry for a member's account.
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function logActivity(data: {
  userId: number;
  actorId?: number | null;
  action: "attendance_marked" | "attendance_unmarked" | "pass_purchased" | "pass_credited" | "pass_deducted" | "pass_adjusted" | "comp_granted" | "cash_payment" | "pass_restored" | "pass_expired" | "pass_online_purchase" | "pass_manual_activated" | "role_changed" | "member_deleted" | "member_created" | "receipt_resent";
  detail?: string;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
}) {
  try {
    if (!db) return;
    await db.insert(userActivityLog).values({
      userId: data.userId,
      actorId: data.actorId ?? null,
      action: data.action,
      detail: data.detail ?? null,
      balanceBefore: data.balanceBefore ?? null,
      balanceAfter: data.balanceAfter ?? null,
    });
  } catch (err) {
    console.error("[logActivity] failed:", err);
  }
}

export async function getActivityLogForUser(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: userActivityLog.id,
      userId: userActivityLog.userId,
      actorId: userActivityLog.actorId,
      action: userActivityLog.action,
      detail: userActivityLog.detail,
      balanceBefore: userActivityLog.balanceBefore,
      balanceAfter: userActivityLog.balanceAfter,
      createdAt: userActivityLog.createdAt,
      actorName: users.name,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
    })
    .from(userActivityLog)
    .leftJoin(users, eq(userActivityLog.actorId, users.id))
    .where(eq(userActivityLog.userId, userId))
    .orderBy(desc(userActivityLog.createdAt))
    .limit(200);
}

export async function getGlobalActivityLog(limit = 500) {
  if (!db) return [];
  // alias tables for subject vs actor joins
  const subjectUsers = users;
  const actorAlias = {
    name: users.name,
    firstName: users.firstName,
    lastName: users.lastName,
  };
  // We need two joins: one for the subject user, one for the actor user.
  // Drizzle doesn't support aliased joins easily, so we do a raw-ish approach:
  // fetch log + subject info, then fetch actor info separately in JS.
  const rows = await db
    .select({
      id: userActivityLog.id,
      userId: userActivityLog.userId,
      actorId: userActivityLog.actorId,
      action: userActivityLog.action,
      detail: userActivityLog.detail,
      balanceBefore: userActivityLog.balanceBefore,
      balanceAfter: userActivityLog.balanceAfter,
      createdAt: userActivityLog.createdAt,
      subjectName: users.name,
      subjectFirstName: users.firstName,
      subjectLastName: users.lastName,
    })
    .from(userActivityLog)
    .leftJoin(users, eq(userActivityLog.userId, users.id))
    .orderBy(desc(userActivityLog.createdAt))
    .limit(limit);
  return rows;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];
  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };
  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    // Only set admin role on the INSERT path (new user), never overwrite on UPDATE.
    // This prevents the owner's openId from re-promoting a manually demoted account.
    values.role = "admin";
    // Intentionally NOT added to updateSet — existing rows keep their current role.
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function updateLastSignedIn(openId: string, lastSignedIn: Date): Promise<void> {
  if (!db) return;
  await db.update(users).set({ lastSignedIn }).where(eq(users.openId, openId));
}

export async function getUserByOpenId(openId: string) {
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllMembers() {
  if (!db) return [];
  // Exclude pending and denied users — only show active (approved) members
  // Left-join the active pass so we can show remainingSessions in the admin table
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
      address: users.address,
      dateOfBirth: users.dateOfBirth,
      allergens: users.allergens,
      avatarUrl: users.avatarUrl,
      memberSince: users.memberSince,
      createdAt: users.createdAt,
      voicePart: users.voicePart,
      singingExperience: users.singingExperience,
      status: users.status,
      remainingSessions: passes.remainingSessions,
      totalSessions: passes.totalSessions,
    })
    .from(users)
    .leftJoin(passes, and(eq(passes.userId, users.id), eq(passes.active, true)))
    .where(and(ne(users.status, "pending"), ne(users.status, "denied")))
    .orderBy(users.firstName, users.lastName, users.name);

  // An exhausted pass is set inactive when its balance reaches zero. Hydrate those
  // members with their latest exhausted balance so the Members page and dashboard
  // consistently display 0 rather than an empty pass value. Members who later
  // receive an active pass continue to use that active pass instead.
  const memberIdsWithoutActivePass = rows
    .filter((row) => row.remainingSessions === null)
    .map((row) => row.id);
  const latestExhaustedPasses = memberIdsWithoutActivePass.length > 0
    ? await db
        .select({
          userId: passes.userId,
          totalSessions: passes.totalSessions,
          remainingSessions: passes.remainingSessions,
          assignedAt: passes.assignedAt,
          id: passes.id,
        })
        .from(passes)
        .where(
          and(
            inArray(passes.userId, memberIdsWithoutActivePass),
            eq(passes.remainingSessions, 0)
          )
        )
        .orderBy(desc(passes.assignedAt), desc(passes.id))
    : [];
  const exhaustedPassByUser = new Map<number, { totalSessions: number; remainingSessions: number }>();
  for (const pass of latestExhaustedPasses) {
    if (!exhaustedPassByUser.has(pass.userId)) {
      exhaustedPassByUser.set(pass.userId, {
        totalSessions: pass.totalSessions,
        remainingSessions: pass.remainingSessions,
      });
    }
  }
  const rowsWithCurrentBalance = rows.map((row) => {
    const exhaustedPass = exhaustedPassByUser.get(row.id);
    return exhaustedPass
      ? { ...row, totalSessions: exhaustedPass.totalSessions, remainingSessions: exhaustedPass.remainingSessions }
      : row;
  });

  // Fetch attendance counts and live stream access counts in two efficient queries
  const memberIds = rows.map((r) => r.id);
  if (memberIds.length === 0) return rows.map((r) => ({ ...r, sessionsAttended: 0 }));

  const attendanceCounts = await db
    .select({ userId: attendance.userId, count: sql<number>`COUNT(*)` })
    .from(attendance)
    .where(and(eq(attendance.attended, true), sql`${attendance.userId} IN (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`))  
    .groupBy(attendance.userId);

  const streamCounts = await db
    .select({ userId: liveStreamAccess.userId, count: sql<number>`COUNT(*)` })
    .from(liveStreamAccess)
    .where(sql`${liveStreamAccess.userId} IN (${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`)
    .groupBy(liveStreamAccess.userId);

  const attendanceMap = new Map(attendanceCounts.map((r) => [r.userId, Number(r.count)]));
  const streamMap = new Map(streamCounts.map((r) => [r.userId, Number(r.count)]));

  return rowsWithCurrentBalance.map((r) => ({
    ...r,
    sessionsAttended: (attendanceMap.get(r.id) ?? 0) + (streamMap.get(r.id) ?? 0),
  }));
}

/** Returns id + name fields for use in DM member picker — no sensitive fields exposed */
export async function getMembersForDM(): Promise<{ id: number; name: string | null; firstName: string | null; lastName: string | null; email: string | null; avatarUrl: string | null }[]> {
  if (!db) return [];
  // Exclude pending and denied users from DM picker
  const rows = await db.select({ id: users.id, name: users.name, firstName: users.firstName, lastName: users.lastName, email: users.email, avatarUrl: users.avatarUrl }).from(users).where(and(ne(users.status, "pending"), ne(users.status, "denied"))).orderBy(users.firstName, users.lastName, users.name);
  return rows;
}

/** Returns all admin users for sending admin-targeted in-app notifications */
export async function getAdminUsers(): Promise<{ id: number; name: string | null; email: string | null }[]> {
  if (!db) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.role, "admin"));
  return rows;
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  if (!db) return;
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function updateUserStatus(userId: number, status: "pending" | "active" | "denied") {
  if (!db) return;
  await db.update(users).set({ status }).where(eq(users.id, userId));
}

export async function getPendingMembers() {
  if (!db) return [];
  return db.select().from(users).where(eq(users.status, "pending")).orderBy(users.createdAt);
}

export async function updateUserProfile(
  userId: number,
  data: Partial<{
    firstName: string;
    lastName: string;
    phone: string;
    address: string;
    dateOfBirth: string;
    allergens: string;
    name: string;
    avatarUrl: string;
    voicePart: "soprano1" | "soprano2" | "altoHigh" | "altoLow" | "tenor" | "bass";
    memberSince: string; // YYYY-MM
    singingExperience: "beginner" | "some_experience" | "intermediate" | "advanced" | "professional";
  }>
) {
  if (!db) throw new Error("DB unavailable");
  // Derive name from firstName + lastName if both provided
  const updates: Record<string, unknown> = { ...data };
  if (data.firstName !== undefined || data.lastName !== undefined) {
    const current = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const existing = current[0];
    const first = data.firstName ?? existing?.firstName ?? "";
    const last = data.lastName ?? existing?.lastName ?? "";
    updates.name = `${first} ${last}`.trim() || existing?.name || null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.update(users).set(updates as any).where(eq(users.id, userId));
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(data: {
  title: string;
  sessionDate: Date;
  notes?: string;
  createdBy: number;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(sessions).values(data);
  const result = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.id))
    .limit(1);
  return result[0];
}

export async function listSessions() {
  if (!db) return [];
  return db.select().from(sessions).orderBy(desc(sessions.sessionDate));
}

export async function deleteSession(sessionId: number) {
  if (!db) return;
  await db.delete(attendance).where(eq(attendance.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function getAttendanceForSession(sessionId: number) {
  if (!db) return [];
  return db
    .select({
      id: attendance.id,
      sessionId: attendance.sessionId,
      userId: attendance.userId,
      attended: attendance.attended,
      passUsed: attendance.passUsed,
      sessionType: attendance.sessionType,
      markedAt: attendance.markedAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(attendance)
    .leftJoin(users, eq(attendance.userId, users.id))
    .where(eq(attendance.sessionId, sessionId));
}

export async function getAttendanceForUser(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: attendance.id,
      sessionId: attendance.sessionId,
      attended: attendance.attended,
      passUsed: attendance.passUsed,
      sessionType: attendance.sessionType,
      markedAt: attendance.markedAt,
      sessionTitle: sessions.title,
      sessionDate: sessions.sessionDate,
    })
    .from(attendance)
    .leftJoin(sessions, eq(attendance.sessionId, sessions.id))
    .where(and(eq(attendance.userId, userId), eq(attendance.attended, true)))
    .orderBy(desc(sessions.sessionDate));
}

export async function upsertAttendance(
  sessionId: number,
  userId: number,
  attended: boolean,
  passUsed: boolean,
  sessionType: "pass" | "single" | "complimentary" | "online" = "pass"
) {
  if (!db) throw new Error("DB unavailable");

  // Check if record exists
  const existing = await db
    .select()
    .from(attendance)
    .where(
      and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId))
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(attendance)
      .set({ attended, passUsed, sessionType, markedAt: new Date() })
      .where(
        and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId))
      );
    return existing[0];
  } else {
    await db.insert(attendance).values({
      sessionId,
      userId,
      attended,
      passUsed,
      sessionType,
      markedAt: new Date(),
    });
    const result = await db
      .select()
      .from(attendance)
      .where(
        and(eq(attendance.sessionId, sessionId), eq(attendance.userId, userId))
      )
      .limit(1);
    return result[0];
  }
}

/**
 * Adds a member who has actually joined a live rehearsal to the same-date
 * weekly attendance register. The relevant pass or single-session payment
 * has already unlocked access, so this action never deducts a second session.
 */
export async function registerLiveStreamAttendance(streamId: number, userId: number) {
  if (!db) throw new Error("DB unavailable");

  const streamRows = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId)).limit(1);
  const stream = streamRows[0];
  if (!stream) throw new Error("Live stream not found");

  const streamDate = stream.scheduledAt.toISOString().slice(0, 10);
  const sessionRows = await db
    .select({ id: sessions.id, title: sessions.title })
    .from(sessions)
    .where(sql`DATE(${sessions.sessionDate}) = ${streamDate}`)
    .orderBy(desc(sessions.sessionDate))
    .limit(1);
  const session = sessionRows[0];
  if (!session) return { recorded: false, reason: "no_matching_session" as const };

  const existingRows = await db
    .select()
    .from(attendance)
    .where(and(eq(attendance.sessionId, session.id), eq(attendance.userId, userId)))
    .limit(1);
  const existing = existingRows[0];
  if (existing?.attended) {
    return { recorded: false, alreadyAttended: true, sessionId: session.id };
  }

  await upsertAttendance(session.id, userId, true, false, "online");
  await logActivity({
    userId,
    actorId: userId,
    action: "attendance_marked",
    detail: `Joined live rehearsal: ${stream.title}. Attendance recorded without an additional pass deduction.`,
  });

  return { recorded: true, sessionId: session.id, sessionTitle: session.title };
}

// Returns attendance count + pass-type breakdown for the most recent session
export async function getLastSessionStats() {
  if (!db) return null;

  // Get the most recent session
  const lastSession = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.sessionDate))
    .limit(1);
  if (lastSession.length === 0) return null;

  const sess = lastSession[0];

  // Count attendees grouped by sessionType
  const rows = await db
    .select({
      userId: attendance.userId,
      sessionType: attendance.sessionType,
    })
    .from(attendance)
    .where(and(eq(attendance.sessionId, sess.id), eq(attendance.attended, true)));

  const onlineRows = await db
    .select({ userId: liveStreamAccess.userId })
    .from(liveStreamAccess)
    .innerJoin(liveStreams, eq(liveStreamAccess.streamId, liveStreams.id))
    .where(and(
      sql`DATE(${liveStreams.scheduledAt}) = DATE(${sess.sessionDate})`,
      sql`${liveStreamAccess.grantedAt} >= DATE_SUB(${liveStreams.scheduledAt}, INTERVAL 1 HOUR)`,
      sql`${liveStreamAccess.grantedAt} <= COALESCE(${liveStreams.endsAt}, DATE_ADD(${liveStreams.scheduledAt}, INTERVAL 3 HOUR))`,
    ));

  const stats = calculateSessionAttendanceStats(rows, onlineRows);

  return {
    sessionId: sess.id,
    sessionTitle: sess.title,
    sessionDate: sess.sessionDate,
    ...stats,
  };
}

// Returns per-session attendance breakdown for admin stats view
export async function getSessionStats(sessionId: number) {
  if (!db) return null;

  const sess = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (sess.length === 0) return null;

  const rows = await db
    .select({ userId: attendance.userId, sessionType: attendance.sessionType })
    .from(attendance)
    .where(and(eq(attendance.sessionId, sessionId), eq(attendance.attended, true)));

  const onlineRows = await db
    .select({ userId: liveStreamAccess.userId })
    .from(liveStreamAccess)
    .innerJoin(liveStreams, eq(liveStreamAccess.streamId, liveStreams.id))
    .where(and(
      sql`DATE(${liveStreams.scheduledAt}) = DATE(${sess[0].sessionDate})`,
      sql`${liveStreamAccess.grantedAt} >= DATE_SUB(${liveStreams.scheduledAt}, INTERVAL 1 HOUR)`,
      sql`${liveStreamAccess.grantedAt} <= COALESCE(${liveStreams.endsAt}, DATE_ADD(${liveStreams.scheduledAt}, INTERVAL 3 HOUR))`,
    ));

  const stats = calculateSessionAttendanceStats(rows, onlineRows);

  return {
    sessionId,
    sessionTitle: sess[0].title,
    sessionDate: sess[0].sessionDate,
    ...stats,
  };
}

// ─── Passes ───────────────────────────────────────────────────────────────────

export async function getActivePassForUser(userId: number) {
  if (!db) return null;
  const result = await db
    .select()
    .from(passes)
    .where(and(eq(passes.userId, userId), eq(passes.active, true)))
    .orderBy(desc(passes.assignedAt))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllPassesForUser(userId: number) {
  if (!db) return [];
  return db
    .select()
    .from(passes)
    .where(eq(passes.userId, userId))
    .orderBy(desc(passes.assignedAt));
}

export async function assignPass(data: {
  userId: number;
  totalSessions: number;
  assignedBy: number;
  notes?: string;
}) {
  if (!db) throw new Error("DB unavailable");
  // Deactivate existing active passes
  await db
    .update(passes)
    .set({ active: false })
    .where(and(eq(passes.userId, data.userId), eq(passes.active, true)));
  // Create new pass
  await db.insert(passes).values({
    userId: data.userId,
    totalSessions: data.totalSessions,
    remainingSessions: data.totalSessions,
    assignedBy: data.assignedBy,
    active: true,
    notes: data.notes,
  });
  return getActivePassForUser(data.userId);
}

export async function topUpPass(passId: number, addSessions: number) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(passes)
    .set({
      totalSessions: sql`totalSessions + ${addSessions}`,
      remainingSessions: sql`remainingSessions + ${addSessions}`,
    })
    .where(eq(passes.id, passId));
    const result = await db.select().from(passes).where(eq(passes.id, passId)).limit(1);
  return result[0];
}

/**
 * Restore exactly one session when un-marking attendance (error correction).
 * Only increments remainingSessions — never exceeds totalSessions.
 */
export async function restorePassSession(passId: number) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(passes)
    .set({
      remainingSessions: sql`LEAST(remainingSessions + 1, totalSessions)`,
      active: true,
    })
    .where(eq(passes.id, passId));
  const result = await db.select().from(passes).where(eq(passes.id, passId)).limit(1);
  return result[0];
}

export async function setPassRemaining(passId: number, newRemaining: number, reason?: string) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(passes)
    .set({
      remainingSessions: newRemaining,
      active: newRemaining > 0,
      notes: reason ? sql`CONCAT(COALESCE(notes,''), ' | Admin adj: ', ${reason})` : undefined,
    })
    .where(eq(passes.id, passId));
  const result = await db.select().from(passes).where(eq(passes.id, passId)).limit(1);
  return result[0];
}

// Permanently delete a pass by ID (used for undo after accidental assignment)
export async function deletePassById(passId: number) {
  if (!db) throw new Error("DB unavailable");
  await db.delete(passes).where(eq(passes.id, passId));
  return { deleted: true };
}

export async function deductPassSession(userId: number): Promise<{
  pass: typeof passes.$inferSelect | null;
  newBalance: number;
}> {
  if (!db) throw new Error("DB unavailable");
  const pass = await getActivePassForUser(userId);
  if (!pass || pass.remainingSessions <= 0) return { pass: null, newBalance: 0 };

  const newBalance = pass.remainingSessions - 1;
  await db
    .update(passes)
    .set({ remainingSessions: newBalance, active: newBalance > 0 })
    .where(eq(passes.id, pass.id));

  const updated = await db.select().from(passes).where(eq(passes.id, pass.id)).limit(1);
  return { pass: updated[0], newBalance };
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function createNotification(data: {
  userId: number;
  type: "pass_low" | "announcement" | "general" | "library" | "document" | "event";
  title: string;
  message: string;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(notifications).values({ ...data, read: false });
}

/**
 * Create a notification for every active member (all users).
 * Fire-and-forget — errors are logged but not thrown.
 */
export async function notifyAllMembers(data: {
  type: "announcement" | "general" | "library" | "document" | "event";
  title: string;
  message: string;
  excludeUserId?: number;
}) {
  if (!db) return;
  try {
    const allUsers = await db.select({ id: users.id }).from(users);
    const rows = allUsers
      .filter((u) => u.id !== data.excludeUserId)
      .map((u) => ({
        userId: u.id,
        type: data.type,
        title: data.title,
        message: data.message,
        read: false,
      }));
    if (rows.length > 0) {
      await db.insert(notifications).values(rows);
    }
  } catch (err) {
    console.error("[notifyAllMembers] failed:", err);
  }
}

export async function getUnreadNotifications(userId: number) {
  if (!db) return [];
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
    .orderBy(desc(notifications.createdAt));
}

export async function getAllNotifications(userId: number) {
  if (!db) return [];
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
}

export async function markNotificationRead(notificationId: number, userId: number) {
  if (!db) return;
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  if (!db) return;
  await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
}

// ─── Announcements ────────────────────────────────────────────────────────────

export async function createAnnouncement(data: {
  title: string;
  body: string;
  category: "event" | "rehearsal" | "general";
  authorId: number;
  pinned?: boolean;
  attachmentUrl?: string;
  attachmentKey?: string;
  attachmentType?: "image" | "video" | "document";
  attachmentName?: string;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(announcements).values({ ...data, pinned: data.pinned ?? false });
  const result = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.id))
    .limit(1);
  return result[0];
}

export async function listAnnouncements() {
  if (!db) return [];
  return db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt));
}

export async function deleteAnnouncement(announcementId: number) {
  if (!db) return;
  await db.delete(announcementReads).where(eq(announcementReads.announcementId, announcementId));
  await db.delete(announcements).where(eq(announcements.id, announcementId));
}

export async function markAnnouncementRead(announcementId: number, userId: number) {
  if (!db) return;
  const existing = await db
    .select()
    .from(announcementReads)
    .where(
      and(
        eq(announcementReads.announcementId, announcementId),
        eq(announcementReads.userId, userId)
      )
    )
    .limit(1);
  if (existing.length === 0) {
    await db.insert(announcementReads).values({ announcementId, userId });
  }
}

export async function getAnnouncementViewers(announcementId: number) {
  if (!db) return [];
  const rows = await db
    .select({
      userId: announcementReads.userId,
      readAt: announcementReads.readAt,
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
    })
    .from(announcementReads)
    .leftJoin(users, eq(announcementReads.userId, users.id))
    .where(eq(announcementReads.announcementId, announcementId))
    .orderBy(announcementReads.readAt);
  return rows;
}

export async function getAnnouncementViewCount(announcementId: number): Promise<number> {
  if (!db) return 0;
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(announcementReads)
    .where(eq(announcementReads.announcementId, announcementId));
  return Number(rows[0]?.count ?? 0);
}

export async function getReadAnnouncementIds(userId: number) {
  if (!db) return [];
  const rows = await db
    .select({ announcementId: announcementReads.announcementId })
    .from(announcementReads)
    .where(eq(announcementReads.userId, userId));
  return rows.map((r) => r.announcementId);
}

export async function updateAnnouncement(
  id: number,
  data: { title?: string; body?: string; category?: "event" | "rehearsal" | "general"; pinned?: boolean; attachmentUrl?: string | null; attachmentKey?: string | null; attachmentType?: "image" | "video" | "document" | null; attachmentName?: string | null; }
) {
  if (!db) return;
  await db.update(announcements).set(data).where(eq(announcements.id, id));
}

// ─── Library ──────────────────────────────────────────────────────────────────

export async function createLibraryItem(data: {
  title: string;
  artist?: string;
  type: "sheet_music" | "backing_track";
  fileKey: string;
  fileUrl: string;
  fileName: string;
  mimeType?: string;
  uploadedBy: number;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(libraryItems).values(data);
  const result = await db
    .select()
    .from(libraryItems)
    .orderBy(desc(libraryItems.id))
    .limit(1);
  return result[0];
}

export async function listLibraryItems() {
  if (!db) return [];
  return db.select().from(libraryItems).orderBy(desc(libraryItems.createdAt));
}

export async function deleteLibraryItem(itemId: number) {
  if (!db) return;
  await db.delete(libraryItems).where(eq(libraryItems.id, itemId));
}

export async function updateLibraryItem(
  itemId: number,
  data: Partial<{
    title: string;
    artist: string | null;
    type: "sheet_music" | "backing_track" | "lyrics" | "chord_chart";
    fileKey: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
  }>
) {
  if (!db) throw new Error("DB unavailable");
  await db.update(libraryItems).set(data).where(eq(libraryItems.id, itemId));
  const [updated] = await db.select().from(libraryItems).where(eq(libraryItems.id, itemId));
  return updated;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getAdminStats() {
  if (!db) return { totalMembers: 0, totalSessions: 0, totalLibraryItems: 0, totalAnnouncements: 0 };

  const [memberCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [sessionCount] = await db.select({ count: sql<number>`count(*)` }).from(sessions);
  const [libraryCount] = await db.select({ count: sql<number>`count(*)` }).from(libraryItems);
  const [announcementCount] = await db.select({ count: sql<number>`count(*)` }).from(announcements);

  return {
    totalMembers: Number(memberCount?.count ?? 0),
    totalSessions: Number(sessionCount?.count ?? 0),
    totalLibraryItems: Number(libraryCount?.count ?? 0),
    totalAnnouncements: Number(announcementCount?.count ?? 0),
  };
}

// ─── Pass Orders (Stripe) ─────────────────────────────────────────────────────



export async function createPassOrder(data: {
  userId: number;
  stripeSessionId?: string;
  paymentSessionId?: string;
  paymentProvider?: string;
  passType: string;
  sessionCount: number;
  amountCents: number;
  currency?: string;
  paymentMethod?: "stripe" | "cash" | "square";
  notes?: string;
  status?: "pending" | "paid" | "failed" | "cancelled";
}) {
  if (!db) throw new Error("DB unavailable");
  // Support both legacy stripeSessionId and new paymentSessionId
  const sessionId = data.paymentSessionId ?? data.stripeSessionId ?? null;
  await db.insert(passOrders).values({
    userId: data.userId,
    stripeSessionId: sessionId,
    passType: data.passType,
    sessionCount: data.sessionCount,
    amountCents: data.amountCents,
    currency: data.currency ?? "aud",
    paymentMethod: (data.paymentMethod ?? (data.paymentProvider === "square" ? "square" : "stripe")) as "stripe" | "cash",
    notes: data.notes ?? null,
    status: data.status ?? "pending",
  });
  // For cash orders there is no sessionId, so fetch by userId + passType + most recent
  if (sessionId) {
    const result = await db
      .select()
      .from(passOrders)
      .where(eq(passOrders.stripeSessionId, sessionId))
      .limit(1);
    return result[0];
  }
  const result = await db
    .select()
    .from(passOrders)
    .where(eq(passOrders.userId, data.userId))
    .orderBy(desc(passOrders.createdAt))
    .limit(1);
  return result[0];
}

export async function getPassOrderByStripeSession(stripeSessionId: string) {
  if (!db) return null;
  const result = await db
    .select()
    .from(passOrders)
    .where(eq(passOrders.stripeSessionId, stripeSessionId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function updatePassOrderStatus(
  stripeSessionId: string,
  status: "pending" | "paid" | "failed" | "cancelled",
  extra?: { stripePaymentIntentId?: string; passId?: number }
) {
  if (!db) return;
  await db
    .update(passOrders)
    .set({ status, ...(extra ?? {}) })
    .where(eq(passOrders.stripeSessionId, stripeSessionId));
}

/** Marks a completed online pass order only after its receipt email has been sent. */
export async function markPassOrderReceiptSent(orderId: number) {
  if (!db) return;
  await db
    .update(passOrders)
    .set({ receiptSentAt: new Date() })
    .where(eq(passOrders.id, orderId));
}

export async function getPassOrdersForUser(userId: number) {
  if (!db) return [];
  return db
    .select()
    .from(passOrders)
    .where(eq(passOrders.userId, userId))
    .orderBy(desc(passOrders.createdAt));
}

export async function getAllPassOrders() {
  if (!db) return [];
  return db
    .select({
      id: passOrders.id,
      userId: passOrders.userId,
      stripeSessionId: passOrders.stripeSessionId,
      paymentSessionId: passOrders.paymentSessionId,
      passType: passOrders.passType,
      sessionCount: passOrders.sessionCount,
      amountCents: passOrders.amountCents,
      currency: passOrders.currency,
      status: passOrders.status,
      paymentMethod: passOrders.paymentMethod,
      notes: passOrders.notes,
      passId: passOrders.passId,
      receiptSentAt: passOrders.receiptSentAt,
      createdAt: passOrders.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(passOrders)
    .leftJoin(users, eq(passOrders.userId, users.id))
    .orderBy(desc(passOrders.createdAt));
}

/** Monthly completed Square pass purchases and receipt delivery status for administrators. */
export async function getMonthlyOnlinePassSalesSummary() {
  if (!db) return [];
  return db
    .select({
      month: sql<string>`DATE_FORMAT(${passOrders.createdAt}, '%Y-%m')`,
      purchaseCount: sql<number>`COUNT(*)`,
      revenueCents: sql<number>`COALESCE(SUM(${passOrders.amountCents}), 0)`,
      receiptsIssued: sql<number>`COALESCE(SUM(CASE WHEN ${passOrders.receiptSentAt} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
      receiptsNotIssued: sql<number>`COALESCE(SUM(CASE WHEN ${passOrders.receiptSentAt} IS NULL THEN 1 ELSE 0 END), 0)`,
    })
    .from(passOrders)
    .where(and(eq(passOrders.status, "paid"), eq(passOrders.paymentMethod, "square")))
    .groupBy(sql`DATE_FORMAT(${passOrders.createdAt}, '%Y-%m')`)
    .orderBy(sql`DATE_FORMAT(${passOrders.createdAt}, '%Y-%m') DESC`);
}

// ─── Direct Messages ─────────────────────────────────────────────────────────

export async function sendDirectMessage(fromUserId: number, toUserId: number, body: string) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(directMessages).values({ fromUserId, toUserId, body });
  const result = await db
    .select()
    .from(directMessages)
    .orderBy(desc(directMessages.id))
    .limit(1);
  return result[0];
}

export async function getConversation(userA: number, userB: number) {
  if (!db) return [];
  return db
    .select()
    .from(directMessages)
    .where(
      sql`(fromUserId = ${userA} AND toUserId = ${userB}) OR (fromUserId = ${userB} AND toUserId = ${userA})`
    )
    .orderBy(directMessages.createdAt);
}

export async function getConversationList(userId: number) {
  // Returns the most recent message per conversation partner
  if (!db) return [];

  // Get all messages involving this user
  const msgs = await db
    .select({
      id: directMessages.id,
      fromUserId: directMessages.fromUserId,
      toUserId: directMessages.toUserId,
      body: directMessages.body,
      readAt: directMessages.readAt,
      createdAt: directMessages.createdAt,
    })
    .from(directMessages)
    .where(
      sql`fromUserId = ${userId} OR toUserId = ${userId}`
    )
    .orderBy(desc(directMessages.createdAt));

  // Deduplicate by partner
  const seen = new Set<number>();
  const conversations: typeof msgs = [];
  for (const msg of msgs) {
    const partnerId = msg.fromUserId === userId ? msg.toUserId : msg.fromUserId;
    if (!seen.has(partnerId)) {
      seen.add(partnerId);
      conversations.push(msg);
    }
  }
  return conversations;
}

export async function markMessagesRead(fromUserId: number, toUserId: number) {
  if (!db) return;
  await db
    .update(directMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(directMessages.fromUserId, fromUserId),
        eq(directMessages.toUserId, toUserId),
        sql`readAt IS NULL`
      )
    );
}

export async function getUnreadMessageCount(userId: number) {
  if (!db) return 0;
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(directMessages)
    .where(
      and(
        eq(directMessages.toUserId, userId),
        sql`readAt IS NULL`
      )
    );
  return Number(result[0]?.count ?? 0);
}

// ─── Events ───────────────────────────────────────────────────────────────────



export async function createEvent(data: {
  title: string;
  description?: string;
  location?: string;
  eventDate: Date;
  endDate?: Date;
  category: "concert" | "rehearsal" | "social" | "workshop" | "other";
  createdBy: number;
  imageUrl?: string;
  imageKey?: string;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(events).values(data);
  const result = await db.select().from(events).orderBy(desc(events.id)).limit(1);
  return result[0];
}

export async function listEvents() {
  if (!db) return [];
  return db.select().from(events).orderBy(events.eventDate);
}

export async function updateEvent(
  id: number,
  data: Partial<{
    title: string;
    description: string;
    location: string;
    eventDate: Date;
    endDate: Date;
    category: "concert" | "rehearsal" | "social" | "workshop" | "other";
    imageUrl: string | null;
    imageKey: string | null;
  }>
) {
  if (!db) return;
  await db.update(events).set(data).where(eq(events.id, id));
}

export async function deleteEvent(id: number) {
  if (!db) return;
  // Delete related RSVPs first to avoid orphaned rows
  await db.delete(eventRsvps).where(eq(eventRsvps.eventId, id));
  await db.delete(events).where(eq(events.id, id));
}

// ─── Event RSVPs ─────────────────────────────────────────────────────────────

export async function upsertEventRsvp(eventId: number, userId: number, status: "attending" | "not_attending") {
  if (!db) throw new Error("DB unavailable");
  const existing = await db.select().from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(eventRsvps).set({ status }).where(eq(eventRsvps.id, existing[0].id));
  } else {
    await db.insert(eventRsvps).values({ eventId, userId, status });
  }
}

export async function getEventRsvp(eventId: number, userId: number) {
  if (!db) return null;
  const result = await db.select().from(eventRsvps)
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

export async function getEventRsvpCounts(eventId: number) {
  if (!db) return { attending: 0, not_attending: 0 };
  const rows = await db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId));
  return {
    attending: rows.filter(r => r.status === "attending").length,
    not_attending: rows.filter(r => r.status === "not_attending").length,
  };
}

export async function getEventRsvpList(eventId: number) {
  if (!db) return [];
  const rows = await db.select({
    id: eventRsvps.id,
    userId: eventRsvps.userId,
    status: eventRsvps.status,
    name: users.name,
    firstName: users.firstName,
    lastName: users.lastName,
  })
    .from(eventRsvps)
    .leftJoin(users, eq(eventRsvps.userId, users.id))
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(eventRsvps.status);
  return rows;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

export async function createGroup(data: { name: string; description?: string; createdBy: number }) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(groups).values(data);
  const result = await db.select().from(groups).orderBy(desc(groups.id)).limit(1);
  const group = result[0]!;
  // Add creator as owner
  await db.insert(groupMembers).values({
    groupId: group.id,
    userId: data.createdBy,
    role: "owner",
    status: "approved",
    joinedAt: new Date(),
  });
  return group;
}

export async function listGroups() {
  if (!db) return [];
  return db.select().from(groups).orderBy(desc(groups.createdAt));
}

export async function getGroupById(id: number) {
  if (!db) return null;
  const result = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  return result[0] ?? null;
}

export async function updateGroup(id: number, data: Partial<{ name: string; description: string }>) {
  if (!db) return;
  await db.update(groups).set(data).where(eq(groups.id, id));
}

export async function deleteGroup(id: number) {
  if (!db) return;
  await db.delete(groupMessages).where(eq(groupMessages.groupId, id));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, id));
  await db.delete(groups).where(eq(groups.id, id));
}

export async function getGroupMembers(groupId: number) {
  if (!db) return [];
  return db
    .select({
      id: groupMembers.id,
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      role: groupMembers.role,
      status: groupMembers.status,
      invitedBy: groupMembers.invitedBy,
      joinedAt: groupMembers.joinedAt,
      createdAt: groupMembers.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(groupMembers)
    .leftJoin(users, eq(groupMembers.userId, users.id))
    .where(eq(groupMembers.groupId, groupId));
}

export async function getGroupMembership(groupId: number, userId: number) {
  if (!db) return null;
  const result = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return result[0] ?? null;
}

export async function getUserGroups(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      createdBy: groups.createdBy,
      createdAt: groups.createdAt,
      role: groupMembers.role,
      status: groupMembers.status,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.status, "approved")));
}

// Admin: add a user directly as an approved member (bypasses invite flow)
export async function addGroupMemberDirectly(groupId: number, userId: number, addedBy: number) {
  if (!db) throw new Error("DB unavailable");
  const existing = await getGroupMembership(groupId, userId);
  if (existing) {
    // If already exists but not approved, promote to approved
    if (existing.status !== "approved") {
      await db
        .update(groupMembers)
        .set({ status: "approved", joinedAt: new Date() })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    }
    return;
  }
  await db.insert(groupMembers).values({
    groupId,
    userId,
    role: "member",
    status: "approved",
    invitedBy: addedBy,
    joinedAt: new Date(),
  });
}

export async function inviteToGroup(groupId: number, userId: number, invitedBy: number) {
  if (!db) throw new Error("DB unavailable");
  // Check not already a member
  const existing = await getGroupMembership(groupId, userId);
  if (existing) return existing;
  await db.insert(groupMembers).values({
    groupId,
    userId,
    role: "member",
    status: "invited",
    invitedBy,
  });
  const result = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return result[0];
}

export async function requestJoinGroup(groupId: number, userId: number) {
  if (!db) throw new Error("DB unavailable");
  const existing = await getGroupMembership(groupId, userId);
  if (existing) return existing;
  await db.insert(groupMembers).values({
    groupId,
    userId,
    role: "member",
    status: "pending",
  });
  const result = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
    .limit(1);
  return result[0];
}

export async function respondToGroupRequest(
  groupId: number,
  userId: number,
  approve: boolean
) {
  if (!db) return;
  if (approve) {
    await db
      .update(groupMembers)
      .set({ status: "approved", joinedAt: new Date() })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  } else {
    await db
      .update(groupMembers)
      .set({ status: "rejected" })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  }
}

export async function acceptGroupInvite(groupId: number, userId: number) {
  if (!db) return;
  await db
    .update(groupMembers)
    .set({ status: "approved", joinedAt: new Date() })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

export async function removeGroupMember(groupId: number, userId: number) {
  if (!db) return;
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
}

// ─── Group Messages ───────────────────────────────────────────────────────────

export async function sendGroupMessage(groupId: number, fromUserId: number, body: string) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(groupMessages).values({ groupId, fromUserId, body });
  const result = await db
    .select()
    .from(groupMessages)
    .orderBy(desc(groupMessages.id))
    .limit(1);
  return result[0];
}

export async function getGroupMessages(groupId: number, limit = 100) {
  if (!db) return [];
  return db
    .select({
      id: groupMessages.id,
      groupId: groupMessages.groupId,
      fromUserId: groupMessages.fromUserId,
      body: groupMessages.body,
      createdAt: groupMessages.createdAt,
      fromUserName: users.name,
      fromUserFirstName: users.firstName,
      fromUserLastName: users.lastName,
    })
    .from(groupMessages)
    .leftJoin(users, eq(groupMessages.fromUserId, users.id))
    .where(eq(groupMessages.groupId, groupId))
    .orderBy(groupMessages.createdAt)
    .limit(limit);
}

export async function getUserPendingInvites(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: groupMembers.id,
      groupId: groupMembers.groupId,
      groupName: groups.name,
      groupDescription: groups.description,
      status: groupMembers.status,
      invitedBy: groupMembers.invitedBy,
      createdAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.status, "invited")
      )
    );
}

// ─── Admin: Delete User (cascade) ────────────────────────────────────────────

export async function deleteUser(userId: number) {
  if (!db) throw new Error("DB unavailable");

  // Cascade: remove all user-related data before deleting the user row
  await db.delete(attendance).where(eq(attendance.userId, userId));
  await db.delete(passes).where(eq(passes.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(announcementReads).where(eq(announcementReads.userId, userId));
  await db.delete(directMessages).where(eq(directMessages.fromUserId, userId));
  await db.delete(directMessages).where(eq(directMessages.toUserId, userId));
  await db.delete(groupMembers).where(eq(groupMembers.userId, userId));
  await db.delete(eventRsvps).where(eq(eventRsvps.userId, userId));
  // Remove group messages sent by this user
  await db.delete(groupMessages).where(eq(groupMessages.fromUserId, userId));
  // Finally delete the user
  await db.delete(users).where(eq(users.id, userId));
}

// ─── Admin: Financial Members ─────────────────────────────────────────────────

export async function getFinancialMembers() {
  if (!db) return [];

  // Get all paid pass orders joined with user info, ordered by most recent first
  const rows = await db
    .select({
      userId: passOrders.userId,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
      passType: passOrders.passType,
      sessionCount: passOrders.sessionCount,
      amountCents: passOrders.amountCents,
      currency: passOrders.currency,
      status: passOrders.status,
      paymentMethod: passOrders.paymentMethod,
      notes: passOrders.notes,
      orderId: passOrders.id,
      createdAt: passOrders.createdAt,
    })
    .from(passOrders)
    .leftJoin(users, eq(passOrders.userId, users.id))
    .where(eq(passOrders.status, "paid"))
    .orderBy(desc(passOrders.createdAt));

  // Group by user: keep all orders but also surface last purchase per user
  const byUser = new Map<
    number,
    {
      userId: number;
      userName: string | null;
      userEmail: string | null;
      orders: {
        orderId: number;
        passType: string;
        sessionCount: number;
        amountCents: number;
        currency: string;
        paymentMethod: string | null;
        notes: string | null;
        createdAt: Date;
      }[];
      lastPurchaseType: string;
      lastPurchaseDate: Date;
      totalSpentCents: number;
    }
  >();

  for (const row of rows) {
    if (!row.userId) continue;
    if (!byUser.has(row.userId)) {
      byUser.set(row.userId, {
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        orders: [],
        lastPurchaseType: row.passType,
        lastPurchaseDate: row.createdAt,
        totalSpentCents: 0,
      });
    }
    const entry = byUser.get(row.userId)!;
    entry.orders.push({
        orderId: row.orderId,
        passType: row.passType,
        sessionCount: row.sessionCount,
        amountCents: row.amountCents,
        currency: row.currency,
        paymentMethod: row.paymentMethod ?? null,
        notes: row.notes ?? null,
        createdAt: row.createdAt,
      });
    entry.totalSpentCents += row.amountCents;
    // Keep the most recent as lastPurchase (rows are already desc by createdAt)
    if (row.createdAt > entry.lastPurchaseDate) {
      entry.lastPurchaseType = row.passType;
      entry.lastPurchaseDate = row.createdAt;
    }
  }

  return Array.from(byUser.values()).sort(
    (a, b) => b.lastPurchaseDate.getTime() - a.lastPurchaseDate.getTime()
  );
}

// ─── Live Stream Rehearsals ────────────────────────────────────────────────────


export async function listLiveStreams() {
  if (!db) return [];
  return db.select().from(liveStreams).orderBy(desc(liveStreams.scheduledAt));
}

export async function getLiveStreamById(id: number) {
  if (!db) return null;
  const rows = await db.select().from(liveStreams).where(eq(liveStreams.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createLiveStream(data: {
  title: string;
  description?: string;
  streamUrl: string;
  scheduledAt: Date;
  endsAt?: Date;
  createdBy: number;
}) {
  if (!db) return null;
  const [result] = await db.insert(liveStreams).values(data);
  const id = (result as { insertId: number }).insertId;
  const rows = await db.select().from(liveStreams).where(eq(liveStreams.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateLiveStream(
  id: number,
  data: Partial<{
    title: string;
    description: string;
    streamUrl: string;
    scheduledAt: Date;
    endsAt: Date | null;
  }>
) {
  if (!db) return;
  await db.update(liveStreams).set(data).where(eq(liveStreams.id, id));
}

export async function deleteLiveStream(id: number) {
  if (!db) return;
  // Cascade: remove access records first
  await db.delete(liveStreamAccess).where(eq(liveStreamAccess.streamId, id));
  await db.delete(liveStreams).where(eq(liveStreams.id, id));
}

export async function getLiveStreamAccessForUser(userId: number) {
  if (!db) return [];
  return db
    .select()
    .from(liveStreamAccess)
    .where(eq(liveStreamAccess.userId, userId));
}

export async function getLiveStreamAccessForStream(streamId: number) {
  if (!db) return [];
  return db
    .select({
      id: liveStreamAccess.id,
      streamId: liveStreamAccess.streamId,
      userId: liveStreamAccess.userId,
      accessType: liveStreamAccess.accessType,
      stripeSessionId: liveStreamAccess.stripeSessionId,
      grantedAt: liveStreamAccess.grantedAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(liveStreamAccess)
    .leftJoin(users, eq(liveStreamAccess.userId, users.id))
    .where(eq(liveStreamAccess.streamId, streamId))
    .orderBy(desc(liveStreamAccess.grantedAt));
}

export async function hasLiveStreamAccess(streamId: number, userId: number) {
  if (!db) return false;
  const rows = await db
    .select({ id: liveStreamAccess.id })
    .from(liveStreamAccess)
    .where(
      and(
        eq(liveStreamAccess.streamId, streamId),
        eq(liveStreamAccess.userId, userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function grantLiveStreamAccess(data: {
  streamId: number;
  userId: number;
  accessType: "pass" | "single_purchase";
  stripeSessionId?: string;
}) {
  if (!db) return null;
  await db.insert(liveStreamAccess).values(data);
  return true;
}

export async function getLiveStreamAccessByStripeSession(stripeSessionId: string) {
  if (!db) return null;
  const rows = await db
    .select()
    .from(liveStreamAccess)
    .where(eq(liveStreamAccess.stripeSessionId, stripeSessionId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Admin: Manual Member Creation ───────────────────────────────────────────

export async function createManualMember(data: {
  name: string;
  email: string;
  role?: "user" | "admin";
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: string;
  allergens?: string;
  voicePart?: "soprano1" | "soprano2" | "altoHigh" | "altoLow" | "tenor" | "bass";
  singingExperience?: "beginner" | "some_experience" | "intermediate" | "advanced" | "professional";
}) {
  if (!db) throw new Error("DB unavailable");
  // Use email as a synthetic openId for manually-created accounts
  const syntheticOpenId = `manual:${data.email.toLowerCase().trim()}`;
  // Check if a user with this email already exists
  const existing = await db
    .select()
    .from(users)
    .where(sameEmail(data.email))
    .limit(1);
  if (existing.length > 0) throw new Error("A member with this email already exists");
  await db.insert(users).values({
    openId: syntheticOpenId,
    name: data.name.trim(),
    email: data.email.toLowerCase().trim(),
    loginMethod: "manual",
    role: data.role ?? "user",
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    phone: data.phone ?? null,
    address: data.address ?? null,
    dateOfBirth: data.dateOfBirth ?? null,
    allergens: data.allergens ?? null,
    voicePart: data.voicePart ?? null,
    singingExperience: data.singingExperience ?? null,
  });
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, syntheticOpenId))
    .limit(1);
  return result[0];
}

// ─── Admin: Record Cash Payment ───────────────────────────────────────────────

export async function recordCashPayment(data: {
  userId: number;
  passType: string;
  sessionCount: number;
  amountCents: number;
  adminId: number;
  notes?: string;
  paymentMethod?: "cash" | "complimentary";
}) {
  if (!db) throw new Error("DB unavailable");

  // 1. Create a pass order record (no Stripe session)
  await db.insert(passOrders).values({
    userId: data.userId,
    stripeSessionId: null,
    passType: data.passType,
    sessionCount: data.sessionCount,
    amountCents: data.amountCents,
    currency: "aud",
    paymentMethod: data.paymentMethod ?? "cash",
    notes: data.notes ?? null,
    status: "paid",
  });

  // 2. Assign / top-up the pass
  const existingPass = await getActivePassForUser(data.userId);
  let passId: number;
  if (existingPass) {
    const newBalance = existingPass.remainingSessions + data.sessionCount;
    await db
      .update(passes)
      .set({
        remainingSessions: newBalance,
        totalSessions: sql`totalSessions + ${data.sessionCount}`,
        active: true,
      })
      .where(eq(passes.id, existingPass.id));
    passId = existingPass.id;
  } else {
    await db.insert(passes).values({
      userId: data.userId,
      totalSessions: data.sessionCount,
      remainingSessions: data.sessionCount,
      assignedBy: data.adminId,
      active: true,
    });
    const newPass = await db
      .select()
      .from(passes)
      .where(eq(passes.userId, data.userId))
      .orderBy(desc(passes.assignedAt))
      .limit(1);
    passId = newPass[0].id;
  }

  // 3. Link the order to the pass
  await db
    .update(passOrders)
    .set({ passId })
    .where(
      and(
        eq(passOrders.userId, data.userId),
        eq(passOrders.paymentMethod, "cash"),
        eq(passOrders.status, "paid")
      )
    );

  return { success: true, passId };
}

// ─── Documents ────────────────────────────────────────────────────────────────

export async function listDocuments() {
  if (!db) return [];
  return db
    .select({
      id: documents.id,
      title: documents.title,
      description: documents.description,
      fileName: documents.fileName,
      fileKey: documents.fileKey,
      fileUrl: documents.fileUrl,
      mimeType: documents.mimeType,
      fileSizeBytes: documents.fileSizeBytes,
      uploadedBy: documents.uploadedBy,
      createdAt: documents.createdAt,
      uploaderName: users.name,
      uploaderFirstName: users.firstName,
      uploaderLastName: users.lastName,
    })
    .from(documents)
    .leftJoin(users, eq(documents.uploadedBy, users.id))
    .orderBy(desc(documents.createdAt));
}

export async function createDocument(data: {
  title: string;
  description?: string;
  fileName: string;
  fileKey: string;
  fileUrl: string;
  mimeType: string;
  fileSizeBytes?: number;
  uploadedBy: number;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(documents).values(data);
  const result = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.id))
    .limit(1);
  return result[0];
}

export async function updateDocument(
  id: number,
  data: Partial<{ title: string; description: string }>
) {
  if (!db) throw new Error("DB unavailable");
  await db.update(documents).set(data).where(eq(documents.id, id));
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result[0];
}

export async function deleteDocument(id: number) {
  if (!db) throw new Error("DB unavailable");
  await db.delete(documents).where(eq(documents.id, id));
}

// ─── Unread conversation previews (for dashboard feed) ────────────────────────
export async function getUnreadConversationPreviews(userId: number) {
  if (!db) return [];
  // Get all unread messages sent TO this user
  const msgs = await db
    .select({
      id: directMessages.id,
      fromUserId: directMessages.fromUserId,
      body: directMessages.body,
      createdAt: directMessages.createdAt,
    })
    .from(directMessages)
    .where(
      and(
        eq(directMessages.toUserId, userId),
        sql`readAt IS NULL`
      )
    )
    .orderBy(desc(directMessages.createdAt));
  // Deduplicate by sender — keep only the most recent unread per sender
  const seen = new Set<number>();
  const previews: typeof msgs = [];
  for (const msg of msgs) {
    if (!seen.has(msg.fromUserId)) {
      seen.add(msg.fromUserId);
      previews.push(msg);
    }
  }
  return previews.slice(0, 5);
}

// ─── Member Invites ─────────────────────────────────────────────────────────

export async function createInviteToken(data: {
  token: string;
  email: string;
  note?: string;
  createdBy: number;
  expiresAt: Date;
}) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(inviteTokens).values({ token: data.token, email: data.email, note: data.note, createdBy: data.createdBy, expiresAt: data.expiresAt });
  const [row] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, data.token));
  return row;
}

export async function getInviteByToken(token: string) {
  if (!db) throw new Error("DB unavailable");
  const [row] = await db.select().from(inviteTokens).where(eq(inviteTokens.token, token));
  return row ?? null;
}

export async function markInviteUsed(token: string, userId: number) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(inviteTokens)
    .set({ usedAt: new Date(), usedBy: userId })
    .where(eq(inviteTokens.token, token));
}

export async function markInviteEmailVerified(token: string) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(inviteTokens)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(inviteTokens.token, token));
}

export async function saveInviteOtp(token: string, code: string, expiresAt: Date) {
  if (!db) throw new Error("DB unavailable");
  await db
    .update(inviteTokens)
    .set({ emailVerificationCode: code, codeExpiresAt: expiresAt })
    .where(eq(inviteTokens.token, token));
}

export async function listInvites(createdBy?: number) {
  if (!db) throw new Error("DB unavailable");
  const rows = createdBy
    ? await db.select().from(inviteTokens).where(eq(inviteTokens.createdBy, createdBy)).orderBy(desc(inviteTokens.createdAt))
    : await db.select().from(inviteTokens).orderBy(desc(inviteTokens.createdAt));
  return rows;
}

// ─── Group Conversations (multi-person DMs) ────────────────────────────────────

/** Create a new conversation with a set of participant user IDs (including the creator). */
export async function createGroupConversation(
  createdBy: number,
  participantIds: number[], // must include createdBy
  name?: string
) {
  if (!db) throw new Error("DB unavailable");

  // Insert the conversation row
  await db.insert(conversations).values({ createdBy, name: name ?? null });
  const [conv] = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.id))
    .limit(1);

  // Insert all participants (deduplicated)
  const uniqueIds = Array.from(new Set(participantIds));
  await db.insert(conversationParticipants).values(
    uniqueIds.map((userId) => ({ conversationId: conv.id, userId }))
  );

  return conv;
}

/** Get all conversations a user participates in, with latest message preview. */
export async function getGroupConversationsForUser(userId: number) {
  if (!db) return [];

  // Get conversation IDs where this user is a participant
  const participations = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, userId));

  if (participations.length === 0) return [];
  const convIds = participations.map((p) => p.conversationId);

  // For each conversation, get the conversation row + participants + latest message
  const results = [];
  for (const convId of convIds) {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, convId));
    if (!conv) continue;

    const participants = await db
      .select({ userId: conversationParticipants.userId, name: users.name, firstName: users.firstName, lastName: users.lastName, email: users.email, avatarUrl: users.avatarUrl })
      .from(conversationParticipants)
      .innerJoin(users, eq(users.id, conversationParticipants.userId))
      .where(eq(conversationParticipants.conversationId, convId));

    const [latestMsg] = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, convId))
      .orderBy(desc(conversationMessages.id))
      .limit(1);

    results.push({ ...conv, participants, latestMsg: latestMsg ?? null });
  }

  // Sort by latest message time descending
  results.sort((a, b) => {
    const ta = a.latestMsg?.createdAt?.getTime() ?? a.createdAt.getTime();
    const tb = b.latestMsg?.createdAt?.getTime() ?? b.createdAt.getTime();
    return tb - ta;
  });

  return results;
}

/** Get all messages in a conversation (for participants only). */
export async function getGroupConversationMessages(conversationId: number) {
  if (!db) return [];
  return db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      fromUserId: conversationMessages.fromUserId,
      body: conversationMessages.body,
      createdAt: conversationMessages.createdAt,
      senderName: users.name,
      senderFirstName: users.firstName,
      senderLastName: users.lastName,
      senderAvatar: users.avatarUrl,
    })
    .from(conversationMessages)
    .innerJoin(users, eq(users.id, conversationMessages.fromUserId))
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(conversationMessages.createdAt);
}

/** Send a message to a group conversation. */
export async function sendGroupConversationMessage(
  conversationId: number,
  fromUserId: number,
  body: string
) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(conversationMessages).values({ conversationId, fromUserId, body });
  // Update conversation updatedAt
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  const [msg] = await db
    .select()
    .from(conversationMessages)
    .orderBy(desc(conversationMessages.id))
    .limit(1);
  return msg;
}

/** Check if a user is a participant in a conversation. */
export async function isConversationParticipant(conversationId: number, userId: number) {
  if (!db) return false;
  const [row] = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId)
      )
    );
  return !!row;
}

// ─── Attendance History (member-facing) ──────────────────────────────────────

/** Returns all sessions a user attended, ordered newest first. */
export async function getAttendanceHistoryForUser(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: attendance.id,
      sessionId: attendance.sessionId,
      sessionTitle: sessions.title,
      sessionDate: sessions.sessionDate,
      sessionType: attendance.sessionType,
      passUsed: attendance.passUsed,
      markedAt: attendance.markedAt,
    })
    .from(attendance)
    .leftJoin(sessions, eq(attendance.sessionId, sessions.id))
    .where(and(eq(attendance.userId, userId), eq(attendance.attended, true)))
    .orderBy(desc(sessions.sessionDate));
}

// ─── BVC Shop ────────────────────────────────────────────────────────────────

export async function listShopProducts(includeInactive = false) {
  if (!db) return [];
  const rows = await db
    .select()
    .from(shopProducts)
    .orderBy(desc(shopProducts.createdAt));
  return includeInactive ? rows : rows.filter((p) => p.isActive);
}

export async function getShopProductWithVariants(productId: number) {
  if (!db) return null;
  const [product] = await db.select().from(shopProducts).where(eq(shopProducts.id, productId));
  if (!product) return null;
  const variants = await db
    .select()
    .from(shopProductVariants)
    .where(eq(shopProductVariants.productId, productId));
  return { ...product, variants };
}

export async function createShopProduct(data: {
  name: string;
  description?: string;
  imageKey?: string;
  imageUrl?: string;
  priceCents: number;
  category: string;
  stock: number;
  createdBy: number;
}) {
  if (!db) throw new Error("DB unavailable");
  const [result] = await db.insert(shopProducts).values({
    name: data.name,
    description: data.description ?? null,
    imageKey: data.imageKey ?? null,
    imageUrl: data.imageUrl ?? null,
    priceCents: data.priceCents,
    category: data.category,
    stock: data.stock,
    createdBy: data.createdBy,
  });
  return result;
}

export async function updateShopProduct(
  id: number,
  data: Partial<{
    name: string;
    description: string;
    imageKey: string;
    imageUrl: string;
    priceCents: number;
    category: string;
    isActive: boolean;
    stock: number;
  }>
) {
  if (!db) throw new Error("DB unavailable");
  await db.update(shopProducts).set(data).where(eq(shopProducts.id, id));
}

export async function deleteShopProduct(id: number) {
  if (!db) throw new Error("DB unavailable");
  await db.delete(shopProductVariants).where(eq(shopProductVariants.productId, id));
  await db.delete(shopProducts).where(eq(shopProducts.id, id));
}

export async function setShopProductVariants(productId: number, variants: { label: string; stock: number }[]) {
  if (!db) throw new Error("DB unavailable");
  await db.delete(shopProductVariants).where(eq(shopProductVariants.productId, productId));
  if (variants.length > 0) {
    await db.insert(shopProductVariants).values(variants.map((v) => ({ productId, label: v.label, stock: v.stock })));
  }
}

export async function createShopOrder(data: {
  userId: number;
  stripeSessionId?: string;
  paymentSessionId?: string;
  totalCents: number;
  items: { productId: number; variantId?: number; quantity: number; priceCents: number; productName: string; variantLabel?: string }[];
}) {
  if (!db) throw new Error("DB unavailable");
  const sessionId = data.paymentSessionId ?? data.stripeSessionId ?? null;
  const [result] = await db.insert(shopOrders).values({
    userId: data.userId,
    stripeSessionId: sessionId,
    totalCents: data.totalCents,
    status: "pending",
  });
  const orderId = (result as any).insertId as number;
  if (data.items.length > 0) {
    await db.insert(shopOrderItems).values(
      data.items.map((item) => ({
        orderId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        priceCents: item.priceCents,
        productName: item.productName,
        variantLabel: item.variantLabel ?? null,
      }))
    );
  }
  return orderId;
}

export async function markShopOrderPaid(stripeSessionId: string) {
  if (!db) return;
  await db.update(shopOrders).set({ status: "paid" }).where(eq(shopOrders.stripeSessionId, stripeSessionId));
}

export async function getShopOrdersByUser(userId: number) {
  if (!db) return [];
  const orders = await db
    .select()
    .from(shopOrders)
    .where(eq(shopOrders.userId, userId))
    .orderBy(desc(shopOrders.createdAt));
  const result = [];
  for (const order of orders) {
    const items = await db
      .select()
      .from(shopOrderItems)
      .where(eq(shopOrderItems.orderId, order.id));
    result.push({ ...order, items });
  }
  return result;
}

export async function getAllShopOrders() {
  if (!db) return [];
  const orders = await db
    .select({
      id: shopOrders.id,
      userId: shopOrders.userId,
      stripeSessionId: shopOrders.stripeSessionId,
      status: shopOrders.status,
      totalCents: shopOrders.totalCents,
      createdAt: shopOrders.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(shopOrders)
    .leftJoin(users, eq(shopOrders.userId, users.id))
    .orderBy(desc(shopOrders.createdAt));
  const result = [];
  for (const order of orders) {
    const items = await db
      .select()
      .from(shopOrderItems)
      .where(eq(shopOrderItems.orderId, order.id));
    result.push({ ...order, items });
  }
  return result;
}

// ─── Rehearsal Recordings ─────────────────────────────────────────────────────

/** List all recordings with session info — admin only */
export async function listAllRehearsalRecordings() {
  if (!db) return [];
  return db
    .select({
      id: rehearsalRecordings.id,
      sessionId: rehearsalRecordings.sessionId,
      title: rehearsalRecordings.title,
      description: rehearsalRecordings.description,
      fileKey: rehearsalRecordings.fileKey,
      fileUrl: rehearsalRecordings.fileUrl,
      durationSeconds: rehearsalRecordings.durationSeconds,
      uploadedBy: rehearsalRecordings.uploadedBy,
      createdAt: rehearsalRecordings.createdAt,
      sessionTitle: sessions.title,
      sessionDate: sessions.sessionDate,
    })
    .from(rehearsalRecordings)
    .leftJoin(sessions, eq(rehearsalRecordings.sessionId, sessions.id))
    .orderBy(desc(rehearsalRecordings.createdAt));
}

/** List recordings accessible to a specific user (attended the session) */
export async function listAccessibleRehearsalRecordings(userId: number) {
  if (!db) return [];
  // Get session IDs where this user was marked as attended
  const attendedRows = await db
    .select({ sessionId: attendance.sessionId })
    .from(attendance)
    .where(and(eq(attendance.userId, userId), eq(attendance.attended, true)));
  const attendedSessionIds = attendedRows.map((r) => r.sessionId);
  if (attendedSessionIds.length === 0) return [];
  return db
    .select({
      id: rehearsalRecordings.id,
      sessionId: rehearsalRecordings.sessionId,
      title: rehearsalRecordings.title,
      description: rehearsalRecordings.description,
      fileUrl: rehearsalRecordings.fileUrl,
      durationSeconds: rehearsalRecordings.durationSeconds,
      createdAt: rehearsalRecordings.createdAt,
      sessionTitle: sessions.title,
      sessionDate: sessions.sessionDate,
    })
    .from(rehearsalRecordings)
    .leftJoin(sessions, eq(rehearsalRecordings.sessionId, sessions.id))
    .where(sql`${rehearsalRecordings.sessionId} IN (${sql.join(attendedSessionIds.map((id) => sql`${id}`), sql`, `)})`)
    .orderBy(desc(rehearsalRecordings.createdAt));
}

export async function createRehearsalRecording(data: {
  sessionId: number;
  title: string;
  description?: string;
  fileKey: string;
  fileUrl: string;
  durationSeconds?: number;
  uploadedBy: number;
}) {
  if (!db) throw new Error("Database unavailable while saving recording metadata");
  const [result] = await db.insert(rehearsalRecordings).values(data);
  const insertedId = Number(result.insertId);
  const savedRows = await db
    .select()
    .from(rehearsalRecordings)
    .where(eq(rehearsalRecordings.id, insertedId))
    .limit(1);
  return savedRows[0] ?? null;
}

export async function deleteRehearsalRecording(id: number) {
  if (!db) return;
  await db.delete(rehearsalRecordings).where(eq(rehearsalRecordings.id, id));
}

// ─── Dashboard: Expired Passes ────────────────────────────────────────────────

/**
 * Returns members who have an active pass with 0 remaining sessions.
 * These members need to purchase or be assigned a new pass.
 */
export async function getExpiredPasses() {
  const members = await getAllMembers();
  return members
    .filter((member) => member.remainingSessions === 0)
    .map(({ id, name, firstName, lastName, email, totalSessions, remainingSessions }) => ({
      userId: id,
      name,
      firstName,
      lastName,
      email,
      totalSessions: totalSessions ?? 0,
      remainingSessions: remainingSessions ?? 0,
    }));
}

export async function getLowPasses() {
  const members = await getAllMembers();
  return members
    .filter((member) => (member.remainingSessions ?? 0) > 0 && (member.remainingSessions ?? 0) <= 2)
    .map(({ id, name, firstName, lastName, email, totalSessions, remainingSessions }) => ({
      userId: id,
      name,
      firstName,
      lastName,
      email,
      totalSessions: totalSessions ?? 0,
      remainingSessions: remainingSessions ?? 0,
    }))
    .sort((a, b) => a.remainingSessions - b.remainingSessions);
}

// ─── Dashboard: Last Session Income ──────────────────────────────────────────────

/**
 * Estimates income from the most recent session.
 * - Single-session attendees: singleCount × $16.00 (1600 cents)
 * - Pass attendees: each deduction is worth their pass cost ÷ totalSessions
 *   (simplified: 10-pass = $14/session, 5-pass = $15/session, single = $16)
 *
 * For simplicity we use the flat per-session rates from products.ts:
 *   10-pass → $14.00/session, 5-pass → $15.00/session, single → $16.00/session
 *
 * Returns { totalCents, singleCents, passCents, singleCount, passCount, complimentaryCount }
 */
export async function getLastSessionIncome() {
  if (!db) return null;

  const lastSession = await db
    .select()
    .from(sessions)
    .orderBy(desc(sessions.sessionDate))
    .limit(1);
  if (lastSession.length === 0) return null;

  const sess = lastSession[0];

  // Format session date as YYYY-MM-DD (local AEST) for Square date-range query
  const d = new Date(sess.sessionDate);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sessionDateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Fetch cash/EFTPOS/complimentary orders recorded in our DB for this session date
  const allOrders = await db
    .select({
      id: passOrders.id,
      userId: passOrders.userId,
      passType: passOrders.passType,
      sessionCount: passOrders.sessionCount,
      amountCents: passOrders.amountCents,
      paymentMethod: passOrders.paymentMethod,
      notes: passOrders.notes,
      createdAt: passOrders.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(passOrders)
    .leftJoin(users, eq(passOrders.userId, users.id))
    .where(
      and(
        eq(passOrders.status, "paid"),
        sql`DATE(${passOrders.createdAt}) = ${sessionDateStr}`
      )
    )
    .orderBy(desc(passOrders.createdAt));

  // Split into cash/EFTPOS and complimentary (Square payments come from Square API directly)
  const cashOrders = allOrders.filter((o) => o.paymentMethod === "cash");
  const compOrders = allOrders.filter((o) => o.paymentMethod === "complimentary");
  const cashTotalCents = cashOrders.reduce((sum, o) => sum + (o.amountCents ?? 0), 0);

  return {
    sessionId: sess.id,
    sessionTitle: sess.title,
    sessionDate: sess.sessionDate,
    sessionDateStr,
    cashOrders: cashOrders.map((o) => ({
      id: o.id,
      userId: o.userId,
      passType: o.passType,
      sessionCount: o.sessionCount,
      amountCents: o.amountCents,
      paymentMethod: o.paymentMethod as string,
      notes: o.notes,
      createdAt: o.createdAt,
      userName: o.userName,
      userEmail: o.userEmail,
      userFirstName: o.userFirstName,
      userLastName: o.userLastName,
    })),
    compOrders: compOrders.map((o) => ({
      id: o.id,
      userId: o.userId,
      passType: o.passType,
      sessionCount: o.sessionCount,
      amountCents: o.amountCents,
      paymentMethod: o.paymentMethod as string,
      notes: o.notes,
      createdAt: o.createdAt,
      userName: o.userName,
      userEmail: o.userEmail,
      userFirstName: o.userFirstName,
      userLastName: o.userLastName,
    })),
    cashTotalCents,
  };
}

// ─── Rehearsal Recording Access ───────────────────────────────────────────────

/**
 * Update a live stream's recording URL (admin only).
 */
export async function setLiveStreamRecordingUrl(streamId: number, recordingUrl: string | null) {
  if (!db) return;
  await db.update(liveStreams).set({ recordingUrl } as Record<string, unknown>).where(eq(liveStreams.id, streamId));
}

/**
 * Check whether a user has access to a past rehearsal recording.
 * Returns { hasAccess: boolean, reason: 'attended' | 'livestream' | 'pass' | 'none' }
 *
 * Free access is granted if:
 *   1. The user was marked as attended (in-person) for the session on the same date as the stream.
 *   2. The user already has a liveStreamAccess row for this stream (joined the live stream).
 * Pass-based access is granted if there is a rehearsalRecordingAccess row.
 */
export async function getRecordingAccessStatus(streamId: number, userId: number) {
  if (!db) return { hasAccess: false, reason: "none" as const };

  // 1. Check liveStreamAccess (joined the live stream)
  const lsaRows = await db
    .select({ id: liveStreamAccess.id })
    .from(liveStreamAccess)
    .where(and(eq(liveStreamAccess.streamId, streamId), eq(liveStreamAccess.userId, userId)))
    .limit(1);
  if (lsaRows.length > 0) return { hasAccess: true, reason: "livestream" as const };

  // 2. Check attendance on the same date as the stream
  const streamRows = await db.select().from(liveStreams).where(eq(liveStreams.id, streamId)).limit(1);
  if (streamRows.length > 0) {
    const streamDate = streamRows[0].scheduledAt;
    // Find sessions on the same calendar date
    const dateStr = streamDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const sessionRows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(sql`DATE(${sessions.sessionDate}) = ${dateStr}`);
    if (sessionRows.length > 0) {
      const sessionIds = sessionRows.map((s) => s.id);
      const attRows = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.userId, userId),
            eq(attendance.attended, true),
            sql`${attendance.sessionId} IN (${sql.join(sessionIds.map((id) => sql`${id}`), sql`, `)})`
          )
        )
        .limit(1);
      if (attRows.length > 0) return { hasAccess: true, reason: "attended" as const };
    }
  }

  // 3. Check rehearsalRecordingAccess (unlocked via pass)
  const rraRows = await db
    .select({ id: rehearsalRecordingAccess.id })
    .from(rehearsalRecordingAccess)
    .where(and(eq(rehearsalRecordingAccess.streamId, streamId), eq(rehearsalRecordingAccess.userId, userId)))
    .limit(1);
  if (rraRows.length > 0) return { hasAccess: true, reason: "pass" as const };

  return { hasAccess: false, reason: "none" as const };
}

/**
 * Grant recording access via pass deduction.
 */
export async function grantRecordingAccessWithPass(streamId: number, userId: number) {
  if (!db) throw new Error("DB unavailable");
  await db.insert(rehearsalRecordingAccess).values({ streamId, userId, accessType: "pass" });
}

/**
 * Get the full recording access list for a stream (admin view).
 */
export async function getRecordingAccessList(streamId: number) {
  if (!db) return [];
  return db
    .select({
      id: rehearsalRecordingAccess.id,
      streamId: rehearsalRecordingAccess.streamId,
      userId: rehearsalRecordingAccess.userId,
      accessType: rehearsalRecordingAccess.accessType,
      grantedAt: rehearsalRecordingAccess.grantedAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userEmail: users.email,
    })
    .from(rehearsalRecordingAccess)
    .leftJoin(users, eq(rehearsalRecordingAccess.userId, users.id))
    .where(eq(rehearsalRecordingAccess.streamId, streamId))
    .orderBy(desc(rehearsalRecordingAccess.grantedAt));
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

export async function createGalleryPost(data: {
  userId: number;
  imageUrl: string;
  imageKey: string;
  caption?: string | null;
  status: "pending" | "approved";
}) {
  if (!db) return null;
  const [result] = await db.insert(galleryPosts).values(data);
  return result;
}

export async function insertGalleryMedia(items: {
  postId: number;
  mediaUrl: string;
  mediaKey: string;
  mimeType: string;
  sortOrder: number;
}[]) {
  if (!db || items.length === 0) return;
  await db.insert(galleryMedia).values(items);
}

export async function listApprovedGalleryPosts(currentUserId: number) {
  if (!db) return [];
  const posts = await db
    .select({
      id: galleryPosts.id,
      userId: galleryPosts.userId,
      imageUrl: galleryPosts.imageUrl,
      imageKey: galleryPosts.imageKey,
      caption: galleryPosts.caption,
      status: galleryPosts.status,
      createdAt: galleryPosts.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(galleryPosts)
    .leftJoin(users, eq(galleryPosts.userId, users.id))
    .where(eq(galleryPosts.status, "approved"))
    .orderBy(desc(galleryPosts.createdAt));

  // Attach reaction counts + current user reaction + comment count
  const postIds = posts.map((p) => p.id);
  if (postIds.length === 0) return [];

  const reactions = await db
    .select({
      postId: galleryReactions.postId,
      type: galleryReactions.type,
      userId: galleryReactions.userId,
    })
    .from(galleryReactions)
    .where(inArray(galleryReactions.postId, postIds));

  const comments = await db
    .select({ postId: galleryComments.postId })
    .from(galleryComments)
    .where(inArray(galleryComments.postId, postIds));

  // Fetch all media items for these posts
  const mediaRows = await db
    .select({
      id: galleryMedia.id,
      postId: galleryMedia.postId,
      mediaUrl: galleryMedia.mediaUrl,
      mediaKey: galleryMedia.mediaKey,
      mimeType: galleryMedia.mimeType,
      sortOrder: galleryMedia.sortOrder,
    })
    .from(galleryMedia)
    .where(inArray(galleryMedia.postId, postIds))
    .orderBy(galleryMedia.sortOrder);

  return posts.map((p) => {
    const postReactions = reactions.filter((r) => r.postId === p.id);
    const likeCount = postReactions.filter((r) => r.type === "like").length;
    const loveCount = postReactions.filter((r) => r.type === "love").length;
    const myReaction = postReactions.find((r) => r.userId === currentUserId)?.type ?? null;
    const commentCount = comments.filter((c) => c.postId === p.id).length;
    const media = mediaRows.filter((m) => m.postId === p.id);
    return { ...p, likeCount, loveCount, myReaction, commentCount, media };
  });
}

export async function listPendingGalleryPosts() {
  if (!db) return [];
  return db
    .select({
      id: galleryPosts.id,
      userId: galleryPosts.userId,
      imageUrl: galleryPosts.imageUrl,
      imageKey: galleryPosts.imageKey,
      caption: galleryPosts.caption,
      status: galleryPosts.status,
      createdAt: galleryPosts.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(galleryPosts)
    .leftJoin(users, eq(galleryPosts.userId, users.id))
    .where(eq(galleryPosts.status, "pending"))
    .orderBy(desc(galleryPosts.createdAt));
}

export async function listMyPendingGalleryPosts(userId: number) {
  if (!db) return [];
  return db
    .select({
      id: galleryPosts.id,
      userId: galleryPosts.userId,
      imageUrl: galleryPosts.imageUrl,
      imageKey: galleryPosts.imageKey,
      caption: galleryPosts.caption,
      status: galleryPosts.status,
      createdAt: galleryPosts.createdAt,
    })
    .from(galleryPosts)
    .where(and(eq(galleryPosts.userId, userId), eq(galleryPosts.status, "pending")))
    .orderBy(desc(galleryPosts.createdAt));
}

export async function updateGalleryPostStatus(postId: number, status: "approved" | "rejected") {
  if (!db) return;
  await db.update(galleryPosts).set({ status }).where(eq(galleryPosts.id, postId));
}

export async function deleteGalleryPost(postId: number) {
  if (!db) return;
  await db.delete(galleryComments).where(eq(galleryComments.postId, postId));
  await db.delete(galleryReactions).where(eq(galleryReactions.postId, postId));
  await db.delete(galleryMedia).where(eq(galleryMedia.postId, postId));
  await db.delete(galleryPosts).where(eq(galleryPosts.id, postId));
}

export async function getGalleryPost(postId: number) {
  if (!db) return null;
  const [post] = await db.select().from(galleryPosts).where(eq(galleryPosts.id, postId));
  return post ?? null;
}

export async function upsertGalleryReaction(postId: number, userId: number, type: "like" | "love") {
  if (!db) return null;
  const [existing] = await db
    .select()
    .from(galleryReactions)
    .where(and(eq(galleryReactions.postId, postId), eq(galleryReactions.userId, userId)));

  if (existing) {
    if (existing.type === type) {
      // Toggle off
      await db.delete(galleryReactions).where(eq(galleryReactions.id, existing.id));
      return null;
    } else {
      // Switch type
      await db.update(galleryReactions).set({ type }).where(eq(galleryReactions.id, existing.id));
      return type;
    }
  } else {
    await db.insert(galleryReactions).values({ postId, userId, type });
    return type;
  }
}

export async function addGalleryComment(data: {
  postId: number;
  userId: number;
  parentId?: number | null;
  body: string;
}) {
  if (!db) return null;
  const [result] = await db.insert(galleryComments).values({
    postId: data.postId,
    userId: data.userId,
    parentId: data.parentId ?? null,
    body: data.body,
  });
  return result;
}

export async function listGalleryComments(postId: number) {
  if (!db) return [];
  return db
    .select({
      id: galleryComments.id,
      postId: galleryComments.postId,
      userId: galleryComments.userId,
      parentId: galleryComments.parentId,
      body: galleryComments.body,
      createdAt: galleryComments.createdAt,
      userName: users.name,
      userFirstName: users.firstName,
      userLastName: users.lastName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(galleryComments)
    .leftJoin(users, eq(galleryComments.userId, users.id))
    .where(eq(galleryComments.postId, postId))
    .orderBy(galleryComments.createdAt);
}

export async function deleteGalleryComment(commentId: number) {
  if (!db) return;
  // Also delete any replies to this comment
  await db.delete(galleryComments).where(eq(galleryComments.parentId, commentId));
  await db.delete(galleryComments).where(eq(galleryComments.id, commentId));
}

export async function getGalleryComment(commentId: number) {
  if (!db) return null;
  const [comment] = await db.select().from(galleryComments).where(eq(galleryComments.id, commentId));
  return comment ?? null;
}
