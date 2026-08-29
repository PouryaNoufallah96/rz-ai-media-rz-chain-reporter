import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { deploymentEnv } from "./schema";

export function validateBuildEnv(
  runtimeEnv: Record<string, string | undefined>,
) {
  return createEnv({
    server: {
      ...deploymentEnv,
      APP_VERSION: z.string().min(1).optional(),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
