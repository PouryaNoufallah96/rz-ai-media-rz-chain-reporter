import "server-only";

import { publicProcedure } from "@rz-chain-reporter/api";
import { auth } from "@rz-chain-reporter/auth";
import { signInThrottleRetryAfter } from "@rz-chain-reporter/auth/sign-in-throttle";
import { okSchema } from "@rz-chain-reporter/contracts";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { signInSchema } from "@/features/auth/schemas/sign-in";
import { webLogger } from "@/lib/logger";

const signedIn = z.object({ userId: z.string() });

export const signOut = publicProcedure
  .output(okSchema)
  .handler(async ({ context }) => {
    await auth.api.signOut({ headers: context.headers });
    return { ok: true as const };
  });

export const signIn = publicProcedure
  .input(signInSchema)
  .output(signedIn)
  .errors({
    INVALID_CREDENTIALS: { status: 401 },
    RATE_LIMITED: {
      status: 429,
      // Loose so the shared request-id middleware's correlation key survives
      // the declared shape.
      data: z
        .object({ retryAfterSeconds: z.number().int().positive() })
        .loose(),
    },
  })
  .handler(async ({ context, errors, input }) => {
    try {
      const result = await auth.api.signInEmail({
        body: input,
        headers: context.headers,
      });
      webLogger.info("auth.sign_in", {
        outcome: "succeeded",
        requestId: context.requestId,
        userId: result.user.id,
      });
      return { userId: result.user.id };
    } catch (error) {
      const retryAfterSeconds = signInThrottleRetryAfter(error);
      if (retryAfterSeconds !== null) {
        throw errors.RATE_LIMITED({ data: { retryAfterSeconds } });
      }
      if (
        error instanceof APIError &&
        error.body?.code === "INVALID_EMAIL_OR_PASSWORD"
      ) {
        webLogger.warn("auth.sign_in", {
          outcome: "invalid_credentials",
          requestId: context.requestId,
        });
        throw errors.INVALID_CREDENTIALS();
      }
      throw error;
    }
  });
