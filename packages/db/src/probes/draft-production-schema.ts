import { randomUUID } from "node:crypto";
import {
  cardOriginReferenceSchema,
  draftRevisionMaterialSchema,
  MEDIA_DERIVATION_PURPOSES,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: "../../.env.migration" });

const migrationEnv = validateMigrationEnv(process.env);
const client = new pg.Client({
  connectionString: migrationEnv.MIGRATION_DATABASE_URL,
});
const ids = {
  workspace: randomUUID(),
  brand: randomUUID(),
  source: randomUUID(),
  sourceItem: randomUUID(),
  analysisOperation: randomUUID(),
  analysisRun: randomUUID(),
  analysisUnit: randomUUID(),
  selection: randomUUID(),
  filterResult: randomUUID(),
  promoIdea: randomUUID(),
  platformDraft: randomUUID(),
  copyOperation: randomUUID(),
  copyAttempt: randomUUID(),
  copyUnit: randomUUID(),
  copyVariant: randomUUID(),
  draftRevision: randomUUID(),
  originalAsset: randomUUID(),
  finalAsset: randomUUID(),
  unrelatedAsset: randomUUID(),
  derivation: randomUUID(),
  imageOperation: randomUUID(),
  imageGeneration: randomUUID(),
};
const actorId = `draft-production-schema-${randomUUID()}`;
const observed: string[] = [];

await client.connect();

