import "server-only";

import { publicProcedure } from "@rz-chain-reporter/api";
import { auth } from "@rz-chain-reporter/auth";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { signInSchema } from "@/features/auth/schemas/sign-in";
import { signUpSchema } from "@/features/auth/schemas/sign-up";

const signedIn = z.object({ userId: z.string() });

export const signOut = publicProcedure
  .output(z.object({ ok: z.literal(true) }))
  .handler(async ({ context }) => {
    await auth.api.signOut({ headers: context.headers });
    return { ok: true as const };
  });

export const signIn = publicProcedure
  .input(signInSchema)
  .output(signedIn)
  .errors({ INVALID_CREDENTIALS: { status: 401 } })
  .handler(async ({ context, errors, input }) => {
    try {
      const result = await auth.api.signInEmail({
        body: input,
        headers: context.headers,
      });
      return { userId: result.user.id };
    } catch (error) {
      if (error instanceof APIError) {
        throw errors.INVALID_CREDENTIALS();
      }
      throw error;
    }
  });

export const signUp = publicProcedure
  .input(signUpSchema)
  .output(signedIn)
  .errors({
    EMAIL_TAKEN: { status: 409 },
    SIGN_UP_REJECTED: { status: 400 },
  })
  .handler(async ({ context, errors, input }) => {
    try {
      const result = await auth.api.signUpEmail({
        body: input,
        headers: context.headers,
      });
      return { userId: result.user.id };
    } catch (error) {
      if (error instanceof APIError) {
        throw error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
          ? errors.EMAIL_TAKEN()
          : errors.SIGN_UP_REJECTED();
      }
      throw error;
    }
  });
