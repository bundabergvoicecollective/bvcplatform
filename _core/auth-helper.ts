import { COOKIE_NAME } from "@shared/const";
/**
 * Server-side helper for reading the JWT cookie from an Express request.
 * Used by upload routes and other non-tRPC handlers.
 */
import type { Request } from "express";
import { jwtVerify } from "jose";
import { parse } from "cookie";
import { ENV } from "./env";
import { db } from "../db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import type { User } from "../drizzle/schema";

export async function getRequestUser(req: Request): Promise<User | null> {
  try {
    const rawCookies = req.headers.cookie ?? "";
    const cookies = parse(rawCookies);
    const token = cookies[COOKIE_NAME];
    if (!token || !ENV.cookieSecret) return null;

    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.userId as number;

    if (typeof userId !== "number") return null;

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return user ?? null;
  } catch {
    return null;
  }
}
