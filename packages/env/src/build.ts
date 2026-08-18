import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import {
  customerTemplateKey,
  httpOrigin,
  httpUrl,
  postgresUrl,
} from "./schema";

export function validateBuildEnv(
  runtimeEnv: Record<string, string | undefined>,
) {
  return createEnv({
    server: {
      CUSTOMER_TEMPLATE_KEY: customerTemplateKey,
      DATABASE_URL: postgresUrl,
      BETTER_AUTH_SECRET: z.string().min(32),
      BETTER_AUTH_URL: httpUrl,
      CORS_ORIGIN: httpOrigin,
      APP_URL: httpOrigin,
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
