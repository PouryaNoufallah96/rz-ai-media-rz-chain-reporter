import { foreignKey, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Retention is stored, not enforced; Phase 9 owns the process that acts on expires_at.
export const assistantConversation = pgTable(
  "assistant_conversation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    userId: text("user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_assistant_conversation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_assistant_conversation_user_id",
      columns: [t.userId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
  ],
);
