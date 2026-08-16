import "server-only";

import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

function mergeableData(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return {};
  if (typeof data !== "object" || data === null) return undefined;

  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null
    ? (data as Record<string, unknown>)
    : undefined;
}

// Correlation only: code, status, message, and `defined` stay verbatim so the
// contract's error map still validates the error as declared.
const attachRequestId = o.middleware(async ({ context, next }) => {
  try {
    return await next();
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;

    const data = mergeableData(error.data);
    if (!data) throw error;

    throw new ORPCError(error.code, {
      cause: error.cause,
      data: { ...data, requestId: context.requestId },
      defined: error.defined,
      message: error.message,
      status: error.status,
    });
  }
});

export const publicProcedure = o.use(attachRequestId);

const requireAuth = o.middleware(async ({ context, next }) => {
  const session = await context.getSession();
  if (!session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({ context: { session } });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
