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

export function validateWorkerEnv(
  runtimeEnv: Record<string, string | undefined>,
) {
  return createEnv({
    server: {
      APP_VERSION: z.string().trim().min(1).optional(),
      APP_URL: httpOrigin.optional(),
      CACHE_INVALIDATION_WEBHOOK_SECRET: z.string().min(32).optional(),
      CUSTOMER_TEMPLATE_KEY: customerTemplateKey,
      DATABASE_URL: postgresUrl,
      FIRECRAWL_API_KEY: z.string().min(1).optional(),
      INNGEST_CONNECT_MAX_WORKER_CONCURRENCY: z.coerce
        .number()
        .int()
        .positive()
        .default(12),
      INNGEST_DEV: inngestDev,
      INNGEST_EVENT_KEY: z.string().min(1).optional(),
      INNGEST_SIGNING_KEY: z.string().min(1).optional(),
      OLLAMA_BASE_URL: httpUrl.optional(),
      OPENROUTER_API_KEY: z.string().min(1).optional(),
      PUBLISHING_EMERGENCY_PAUSED: z
        .enum(["1", "true"])
        .transform(() => true)
        .default(false),
      ...storageEnv,
      SENTRY_DSN: z.url().optional(),
      WEB_INTERNAL_BASE_URL: httpOrigin.optional(),
      WORKER_HEALTH_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65_535)
        .default(3002),
      WORKER_MODE: z.enum(["health-only", "durable"]),
      NODE_ENV: z.enum(["development", "production"]).default("development"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
