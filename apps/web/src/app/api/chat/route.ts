import "server-only";

import { validateUIMessages } from "ai";
import { connection } from "next/server";
import { assistantToolRegistry } from "@/features/assistant/lib/tool-registry.server";
import { assistantChatRequestSchema } from "@/features/assistant/schemas/chat-request";
import {
  type AssistantUIMessage,
  assistantMessageMetadataSchema,
} from "@/features/assistant/schemas/ui-message";
import { readAssistantRequest, rejected } from "./request-boundary";
import { respondToAssistantTurn } from "./respond";

export async function POST(request: Request) {
  await connection();
  const boundary = await readAssistantRequest(
    request,
    assistantChatRequestSchema,
  );
  if (!boundary.ok) return boundary.response;
  try {
    await validateUIMessages<AssistantUIMessage>({
      messages: [boundary.data.message],
      metadataSchema: assistantMessageMetadataSchema,
      tools: assistantToolRegistry(),
    });
  } catch {
    return rejected(400);
  }
  return respondToAssistantTurn(
    boundary.data,
    boundary.userId,
    boundary.workspaceId,
    request.signal,
  );
}
