import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { editorialSelection } from "./editorial-selection";
import { contentLocale } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { operationAttempt } from "./operation-attempt";
import { promoIdea } from "./promo-idea";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

export const editorialPresentationLocalization = pgTable(
  "editorial_presentation_localization",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceItemRevisionId: uuid("source_item_revision_id"),
    editorialSelectionId: uuid("editorial_selection_id"),
    promoIdeaId: uuid("promo_idea_id"),
    presentationLocale: contentLocale("presentation_locale").notNull(),
    operationAttemptId: uuid("operation_attempt_id").notNull(),
    title: text("title"),
    summary: text("summary"),
    reasoning: text("reasoning"),
    description: text("description"),
    angle: text("angle"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_editorial_presentation_localization_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_presentation_localization_source_item_revision_id",
      columns: [t.sourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_presentation_localization_editorial_selection_id",
      columns: [t.editorialSelectionId],
      foreignColumns: [editorialSelection.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_presentation_localization_promo_idea_id",
      columns: [t.promoIdeaId],
      foreignColumns: [promoIdea.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_presentation_localization_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    check(
      "ck_editorial_presentation_localization_exactly_one_subject",
      sql`num_nonnulls(${t.sourceItemRevisionId}, ${t.editorialSelectionId}, ${t.promoIdeaId}) = 1`,
    ),
    check(
      "ck_editorial_presentation_localization_payload_shape",
      sql`(
          ${t.sourceItemRevisionId} is not null
          and ${t.title} is not null
          and btrim(${t.title}) <> ''
          and (${t.summary} is null or btrim(${t.summary}) <> '')
          and ${t.reasoning} is null
          and ${t.description} is null
          and ${t.angle} is null
        ) or (
          ${t.editorialSelectionId} is not null
          and ${t.reasoning} is not null
          and btrim(${t.reasoning}) <> ''
          and ${t.title} is null
          and ${t.summary} is null
          and ${t.description} is null
          and ${t.angle} is null
        ) or (
          ${t.promoIdeaId} is not null
          and ${t.title} is not null
          and btrim(${t.title}) <> ''
          and ${t.description} is not null
          and btrim(${t.description}) <> ''
          and ${t.angle} is not null
          and btrim(${t.angle}) <> ''
          and ${t.summary} is null
          and ${t.reasoning} is null
        )`,
    ),
    uniqueIndex("uq_editorial_presentation_localization_source_revision_locale")
      .on(t.workspaceId, t.sourceItemRevisionId, t.presentationLocale)
      .where(sql`${t.sourceItemRevisionId} is not null`),
    uniqueIndex("uq_editorial_presentation_localization_selection_locale")
      .on(t.workspaceId, t.editorialSelectionId, t.presentationLocale)
      .where(sql`${t.editorialSelectionId} is not null`),
    uniqueIndex("uq_editorial_presentation_localization_promo_idea_locale")
      .on(t.workspaceId, t.promoIdeaId, t.presentationLocale)
      .where(sql`${t.promoIdeaId} is not null`),
  ],
);
