import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const authThrottle = pgTable(
  "auth_throttle",
  {
    bucket: text("bucket").primaryKey(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    attemptCount: integer("attempt_count").notNull(),
  },
  (t) => [index("ix_auth_throttle_window_started_at").on(t.windowStartedAt)],
);
