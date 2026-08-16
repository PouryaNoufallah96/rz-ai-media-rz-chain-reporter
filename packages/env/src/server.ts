import "server-only";
import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { httpOrigin, httpUrl, postgresUrl } from "./schema";

export const env = createEnv({
  server: {
    DATABASE_URL: postgresUrl,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: httpUrl,
    CORS_ORIGIN: httpOrigin,
    // Public origin for sitemap/robots. Not CORS_ORIGIN or BETTER_AUTH_URL.
    APP_URL: httpOrigin,
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
