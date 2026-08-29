import "server-only";

import { ORPCError, os } from "@orpc/server";

import { type Context, NotProvisionedError } from "./context";

export const o = os.$context<Context>();

function mergeableData(data: unknown): Record<string, unknown> | undefined {
  if (data === undefined) return {};
  if (typeof data !== "object" || data === null) return undefined;

  const prototype = Object.getPrototypeOf(data);
  return prototype === Object.prototype || prototype === null
    ? (data as Record<string, unknown>)
    : undefined;
}

// Keep code, status, message, and `defined` verbatim so the declared error map still matches.
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

export const protectedProcedure = publicProcedure
  .errors({ UNAUTHORIZED: { status: 401 } })
  .use(async ({ context, errors, next }) => {
    const session = await context.getSession();
    if (!session?.user) {
      throw errors.UNAUTHORIZED();
    }
    return next({ context: { session } });
  });

// Zero or several workspace rows is a provisioning fault, not an unreachable database.
export const installationProcedure = protectedProcedure
  .errors({ NOT_PROVISIONED: { status: 503 } })
  .use(async ({ context, errors, next }) => {
    let workspaceId: string;

    try {
      workspaceId = await context.getWorkspaceId();
    } catch (error) {
      if (error instanceof NotProvisionedError) {
        throw errors.NOT_PROVISIONED();
      }
      throw error;
    }

    return next({ context: { workspaceId } });
  });
