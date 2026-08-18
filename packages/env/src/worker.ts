import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { customerTemplateKey, httpUrl, postgresUrl } from "./schema";

export const workerEnv = createEnv({
  server: {
    CUSTOMER_TEMPLATE_KEY: customerTemplateKey,
    DATABASE_URL: postgresUrl,
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    // Absent unless this deployment's customer template selects the local
    // Ollama backend for a task (ADR 0008).
    OLLAMA_BASE_URL: httpUrl.optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    WORKER_HEALTH_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(3002),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
