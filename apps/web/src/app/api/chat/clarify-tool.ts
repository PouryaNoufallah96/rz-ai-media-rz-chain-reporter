import "server-only";

import { tool } from "ai";
import { z } from "zod";

import type { AssistantAskUser } from "@/features/assistant/schemas/ui-message";

export const ASK_USER_TOOL = "ask_user";

export function askUserTool(choices: AssistantAskUser["choices"]) {
  return tool({
    description:
      "Ask the operator which media brand the question is about. The workspace owns the list of brands the operator will see.",
    inputSchema: z.object({}),
    execute: (): AssistantAskUser => ({ choices }),
  });
}
