import "server-only";

import { tool } from "ai";
import { z } from "zod";
import {
  assistantRunToolInputSchema,
  START_RUN_TOOL,
} from "../schemas/approval";
import type { AssistantAskUser } from "../schemas/ui-message";
import { marketAssistantTools } from "./tools/market-tools.server";

export const ASK_USER_TOOL = "ask_user";

export function askUserTool(choices: AssistantAskUser["choices"]) {
  return tool({
    description:
      "Ask the operator which media brand the question is about. The workspace owns the list of brands the operator will see.",
    inputSchema: z.object({}),
    execute: (): AssistantAskUser => ({ choices }),
  });
}

export type AskUserTool = ReturnType<typeof askUserTool>;

const startRunTool = tool({
  description:
    "Prepare exactly one News or Promo run. Include only operator-stated values. The application resolves owner defaults, asks for missing material values, shows the complete configuration, and requires a later explicit Approve click before creating the run.",
  inputSchema: assistantRunToolInputSchema,
});

export function assistantToolRegistry(
  input: { askUser?: AskUserTool; marketEnabled: boolean } = {
    marketEnabled: true,
  },
) {
  return {
    [START_RUN_TOOL]: startRunTool,
    ...(input.marketEnabled ? marketAssistantTools : {}),
    ...(input.askUser ? { ask_user: input.askUser } : {}),
  };
}

export type AssistantToolRegistry = ReturnType<typeof assistantToolRegistry>;
