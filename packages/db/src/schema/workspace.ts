import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { timestamps, uuidPrimaryKey } from "./helpers";

export const workspace = pgTable(
  "workspace",
  {
    ...uuidPrimaryKey,
    name: text("name").notNull(),
    nameKey: text("name_key")
      .generatedAlwaysAs(sql`fold_unique_name_v1("name")`)
      .notNull(),
    customerTemplateKey: text("customer_template_key"),
    customerTemplateFingerprint: text("customer_template_fingerprint"),
    customerTemplateAppliedAt: timestamp("customer_template_applied_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => [
    unique("uq_workspace_name_key").on(t.nameKey),
    unique("uq_workspace_customer_template_key").on(t.customerTemplateKey),
  ],
);
