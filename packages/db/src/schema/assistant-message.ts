import { foreignKey, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { assistantConversation } from "./assistant-conversation";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Owned by its conversation and discarded with it. Reviewed knowledge lives in
// no table this phase: chunks and vectors are Phase 9.
export const assistantMessage = pgTable(
  "assistant_message",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    conversationId: uuid("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_assistant_message_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_assistant_message_conversation_id",
      columns: [t.conversationId],
      foreignColumns: [assistantConversation.id],
    }).onDelete("cascade"),
  ],
);
