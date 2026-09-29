import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// ─── Core Users ───────────────────────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  status: mysqlEnum("status", ["pending", "active", "denied"]).default("pending").notNull(),
  // Extended profile fields
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  phone: varchar("phone", { length: 32 }),
  address: text("address"),
  dateOfBirth: varchar("dateOfBirth", { length: 16 }), // stored as YYYY-MM-DD string
  allergens: text("allergens"),
  avatarUrl: text("avatarUrl"), // S3 storage path e.g. /manus-storage/avatars/...
  voicePart: mysqlEnum("voicePart", ["soprano1", "soprano2", "altoHigh", "altoLow", "tenor", "bass"]),
  memberSince: varchar("memberSince", { length: 7 }), // stored as YYYY-MM string
  singingExperience: mysqlEnum("singingExperience", ["beginner", "some_experience", "intermediate", "advanced", "professional"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Rehearsal Sessions ───────────────────────────────────────────────────────

export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  sessionDate: timestamp("sessionDate").notNull(),
  notes: text("notes"),
  createdBy: int("createdBy").notNull(), // admin user id
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendance = mysqlTable("attendance", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  userId: int("userId").notNull(),
  attended: boolean("attended").default(false).notNull(),
  passUsed: boolean("passUsed").default(false).notNull(),
  // 'online' records a verified live-rehearsal join without deducting another session.
  sessionType: mysqlEnum("sessionType", ["pass", "single", "complimentary", "online"]).default("pass").notNull(),
  markedAt: timestamp("markedAt").defaultNow().notNull(),
});

export type Attendance = typeof attendance.$inferSelect;
export type InsertAttendance = typeof attendance.$inferInsert;

// ─── 10-Pass System ───────────────────────────────────────────────────────────

export const passes = mysqlTable("passes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  totalSessions: int("totalSessions").default(10).notNull(),
  remainingSessions: int("remainingSessions").default(10).notNull(),
  assignedBy: int("assignedBy").notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
  active: boolean("active").default(true).notNull(),
  notes: text("notes"),
});

export type Pass = typeof passes.$inferSelect;
export type InsertPass = typeof passes.$inferInsert;

