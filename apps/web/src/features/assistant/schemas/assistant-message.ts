import type { UIMessage } from "ai";

import type {
  AssistantAskUser,
  AssistantCitation,
  AssistantMessageMetadata,
} from "./ui-message";

export type AssistantUIMessage = UIMessage<
  AssistantMessageMetadata,
  {
    citation: AssistantCitation;
  },
  {
    ask_user: {
      input: AssistantAskUser;
      output: { choiceId: string };
    };
  }
>;
