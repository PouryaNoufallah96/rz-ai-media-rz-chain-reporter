import { LOCALES } from "@rz-chain-reporter/i18n";
import type {
  InferUITools,
  UIMessage,
  UIMessageChunk,
  UIToolInvocation,
} from "ai";
import { z } from "zod";

import type { AssistantToolRegistry } from "../lib/tool-registry.server";
import type { AssistantReadTools } from "../lib/tools/read-tools.server";
import type {
  AssistantMarketResult,
  AssistantPendingMarket,
  AssistantPendingRun,
  AssistantRunResult,
  SignedApprovalEnvelope,
  SignedMarketApprovalEnvelope,
} from "./approval";

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

export const assistantSupersededSchema = z.strictObject({
  toolCallId: z.string().max(128),
  reason: z.enum(["edit", "cancel"]).optional(),
});

export type AssistantSuperseded = z.infer<typeof assistantSupersededSchema>;

type AssistantUITools = InferUITools<
  AssistantToolRegistry & AssistantReadTools
>;

type AssistantUIData = {
  citation: AssistantCitation;
  "response-error": true;
  "market-proposal": {
    envelope: SignedMarketApprovalEnvelope;
    toolCallId: string;
  };
  "market-intent": AssistantPendingMarket & { toolCallId: string };
  "market-result": AssistantMarketResult & { toolCallId: string };
  "market-superseded": AssistantSuperseded;
  "run-proposal": {
    envelope: SignedApprovalEnvelope;
    toolCallId: string;
  };
  "run-intent": AssistantPendingRun & { toolCallId: string };
  "run-result": AssistantRunResult & { toolCallId: string };
  "run-superseded": AssistantSuperseded;
  "usage-settled": true;
};

export type AssistantUIMessage = UIMessage<
  AssistantMessageMetadata,
  AssistantUIData,
  AssistantUITools
>;

type AssistantUIMessageChunk = UIMessageChunk<
  AssistantMessageMetadata,
  AssistantUIData
>;

export function isAssistantNativeToolError(
  chunk: AssistantUIMessageChunk,
): chunk is Extract<
  AssistantUIMessageChunk,
  { type: "tool-input-error" | "tool-output-error" }
> {
  return (
    chunk.type === "tool-input-error" || chunk.type === "tool-output-error"
  );
}

export type StartRunToolInvocation = UIToolInvocation<
  AssistantUITools["start_run"]
>;
export type MarketActionToolInvocation = UIToolInvocation<
  AssistantUITools["market_action"]
>;
