import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../drizzle/schema";
import { jwtVerify } from "jose";
import { ENV } from "./env";
import { db } from "../db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import cookie from "cookie";

/**
 * The signed-in member as every procedure sees them.
 *
 * `role` is the EFFECTIVE role. An admin who has put their admin rights down
 * is presented here as a plain member, which is the whole point: the forty-odd
 * places that ask "is this an admin?" — both admin guards included — then give
 * the member answer without any of them being changed or remembering to.
 *
 * `realRole` is what the database actually says, and only one thing uses it:
 * the switch that turns the rights back on. If turning them off demoted the
 * row, turning them on again would need the permission they had just given
 * up, and an admin would lock themselves out of their own choir.
 */
export type ContextUser = User & { realRole: User["role"] };

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: ContextUser | null;
};

/** Present an admin who is viewing as a member as a member. */
export function withEffectiveRole(row: User): ContextUser {
  const viewingAsMember = row.role === "admin" && row.adminMode === false;
  return { ...row, realRole: row.role, role: viewingAsMember ? "user" : row.role };
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: ContextUser | null = null;

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
        user = found ? withEffectiveRole(found) : null;
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
