import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { httpOrigin, postgresUrl } from "./schema";

export function validateMigrationEnv(
  runtimeEnv: Record<string, string | undefined>,
) {
  return createEnv({
    server: {
      CACHE_INVALIDATION_WEBHOOK_SECRET: z.string().min(32).optional(),
      MIGRATION_DATABASE_URL: postgresUrl,
      NODE_ENV: z.enum(["development", "production"]).default("development"),
      WEB_INTERNAL_BASE_URL: httpOrigin.optional(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