try {
  assertClosedContracts();
  await client.query("begin");
  await insertFixture();

  await expectConstraint(
    "zero-origin",
    "ck_platform_draft_exactly_one_origin",
    `insert into platform_draft
      (id, workspace_id, media_brand_id, platform, lane_position, version)
     values ($1, $2, $3, 'x', 2, 1)`,
    [randomUUID(), ids.workspace, ids.brand],
  );
  await expectConstraint(
    "two-origins",
    "ck_platform_draft_exactly_one_origin",
    `insert into platform_draft
      (id, workspace_id, media_brand_id, platform, editorial_selection_id,
       telegram_filter_result_id, lane_position, version)
     values ($1, $2, $3, 'x', $4, $5, 2, 1)`,
    [randomUUID(), ids.workspace, ids.brand, ids.selection, ids.filterResult],
  );
  await expectConstraint(
    "duplicate-active-route",
    "uq_platform_draft_active_editorial_selection_route",
    `insert into platform_draft
      (id, workspace_id, media_brand_id, platform, editorial_selection_id,
       lane_position, version)
     values ($1, $2, $3, 'telegram', $4, 2, 1)`,
    [randomUUID(), ids.workspace, ids.brand, ids.selection],
  );
  await expectConstraint(
    "invalid-receipt",
    "ck_draft_revision_command_receipt_idempotency_key_nonempty",
    `insert into draft_revision_command_receipt
      (id, workspace_id, actor_id, platform_draft_id, command_kind,
       idempotency_key, request_hash, resulting_draft_revision_id,
       appended_revision)
     values ($1, $2, $3, $4, 'submit_content', ' ', 'hash', $5, true)`,
    [
      randomUUID(),
      ids.workspace,
      actorId,
      ids.platformDraft,
      ids.draftRevision,
    ],
  );

  await client.query(
    `insert into draft_revision_command_receipt
      (id, workspace_id, actor_id, platform_draft_id, command_kind,
       idempotency_key, request_hash, resulting_draft_revision_id,
       appended_revision)
     values ($1, $2, $3, $4, 'submit_content', 'receipt-key', 'hash', $5, true)`,
    [
      randomUUID(),
      ids.workspace,
      actorId,
      ids.platformDraft,
      ids.draftRevision,
    ],
  );
  await expectConstraint(
    "duplicate-receipt",
    "uq_draft_revision_command_receipt_identity",
    `insert into draft_revision_command_receipt
      (id, workspace_id, actor_id, platform_draft_id, command_kind,
       idempotency_key, request_hash, resulting_draft_revision_id,
       appended_revision)
     values ($1, $2, $3, $4, 'submit_content', 'receipt-key', 'hash', $5, true)`,
    [
      randomUUID(),
      ids.workspace,
      actorId,
      ids.platformDraft,
      ids.draftRevision,
    ],
  );
  await expectConstraint(
    "media-role-equality",
    "ck_image_generation_distinct_media_roles",
    `insert into image_generation
      (operation_id, workspace_id, draft_revision_id, model_option_key,
       reference_media_asset_id, provider_original_media_asset_id)
     values ($1, $2, $3, 'dev', $4, $4)`,
    [ids.imageOperation, ids.workspace, ids.draftRevision, ids.originalAsset],
  );
  await expectConstraint(
    "media-derivation-required",
    "fk_image_generation_final_media_derivation",
    `insert into image_generation
      (operation_id, workspace_id, draft_revision_id, model_option_key,
       provider_original_media_asset_id, final_media_asset_id)
     values ($1, $2, $3, 'dev', $4, $5)`,
    [
      ids.imageOperation,
      ids.workspace,
      ids.draftRevision,
      ids.originalAsset,
      ids.unrelatedAsset,
    ],
  );
  const imageBriefWithDirection = `insert into image_brief
      (id, workspace_id, draft_revision_id,
       template_selection_operation_attempt_id, operator_direction,
       source_projection_kind, source_projection_version,
       source_projection_digest, promo_idea_id, brand_policy_fingerprint,
       image_profile_fingerprint, prompt_schema_version, assembler_version,
       configuration_version)
     values ($1, $2, $3, $4, $5, 'promo_idea', 'probe-v1', 'probe', $6,
       'probe-brand', 'probe-profile', 'probe-prompt', 'probe-assembler',
       'probe-configuration')`;
  for (const [label, direction] of [
    ["image-brief-direction-codepoints", "a".repeat(1_001)],
    ["image-brief-direction-utf8", "😀".repeat(1_001)],
    ["image-brief-direction-control", "safe\u0001unsafe"],
    ["image-brief-direction-bidi", "safe\u202Eunsafe"],
  ] as const) {
    await expectConstraint(
      label,
      "ck_image_brief_operator_direction_bounds",
      imageBriefWithDirection,
      [
        randomUUID(),
        ids.workspace,
        ids.draftRevision,
        ids.copyAttempt,
        direction,
        ids.promoIdea,
      ],
    );
  }
  await client.query(imageBriefWithDirection, [
    randomUUID(),
    ids.workspace,
    ids.draftRevision,
    ids.copyAttempt,
    "جهت‌گیری تصویر",
    ids.promoIdea,
  ]);
  observed.push("image-brief-direction-readable-rtl");
  await expectConstraint(
    "destructive-origin-delete",
    "fk_platform_draft_editorial_selection_id",
    "delete from editorial_selection where id = $1",
    [ids.selection],
  );
  await expectConstraint(
    "destructive-copy-variant-delete",
    "fk_draft_revision_originating_copy_variant_id",
    "delete from copy_variant where id = $1",
    [ids.copyVariant],
  );

  console.log(`draft production schema probe passed: ${observed.join(", ")}`);
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

function assertClosedContracts() {
  if (
    !cardOriginReferenceSchema.safeParse({
      kind: "promo_idea",
      promoIdeaId: randomUUID(),
    }).success
  ) {
    throw new Error("card origin contract rejected a valid reference");
  }
  if (
    draftRevisionMaterialSchema.safeParse({
      contentLocale: "en",
      headline: "Headline",
      body: "Body",
      hashtags: ["#tag"],
      selectedFinalMediaAssetId: null,
      customerKey: "forbidden",
    }).success
  ) {
    throw new Error("draft contract accepted a customer key");
  }
  if (MEDIA_DERIVATION_PURPOSES.join(",") !== "sharp_brand_logo") {
    throw new Error("media derivation purpose drifted");
  }
  observed.push("closed-contracts");
}

async function insertFixture() {
  await client.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Draft Production Probe', $2, true, now(), now())`,
    [actorId, `${actorId}@example.invalid`],
  );
  await client.query(
    `insert into workspace (id, name, created_at, updated_at)
     values ($1, $2, now(), now())`,
    [ids.workspace, `Draft production schema ${ids.workspace}`],
  );
  await client.query(
    `insert into media_brand
      (id, workspace_id, key, name, sort_order, created_at, updated_at)
     values ($1, $2, 'probe', 'Probe', 1, now(), now())`,
    [ids.brand, ids.workspace],
  );
  await client.query(
    `insert into source
      (id, workspace_id, key, origin, endpoint, name, enabled,
       content_locale, article_fetch_mode, created_at, updated_at)
     values ($1, $2, 'probe', 'rss', 'https://example.invalid/feed', 'Probe',
       true, 'en', 'direct', now(), now())`,
    [ids.source, ids.workspace],
  );
  await client.query(
    `insert into source_item
      (id, workspace_id, source_id, origin, external_id, title, url,
       attribution, content_locale, created_at, updated_at)
     values ($1, $2, $3, 'rss', 'probe', 'Probe',
       'https://example.invalid/item', 'Probe', 'en', now(), now())`,
    [ids.sourceItem, ids.workspace, ids.source],
  );
  await client.query(
    `insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
     values ($1, $2, $3, 'draft-production-analysis', 'analysis', 'analysis',
       'succeeded', now(), 0, 1, now(), now())`,
    [ids.analysisOperation, ids.workspace, actorId],
  );
  await client.query(
    `insert into analysis_run
      (id, workspace_id, kind, operation_id, configuration,
       template_fingerprint, semantic_status, started_at, created_at, updated_at)
     values ($1, $2, 'news', $3, '{}'::jsonb, 'probe', 'skipped',
       now(), now(), now())`,
    [ids.analysisRun, ids.workspace, ids.analysisOperation],
  );
  await client.query(
    `insert into analysis_model_unit
      (id, workspace_id, analysis_run_id, media_brand_id, model_option_key,
       task_key, status, created_at, updated_at)
     values ($1, $2, $3, $4, 'probe', 'probe', 'pending', now(), now())`,
    [ids.analysisUnit, ids.workspace, ids.analysisRun, ids.brand],
  );
  await client.query(
    `insert into editorial_selection
      (id, workspace_id, analysis_model_unit_id, rank, source_item_id,
       suggested_platform, created_at, updated_at)
     values ($1, $2, $3, 1, $4, 'telegram', now(), now())`,
    [ids.selection, ids.workspace, ids.analysisUnit, ids.sourceItem],
  );
  await client.query(
    `insert into filter_result
      (id, workspace_id, analysis_run_id, source_item_id, media_brand_id,
       disposition, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'telegram_lane', now(), now())`,
    [
      ids.filterResult,
      ids.workspace,
      ids.analysisRun,
      ids.sourceItem,
      ids.brand,
    ],
  );
  await client.query(
    `insert into promo_idea
      (id, workspace_id, analysis_model_unit_id, rank, title, description,
       angle, created_at, updated_at)
     values ($1, $2, $3, 1, 'Probe', 'Probe', 'Probe', now(), now())`,
    [ids.promoIdea, ids.workspace, ids.analysisUnit],
  );
  await client.query(
    `insert into platform_draft
      (id, workspace_id, media_brand_id, platform, editorial_selection_id,
       lane_position, version, created_at, updated_at)
     values ($1, $2, $3, 'telegram', $4, 1, 1, now(), now())`,
    [ids.platformDraft, ids.workspace, ids.brand, ids.selection],
  );
  await client.query(
    `insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
     values ($1, $2, $3, 'draft-production-copy', 'copy', 'copy',
       'succeeded', now(), 0, 1, now(), now())`,
    [ids.copyOperation, ids.workspace, actorId],
  );
  await client.query(
    `insert into copy_generation
      (operation_id, workspace_id, platform_draft_id,
       requested_content_locale, model_option_key, force_article_refresh,
       limited, customer_template_fingerprint, brand_policy_fingerprint,
       prompt_version, configuration_version, created_at, updated_at)
     values ($1, $2, $3, 'en', 'probe', false, false, 'probe', 'probe',
       'probe', 'probe', now(), now())`,
    [ids.copyOperation, ids.workspace, ids.platformDraft],
  );
  await client.query(
    `insert into operation_attempt
      (id, workspace_id, operation_id, attempt_number, outcome,
       created_at, updated_at)
     values ($1, $2, $3, 1, 'succeeded', now(), now())`,
    [ids.copyAttempt, ids.workspace, ids.copyOperation],
  );
  await client.query(
    `insert into copy_generation_unit
      (id, workspace_id, copy_generation_id, variant_key, status,
       operation_attempt_id, created_at, updated_at)
     values ($1, $2, $3, 'probe', 'succeeded', $4, now(), now())`,
    [ids.copyUnit, ids.workspace, ids.copyOperation, ids.copyAttempt],
  );
  await client.query(
    `insert into copy_variant
      (id, workspace_id, copy_generation_unit_id, content_locale, headline,
       body, hashtags, created_at)
     values ($1, $2, $3, 'en', 'Headline', 'Body', array['#tag'], now())`,
    [ids.copyVariant, ids.workspace, ids.copyUnit],
  );
  await client.query(
    `insert into draft_revision
      (id, workspace_id, platform_draft_id, revision_number, content_locale,
       headline, body, hashtags, originating_copy_variant_id, authored_by,
       created_at)
     values ($1, $2, $3, 1, 'en', 'Headline', 'Body', array['#tag'], $4, $5,
       now())`,
    [
      ids.draftRevision,
      ids.workspace,
      ids.platformDraft,
      ids.copyVariant,
      actorId,
    ],
  );
  await client.query(
    `update platform_draft
     set active_revision_id = $1, revision_version = 1, updated_at = now()
     where id = $2 and workspace_id = $3`,
    [ids.draftRevision, ids.platformDraft, ids.workspace],
  );
  for (const [id, key] of [
    [ids.originalAsset, "original"],
    [ids.finalAsset, "final"],
    [ids.unrelatedAsset, "unrelated"],
  ] as const) {
    await client.query(
      `insert into media_asset
        (id, workspace_id, kind, object_key, mime_type, declared_bytes,
         lifecycle, version, created_at, updated_at)
       values ($1, $2, 'image', $3, 'image/png', 1, 'verified', 1, now(), now())`,
      [id, ids.workspace, `probe/${key}`],
    );
  }
  await client.query(
    `insert into media_derivation
      (id, workspace_id, source_media_asset_id, derived_media_asset_id,
       purpose, created_at)
     values ($1, $2, $3, $4, $5, now())`,
    [
      ids.derivation,
      ids.workspace,
      ids.originalAsset,
      ids.finalAsset,
      MEDIA_DERIVATION_PURPOSES[0],
    ],
  );
  await client.query(
    `insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
     values ($1, $2, $3, 'draft-production-image', 'image', 'image',
       'queued', now(), 0, 1, now(), now())`,
    [ids.imageOperation, ids.workspace, actorId],
  );
}

async function expectConstraint(
  label: string,
  expectedConstraint: string,
  query: string,
  values: unknown[],
) {
  await client.query("savepoint expected_constraint_failure");
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query("rollback to savepoint expected_constraint_failure");
    if (!(error instanceof pg.DatabaseError)) {
      throw error;
    }
    if (error.constraint !== expectedConstraint) {
      throw new Error(
        `${label} rejected by ${error.constraint ?? error.code}, expected ${expectedConstraint}`,
      );
    }
    observed.push(`${label}:${expectedConstraint}`);
    return;
  }
  await client.query("rollback to savepoint expected_constraint_failure");
  throw new Error(`${label} was accepted`);
}
