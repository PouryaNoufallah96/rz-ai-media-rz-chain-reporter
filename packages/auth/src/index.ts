import "server-only";

import { createDb } from "@rz-chain-reporter/db";
import * as schema from "@rz-chain-reporter/db/schema/auth";
import { env } from "@rz-chain-reporter/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

// HMR re-evaluates this module; a module-scope pool would leak per edit.
const pools = globalThis as typeof globalThis & {
  __authDb?: ReturnType<typeof createDb>;
};

export function createAuth() {
  pools.__authDb ??= createDb(env.DATABASE_URL);
  const { db } = pools.__authDb;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // HTTP /api/auth/* only. Server Action `auth.api.*` is throttled at oRPC.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    },
    plugins: [nextCookies()],
  });
}

export const auth = createAuth();
