import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { editorialSelection } from "./editorial-selection";
import { contentLocale } from "./enums";
import { filterResult } from "./filter-result";
import { workspaceScope } from "./helpers";
import { operation } from "./operation";
import { promoIdea } from "./promo-idea";
import { workspace } from "./workspace";

export const editorialPresentationLocalizationRequest = pgTable(
  "editorial_presentation_localization_request",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    editorialSelectionId: uuid("editorial_selection_id"),
    telegramFilterResultId: uuid("telegram_filter_result_id"),
    promoIdeaId: uuid("promo_idea_id"),
    presentationLocale: contentLocale("presentation_locale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_presentation_translation_request_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_presentation_translation_request_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_presentation_translation_request_selection_id",
      columns: [t.editorialSelectionId],
      foreignColumns: [editorialSelection.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_presentation_translation_request_filter_result_id",
      columns: [t.telegramFilterResultId],
      foreignColumns: [filterResult.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_presentation_translation_request_promo_idea_id",
      columns: [t.promoIdeaId],
      foreignColumns: [promoIdea.id],
    }).onDelete("restrict"),
    check(
      "ck_presentation_translation_request_exactly_one_origin",
      sql`num_nonnulls(${t.editorialSelectionId}, ${t.telegramFilterResultId}, ${t.promoIdeaId}) = 1`,
    ),
    index("ix_presentation_translation_request_selection_locale")
      .on(
        t.workspaceId,
        t.editorialSelectionId,
        t.presentationLocale,
        t.createdAt.desc(),
        t.operationId,
      )
      .where(sql`${t.editorialSelectionId} is not null`),
    index("ix_presentation_translation_request_telegram_locale")
      .on(
        t.workspaceId,
        t.telegramFilterResultId,
        t.presentationLocale,
        t.createdAt.desc(),
        t.operationId,
      )
      .where(sql`${t.telegramFilterResultId} is not null`),
    index("ix_presentation_translation_request_promo_locale")
      .on(
        t.workspaceId,
        t.promoIdeaId,
        t.presentationLocale,
        t.createdAt.desc(),
        t.operationId,
      )
      .where(sql`${t.promoIdeaId} is not null`),
  ],
);
