import "server-only";
import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { deploymentEnv, httpUrl, inngestDev, storageEnv } from "./schema";

export const env = createEnv({
  server: {
    ...deploymentEnv,
    ASSISTANT_APPROVAL_SECRET: z.string().min(32),
    CACHE_INVALIDATION_WEBHOOK_SECRET: z.string().min(32).optional(),
    INNGEST_DEV: inngestDev,
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    OLLAMA_BASE_URL: httpUrl.optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PUBLISHING_EMERGENCY_PAUSED: z
      .enum(["1", "true"])
      .transform(() => true)
      .default(false),
    ...storageEnv,
    SENTRY_DSN: z.url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
