import {
  ATTEMPT_OUTCOMES,
  MEDIA_ASSET_LIFECYCLES,
  OPERATION_LIFECYCLES,
  PLATFORMS,
  SCHEDULE_STATUSES,
  SOURCE_ORIGINS,
} from "@rz-chain-reporter/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const contentLocale = pgEnum("content_locale", ["en", "fa"]);

export const platform = pgEnum("platform", PLATFORMS);

export const sourceOrigin = pgEnum("source_origin", SOURCE_ORIGINS);

export const analysisRunKind = pgEnum("analysis_run_kind", ["news", "promo"]);

export const filterDisposition = pgEnum("filter_disposition", [
  "rejected",
  "scored",
  "clustered",
  "routed",
]);

export const mediaAssetLifecycle = pgEnum(
  "media_asset_lifecycle",
  MEDIA_ASSET_LIFECYCLES,
);

export const operationLifecycle = pgEnum(
  "operation_lifecycle",
  OPERATION_LIFECYCLES,
);

export const attemptOutcome = pgEnum("attempt_outcome", ATTEMPT_OUTCOMES);

export const scheduleStatus = pgEnum("schedule_status", SCHEDULE_STATUSES);
