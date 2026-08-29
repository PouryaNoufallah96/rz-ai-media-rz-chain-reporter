import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { draftRevision } from "./draft-revision";
import { editorialSelection } from "./editorial-selection";
import { platform } from "./enums";
import { filterResult } from "./filter-result";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { mediaBrand } from "./media-brand";
import { promoIdea } from "./promo-idea";
import { workspace } from "./workspace";

export const platformDraft = pgTable(
  "platform_draft",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaBrandId: uuid("media_brand_id").notNull(),
    platform: platform("platform").notNull(),
    editorialSelectionId: uuid("editorial_selection_id"),
    telegramFilterResultId: uuid("telegram_filter_result_id"),
    promoIdeaId: uuid("promo_idea_id"),
    lanePosition: integer("lane_position").notNull(),
    version: integer("version").default(1).notNull(),
    activeRevisionId: uuid("active_revision_id"),
    revisionVersion: integer("revision_version").default(0).notNull(),
    projectionVersion: integer("projection_version").default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_platform_draft_active_revision",
      columns: [t.workspaceId, t.id, t.activeRevisionId],
      foreignColumns: [
        draftRevision.workspaceId,
        draftRevision.platformDraftId,
        draftRevision.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_editorial_selection_id",
      columns: [t.editorialSelectionId],
      foreignColumns: [editorialSelection.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_telegram_filter_result_id",
      columns: [t.telegramFilterResultId],
      foreignColumns: [filterResult.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_promo_idea_id",
      columns: [t.promoIdeaId],
      foreignColumns: [promoIdea.id],
    }).onDelete("restrict"),
    check(
      "ck_platform_draft_exactly_one_origin",
      sql`num_nonnulls(${t.editorialSelectionId}, ${t.telegramFilterResultId}, ${t.promoIdeaId}) = 1`,
    ),
    check(
      "ck_platform_draft_lane_position_positive",
      sql`${t.lanePosition} > 0`,
    ),
    check("ck_platform_draft_version_positive", sql`${t.version} > 0`),
    check(
      "ck_platform_draft_revision_version_nonnegative",
      sql`${t.revisionVersion} >= 0`,
    ),
    check(
      "ck_platform_draft_projection_version_nonnegative",
      sql`${t.projectionVersion} >= 0`,
    ),
    uniqueIndex("uq_platform_draft_active_editorial_selection_route")
      .on(t.workspaceId, t.editorialSelectionId, t.mediaBrandId, t.platform)
      .where(
        sql`${t.deletedAt} is null and ${t.editorialSelectionId} is not null`,
      ),
    uniqueIndex("uq_platform_draft_active_telegram_filter_result_route")
      .on(t.workspaceId, t.telegramFilterResultId, t.mediaBrandId, t.platform)
      .where(
        sql`${t.deletedAt} is null and ${t.telegramFilterResultId} is not null`,
      ),
    uniqueIndex("uq_platform_draft_active_promo_idea_route")
      .on(t.workspaceId, t.promoIdeaId, t.mediaBrandId, t.platform)
      .where(sql`${t.deletedAt} is null and ${t.promoIdeaId} is not null`),
    index("ix_platform_draft_active_workspace_media_brand_platform")
      .on(t.workspaceId, t.mediaBrandId, t.platform, t.lanePosition, t.id)
      .where(sql`${t.deletedAt} is null`),
    index("ix_platform_draft_workspace_editorial_selection_id").on(
      t.workspaceId,
      t.editorialSelectionId,
    ),
    index("ix_platform_draft_workspace_telegram_filter_result_id").on(
      t.workspaceId,
      t.telegramFilterResultId,
    ),
    index("ix_platform_draft_workspace_promo_idea_id").on(
      t.workspaceId,
      t.promoIdeaId,
    ),
  ],
);
