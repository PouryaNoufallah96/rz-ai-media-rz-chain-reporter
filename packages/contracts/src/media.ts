import { z } from "zod";

export const MEDIA_ASSET_LIFECYCLES = [
  "pending",
  "uploaded",
  "validating",
  "verified",
  "rejected",
  "expired",
] as const;

export type MediaAssetLifecycle = (typeof MEDIA_ASSET_LIFECYCLES)[number];

export const mediaAssetLifecycleSchema = z.enum(MEDIA_ASSET_LIFECYCLES);

export const confirmedMediaAssetLifecycleSchema =
  mediaAssetLifecycleSchema.exclude(["pending", "expired"]);

export const REFERENCE_IMAGE_KIND = "reference_image";
export const MARKET_CHART_RENDER_MEDIA_KIND = "market_chart_render";
export const MARKET_GENERATION_FINAL_MEDIA_KIND = "market_generation_final";
export const MAX_REFERENCE_IMAGE_BYTES = 900 * 1024;
export const MAX_REFERENCE_IMAGE_DIMENSION = 4096;
export const MAX_REFERENCE_IMAGE_PIXELS = 16_000_000;
export const REFERENCE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const referenceImageMimeTypeSchema = z.enum(REFERENCE_IMAGE_MIME_TYPES);

export const MEDIA_DERIVATION_PURPOSES = [
  "sharp_brand_logo",
  "market_analysis_footer_lockup",
] as const;

export type MediaDerivationPurpose = (typeof MEDIA_DERIVATION_PURPOSES)[number];
