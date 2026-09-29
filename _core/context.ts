import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../drizzle/schema";
import { jwtVerify } from "jose";
import { ENV } from "./env";
import { db } from "../db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import cookie from "cookie";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const rawCookies = opts.req.headers.cookie ?? "";
    const cookies = cookie.parse(rawCookies);
    const token = cookies[COOKIE_NAME];

    if (token && ENV.cookieSecret) {
      const secret = new TextEncoder().encode(ENV.cookieSecret);
      const { payload } = await jwtVerify(token, secret);
      const userId = payload.userId as number;

      if (typeof userId === "number") {
        const [found] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        user = found ?? null;
      }
    }
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
