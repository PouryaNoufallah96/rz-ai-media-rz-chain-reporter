import "server-only";

import { createDb } from "@rz-chain-reporter/db";
import * as schema from "@rz-chain-reporter/db/schema/auth";
import { env } from "@rz-chain-reporter/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { createSignInThrottleHook } from "./sign-in-throttle";

// HMR re-evaluates this module; a module-scope pool would leak per edit.
const pools = globalThis as typeof globalThis & {
  __authDb?: ReturnType<typeof createDb>;
};

function createAuth() {
  pools.__authDb ??= createDb(env.DATABASE_URL);
  const { db } = pools.__authDb;

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      // Without `trustedProxies`, 1.6.29 nulls a multi-value X-Forwarded-For.
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: ["127.0.0.1/32", "::1/128"],
        ipv6Subnet: 64,
      },
    },
    // Handler limiter is a looser backup; the auth_throttle hook is the atomic policy.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 30 },
      },
    },
    hooks: {
      before: createSignInThrottleHook(db),
    },
    plugins: [nextCookies()],
  });
}

export const auth = createAuth();
