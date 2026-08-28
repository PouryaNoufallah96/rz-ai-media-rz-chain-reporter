import "server-only";

import { tool } from "ai";
import { z } from "zod";

import type { AssistantAskUser } from "@/features/assistant/schemas/ui-message";

export const ASK_USER_TOOL = "ask_user";

export function askUserTool(choices: AssistantAskUser["choices"]) {
  return tool({
    description:
      "Ask the operator which media brand the question is about. The workspace owns the list of brands the operator will see; whatever you pass is ignored.",
    inputSchema: z.object({
      brandKeys: z
        .array(z.string().max(128))
        .max(8)
        .describe("The brands you think are candidates. Not used."),
    }),
    execute: (): AssistantAskUser => ({ choices }),
  });
}
