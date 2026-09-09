import {
  contentLocaleSchema,
  platformSchema,
} from "@rz-chain-reporter/contracts";
import { LOCALES } from "@rz-chain-reporter/i18n";
import { z } from "zod";

import { customerEditorial } from "@/lib/customer-template.server";
import { MAX_QUESTION_CHARS } from "../constants";
import {
  assistantPendingMarketSchema,
  assistantPendingRunSchema,
} from "./approval";
import { assistantConversationContextSchema } from "./assistant-message";
import { assistantMessageMetadataSchema } from "./ui-message";

const brandKeys = customerEditorial.bounds.brandKeys;

const headlineMax = customerEditorial.drafting.copy.modelMaxChars;

const copyMaxByPlatform = new Map(
  customerEditorial.drafting.copy.platforms.map((policy) => [
    policy.platform,
    policy.assembledCharacters.max,
  ]),
);

export const assistantCardLimits = {
  headline: headlineMax,
  copyByPlatform: Object.fromEntries(copyMaxByPlatform),
};

const MAX_CARD_HEADLINE_CHARS = headlineMax;

const MAX_CARD_COPY_CHARS = Math.max(...copyMaxByPlatform.values());

// Closed by construction: an unknown part, tool call, file, or reasoning block
// fails the strict object before any retrieval or model work is considered.
const latestUserTurnSchema = z.strictObject({
  id: z.string().min(1).max(128),
  metadata: assistantMessageMetadataSchema,
  role: z.literal("user"),
  parts: z
    .array(
      z.strictObject({
        type: z.literal("text"),
        text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
      }),
    )
    .length(1),
});

const activeCardSchema = z.strictObject({
  draftId: z.uuid(),
  contentLocale: contentLocaleSchema,
  platform: platformSchema,
  headline: z.string().max(MAX_CARD_HEADLINE_CHARS),
  copy: z.string().max(MAX_CARD_COPY_CHARS),
});

export const assistantChatRequestSchema = z.strictObject({
  message: latestUserTurnSchema,
  context: assistantConversationContextSchema,
  locale: z.enum(LOCALES),
  brandKeys: z.array(z.enum(brandKeys)).max(brandKeys.length),
  card: activeCardSchema.nullable(),
  pendingRun: assistantPendingRunSchema.nullable(),
  pendingMarket: assistantPendingMarketSchema.nullable(),
  marketAnalysisId: z.uuid().nullable().catch(null),
  // A stale or malformed `?run=` must not fail the turn; it simply pins nothing.
  runId: z.uuid().nullable().catch(null),
});

export type AssistantChatRequest = z.infer<typeof assistantChatRequestSchema>;

export type AssistantActiveCard = z.infer<typeof activeCardSchema>;
