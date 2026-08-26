import {
  MAX_REFERENCE_IMAGE_BYTES,
  REFERENCE_IMAGE_KIND,
  referenceImageMimeTypeSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

export const createMediaUploadInputSchema = z.strictObject({
  file: z.file().max(MAX_REFERENCE_IMAGE_BYTES),
  declaredBytes: z.number().int().positive().max(MAX_REFERENCE_IMAGE_BYTES),
  declaredChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  declaredMimeType: referenceImageMimeTypeSchema,
  kind: z.enum(["image", REFERENCE_IMAGE_KIND]),
});

export const mediaUploadIntentSchema = z.strictObject({
  mediaAssetId: z.uuid(),
  lifecycle: z.literal("pending"),
  uploadExpiresAt: z.date(),
});

export const confirmMediaUploadInputSchema = z.strictObject({
  mediaAssetId: z.uuid(),
});

export const mediaUploadConfirmationSchema = z.strictObject({
  mediaAssetId: z.uuid(),
  lifecycle: z.enum(["uploaded", "validating", "verified", "rejected"]),
  replayed: z.boolean(),
});