// ─── In-App Notifications ─────────────────────────────────────────────────────

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["pass_low", "announcement", "general", "library", "document", "event"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Announcements ────────────────────────────────────────────────────────────

export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  category: mysqlEnum("category", ["event", "rehearsal", "general"]).default("general").notNull(),
  authorId: int("authorId").notNull(),
    pinned: boolean("pinned").default(false).notNull(),
  attachmentUrl: varchar("attachmentUrl", { length: 1024 }),
  attachmentKey: varchar("attachmentKey", { length: 512 }),
  attachmentType: mysqlEnum("attachmentType", ["image", "video", "document"]),
  attachmentName: varchar("attachmentName", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = typeof announcements.$inferInsert;

// ─── Announcement Reads (per-user read tracking) ──────────────────────────────

export const announcementReads = mysqlTable("announcement_reads", {
  id: int("id").autoincrement().primaryKey(),
  announcementId: int("announcementId").notNull(),
  userId: int("userId").notNull(),
  readAt: timestamp("readAt").defaultNow().notNull(),
});

export type AnnouncementRead = typeof announcementReads.$inferSelect;

// ─── Music Library ────────────────────────────────────────────────────────────

export const libraryItems = mysqlTable("library_items", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  artist: varchar("artist", { length: 255 }),
  type: mysqlEnum("type", ["sheet_music", "backing_track", "lyrics", "chord_chart"]).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }),
  uploadedBy: int("uploadedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LibraryItem = typeof libraryItems.$inferSelect;
export type InsertLibraryItem = typeof libraryItems.$inferInsert;

// ─── Pass Orders ─────────────────────────────────────────────────────────────

export const passOrders = mysqlTable("pass_orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stripeSessionId: varchar("stripeSessionId", { length: 255 }).unique(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  paymentSessionId: varchar("paymentSessionId", { length: 512 }),
  paymentProvider: varchar("paymentProvider", { length: 32 }).default("square"),
  passType: varchar("passType", { length: 64 }).notNull(),
  sessionCount: int("sessionCount").default(10).notNull(),
  amountCents: int("amountCents").notNull(),
  currency: varchar("currency", { length: 8 }).default("aud").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "failed", "cancelled"]).default("pending").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["stripe", "square", "cash", "complimentary"]).default("square").notNull(),
  passId: int("passId"),
  notes: text("notes"),
  receiptSentAt: timestamp("receiptSentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PassOrder = typeof passOrders.$inferSelect;
export type InsertPassOrder = typeof passOrders.$inferInsert;

// ─── Direct Messages ──────────────────────────────────────────────────────────

export const directMessages = mysqlTable("direct_messages", {
  id: int("id").autoincrement().primaryKey(),
  fromUserId: int("fromUserId").notNull(),
  toUserId: int("toUserId").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DirectMessage = typeof directMessages.$inferSelect;
export type InsertDirectMessage = typeof directMessages.$inferInsert;

// ─── Events ───────────────────────────────────────────────────────────────────

export const events = mysqlTable("events", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  location: varchar("location", { length: 512 }),
  eventDate: timestamp("eventDate").notNull(),
  endDate: timestamp("endDate"),
  category: mysqlEnum("category", ["concert", "rehearsal", "social", "workshop", "other"])
    .default("other")
    .notNull(),
    createdBy: int("createdBy").notNull(),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  imageKey: varchar("imageKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

// ─── Groups ───────────────────────────────────────────────────────────────────

export const groups = mysqlTable("groups", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Group = typeof groups.$inferSelect;
export type InsertGroup = typeof groups.$inferInsert;

// ─── Group Members ────────────────────────────────────────────────────────────

export const groupMembers = mysqlTable("group_members", {
  id: int("id").autoincrement().primaryKey(),
  groupId: int("groupId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "member"]).default("member").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "invited", "rejected"])
    .default("pending")
    .notNull(),
  invitedBy: int("invitedBy"),
  joinedAt: timestamp("joinedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GroupMember = typeof groupMembers.$inferSelect;
export type InsertGroupMember = typeof groupMembers.$inferInsert;

// ─── Group Messages ───────────────────────────────────────────────────────────

export const groupMessages = mysqlTable("group_messages", {
  id: int("id").autoincrement().primaryKey(),
  groupId: int("groupId").notNull(),
  fromUserId: int("fromUserId").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GroupMessage = typeof groupMessages.$inferSelect;
export type InsertGroupMessage = typeof groupMessages.$inferInsert;

// ─── Event RSVPs ──────────────────────────────────────────────────────────────

export const eventRsvps = mysqlTable("event_rsvps", {
  id: int("id").autoincrement().primaryKey(),
  eventId: int("eventId").notNull(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["attending", "not_attending"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EventRsvp = typeof eventRsvps.$inferSelect;
export type InsertEventRsvp = typeof eventRsvps.$inferInsert;

// ─── Live Stream Rehearsals ──────────────────────────────────────────────────

export const liveStreams = mysqlTable("live_streams", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  streamUrl: varchar("streamUrl", { length: 1024 }).notNull(),
  recordingUrl: varchar("recordingUrl", { length: 1024 }),
  scheduledAt: timestamp("scheduledAt").notNull(),
  endsAt: timestamp("endsAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LiveStream = typeof liveStreams.$inferSelect;
export type InsertLiveStream = typeof liveStreams.$inferInsert;

export const liveStreamAccess = mysqlTable("live_stream_access", {
  id: int("id").autoincrement().primaryKey(),
  streamId: int("streamId").notNull(),
  userId: int("userId").notNull(),
  accessType: mysqlEnum("accessType", ["pass", "single_purchase"]).notNull(),
  stripeSessionId: varchar("stripeSessionId", { length: 255 }),
  paymentSessionId: varchar("paymentSessionId", { length: 512 }),
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
});

export type LiveStreamAccess = typeof liveStreamAccess.$inferSelect;
export type InsertLiveStreamAccess = typeof liveStreamAccess.$inferInsert;

// ─── Rehearsal Recording Access ───────────────────────────────────────────────

export const rehearsalRecordingAccess = mysqlTable("rehearsal_recording_access", {
  id: int("id").autoincrement().primaryKey(),
  streamId: int("streamId").notNull(),
  userId: int("userId").notNull(),
  accessType: mysqlEnum("accessType", ["pass", "attended", "livestream"]).notNull(),
  grantedAt: timestamp("grantedAt").defaultNow().notNull(),
});
export type RehearsalRecordingAccess = typeof rehearsalRecordingAccess.$inferSelect;
export type InsertRehearsalRecordingAccess = typeof rehearsalRecordingAccess.$inferInsert;

// ─── Forms & Documents ────────────────────────────────────────────────────────

export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  fileKey: varchar("fileKey", { length: 1024 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 1024 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  fileSizeBytes: int("fileSizeBytes"),
  uploadedBy: int("uploadedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ─── Group Conversations (multi-person DMs) ─────────────────────────────────

export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

export const conversationParticipants = mysqlTable("conversation_participants", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  userId: int("userId").notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;

export const conversationMessages = mysqlTable("conversation_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  fromUserId: int("fromUserId").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ConversationMessage = typeof conversationMessages.$inferSelect;

// ─── Member Invites ────────────────────────────────────────────────────────────

export const inviteTokens = mysqlTable("invite_tokens", {
  id: int("id").autoincrement().primaryKey(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  note: text("note"),
  createdBy: int("createdBy").notNull(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  emailVerificationCode: varchar("emailVerificationCode", { length: 6 }),
  codeExpiresAt: timestamp("codeExpiresAt"),
  usedAt: timestamp("usedAt"),
  usedBy: int("usedBy"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type InviteToken = typeof inviteTokens.$inferSelect;
export type InsertInviteToken = typeof inviteTokens.$inferInsert;

// ─── Password resets / first-time password setup ─────────────────────────────
// Stores only a SHA-256 hash of the emailed token; tokens are single-use and short-lived.

export const passwordResets = mysqlTable("password_resets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  usedAt: timestamp("usedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PasswordReset = typeof passwordResets.$inferSelect;

// ─── BVC Shop ─────────────────────────────────────────────────────────────────

export const shopProducts = mysqlTable("shop_products", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  imageKey: varchar("imageKey", { length: 512 }),
  imageUrl: varchar("imageUrl", { length: 1024 }),
  priceCents: int("priceCents").notNull(),
  category: varchar("category", { length: 64 }).default("general").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  stock: int("stock").default(0).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopProduct = typeof shopProducts.$inferSelect;
export type InsertShopProduct = typeof shopProducts.$inferInsert;

export const shopProductVariants = mysqlTable("shop_product_variants", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("productId").notNull(),
  label: varchar("label", { length: 64 }).notNull(),
  stock: int("stock").default(0).notNull(),
});

export type ShopProductVariant = typeof shopProductVariants.$inferSelect;
export type InsertShopProductVariant = typeof shopProductVariants.$inferInsert;

export const shopOrders = mysqlTable("shop_orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  stripeSessionId: varchar("stripeSessionId", { length: 255 }).unique(),
  paymentSessionId: varchar("paymentSessionId", { length: 512 }),
  status: mysqlEnum("status", ["pending", "paid", "failed", "cancelled"]).default("pending").notNull(),
  totalCents: int("totalCents").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ShopOrder = typeof shopOrders.$inferSelect;
export type InsertShopOrder = typeof shopOrders.$inferInsert;

export const shopOrderItems = mysqlTable("shop_order_items", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  productId: int("productId").notNull(),
  variantId: int("variantId"),
  quantity: int("quantity").default(1).notNull(),
  priceCents: int("priceCents").notNull(),
  productName: varchar("productName", { length: 255 }).notNull(),
  variantLabel: varchar("variantLabel", { length: 64 }),
});

export type ShopOrderItem = typeof shopOrderItems.$inferSelect;
export type InsertShopOrderItem = typeof shopOrderItems.$inferInsert;

// ─── Push Subscriptions ───────────────────────────────────────────────────────

export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  endpoint: varchar("endpoint", { length: 512 }).notNull().unique(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;

// ─── Rehearsal Recordings ─────────────────────────────────────────────────────

export const rehearsalRecordings = mysqlTable("rehearsal_recordings", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 512 }).notNull(),
  durationSeconds: int("durationSeconds"),
  uploadedBy: int("uploadedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RehearsalRecording = typeof rehearsalRecordings.$inferSelect;
export type InsertRehearsalRecording = typeof rehearsalRecordings.$inferInsert;

// ─── Community Gallery ─────────────────────────────────────────────────────────

export const galleryPosts = mysqlTable("gallery_posts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  imageUrl: varchar("imageUrl", { length: 512 }).notNull(),
  imageKey: varchar("imageKey", { length: 512 }).notNull(),
  caption: text("caption"),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GalleryPost = typeof galleryPosts.$inferSelect;
export type InsertGalleryPost = typeof galleryPosts.$inferInsert;

export const galleryReactions = mysqlTable("gallery_reactions", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["like", "love"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GalleryReaction = typeof galleryReactions.$inferSelect;
export type InsertGalleryReaction = typeof galleryReactions.$inferInsert;

export const galleryComments = mysqlTable("gallery_comments", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),
  userId: int("userId").notNull(),
  parentId: int("parentId"),
  body: text("body").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GalleryComment = typeof galleryComments.$inferSelect;
export type InsertGalleryComment = typeof galleryComments.$inferInsert;

export const galleryMedia = mysqlTable("gallery_media", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),
  mediaUrl: varchar("mediaUrl", { length: 512 }).notNull(),
  mediaKey: varchar("mediaKey", { length: 512 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GalleryMedia = typeof galleryMedia.$inferSelect;
export type InsertGalleryMedia = typeof galleryMedia.$inferInsert;

// ─── User Activity Log (Admin Audit Trail) ────────────────────────────────────

export const userActivityLog = mysqlTable("user_activity_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  actorId: int("actorId"),
  action: mysqlEnum("action", [
    "attendance_marked",
    "attendance_unmarked",
    "pass_purchased",
    "pass_credited",
    "pass_deducted",
    "pass_adjusted",
    "comp_granted",
    "cash_payment",
    "pass_restored",
    "pass_expired",
    "pass_online_purchase",
    "pass_manual_activated",
    "role_changed",
    "member_deleted",
    "member_created",
    "receipt_resent",
  ]).notNull(),
  detail: text("detail"),
  balanceBefore: int("balanceBefore"),
  balanceAfter: int("balanceAfter"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type UserActivityLog = typeof userActivityLog.$inferSelect;
export type InsertUserActivityLog = typeof userActivityLog.$inferInsert;
