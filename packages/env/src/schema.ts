import { z } from "zod";

export const postgresUrl = z.url({
  protocol: /^postgres(?:ql)?$/,
});

export const httpUrl = z.url({
  protocol: /^https?$/,
});

export { stableKeySchema as customerTemplateKey } from "@rz-chain-reporter/customer-template/stable-key";

export const httpOrigin = httpUrl.refine(
  (value) => value === new URL(value).origin,
  "Expected an HTTP(S) origin without credentials, path, query, or fragment",
);

export const inngestDev = z.enum(["1", "true"]).optional();

export const storageEnv = {
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ENDPOINT: httpOrigin.optional(),
  S3_REGION: z.literal("us-east-1").optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
} as const;
