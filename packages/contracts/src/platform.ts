import { z } from "zod";

export const PLATFORMS = ["x", "telegram", "instagram"] as const;

export type Platform = (typeof PLATFORMS)[number];

export const platformSchema = z.enum(PLATFORMS);

export const SOURCE_ORIGINS = ["rss", "telegram_public"] as const;

export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const sourceOriginSchema = z.enum(SOURCE_ORIGINS);
