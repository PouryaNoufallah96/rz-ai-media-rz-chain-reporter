import "server-only";
import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import {
  customerTemplateKey,
  httpOrigin,
  httpUrl,
  inngestDev,
  postgresUrl,
  storageEnv,
} from "./schema";

export const env = createEnv({
  server: {
    CUSTOMER_TEMPLATE_KEY: customerTemplateKey,
    DATABASE_URL: postgresUrl,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: httpUrl,
    CORS_ORIGIN: httpOrigin,
    // Public origin for sitemap/robots. Not CORS_ORIGIN or BETTER_AUTH_URL.
    APP_URL: httpOrigin,
    INNGEST_DEV: inngestDev,
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    ...storageEnv,
    SENTRY_DSN: z.url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
