import { LOCALES } from "@rz-chain-reporter/i18n";
import { z } from "zod";

export const assistantCitationSchema = z.strictObject({
  sourceId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  locale: z.enum(LOCALES).nullable(),
  templateFingerprint: z.string().regex(/^[a-f0-9]{16}$/),
});

export type AssistantCitation = z.infer<typeof assistantCitationSchema>;

export const assistantAskUserSchema = z.strictObject({
  choices: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        label: z.string().min(1).max(200),
      }),
    )
    .min(2)
    .max(4),
});

export type AssistantAskUser = z.infer<typeof assistantAskUserSchema>;

export const assistantMessageMetadataSchema = z.strictObject({
  createdAt: z.number().int().positive(),
});

export type AssistantMessageMetadata = z.infer<
  typeof assistantMessageMetadataSchema
>;
