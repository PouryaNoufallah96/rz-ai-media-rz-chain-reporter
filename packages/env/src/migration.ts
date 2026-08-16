import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { postgresUrl } from "./schema";

export function validateMigrationEnv(
  runtimeEnv: Record<string, string | undefined>,
) {
  return createEnv({
    server: {
      MIGRATION_DATABASE_URL: postgresUrl,
      NODE_ENV: z.enum(["development", "production"]).default("development"),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
