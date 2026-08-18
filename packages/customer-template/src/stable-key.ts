import { z } from "zod";

// One grammar for template validation, the loader, and environment validation.
export const stableKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Expected a lowercase hyphenated key");
