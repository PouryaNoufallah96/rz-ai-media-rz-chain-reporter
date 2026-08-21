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
