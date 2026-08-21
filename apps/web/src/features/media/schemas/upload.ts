import { z } from "zod";

export const MAX_MEDIA_TRANSPORT_BYTES = 900 * 1024;

export const createMediaUploadInputSchema = z.strictObject({
  file: z.file().max(MAX_MEDIA_TRANSPORT_BYTES),
  declaredBytes: z.number().int().positive().max(MAX_MEDIA_TRANSPORT_BYTES),
  declaredChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  declaredMimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  kind: z.literal("image"),
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
