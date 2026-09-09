import "server-only";

import { tool } from "ai";

import {
  assistantMarketToolInputSchema,
  MARKET_ACTION_TOOL,
} from "../../schemas/approval";

export const marketAssistantTools = {
  [MARKET_ACTION_TOOL]: tool({
    description:
      "Prepare one new Market Analysis when MARKET_OPTIONS says the feature is enabled. Use exact instruments and comparisons from MARKET_OPTIONS, include only operator-stated values, and send [] only when the operator explicitly requests no comparisons. The application resolves owner options, asks for missing setup values, previews the request, and requires a later explicit Approve click. Chart, Story, Design, Generate, and Publish work stays in the Market Analysis workspace.",
    inputSchema: assistantMarketToolInputSchema,
  }),
} as const;
