import type { Platform, RunConfiguration } from "@rz-chain-reporter/contracts";

export type BoardPresentation = {
  brandKeys: readonly string[];
  kind: RunConfiguration["kind"];
  modelKeys: readonly string[];
  platforms: readonly Platform[];
  telegramOnly: boolean;
};

export function configuredBoardPresentation(
  configuration: RunConfiguration,
  legacyPromoPlatforms: readonly Platform[],
): BoardPresentation {
  if (configuration.kind === "promo") {
    return {
      brandKeys: configuration.promo.brands,
      kind: "promo",
      modelKeys: configuration.models,
      platforms: configuration.platforms ?? legacyPromoPlatforms,
      telegramOnly: false,
    };
  }

  return {
    brandKeys: configuration.brands,
    kind: "news",
    modelKeys: configuration.models,
    platforms: configuration.platforms,
    telegramOnly: configuration.telegramOnly,
  };
}

export function resolveBoardPresentation(
  configuration: RunConfiguration,
  settled: boolean,
  presentation: BoardPresentation,
  legacyPromoPlatforms: readonly Platform[],
): BoardPresentation {
  const snapshot = configuredBoardPresentation(
    configuration,
    legacyPromoPlatforms,
  );
  if (!settled || presentation.kind !== snapshot.kind) return snapshot;

  const snapshotBrands = new Set(snapshot.brandKeys);
  const snapshotModels = new Set(snapshot.modelKeys);
  const snapshotPlatforms = new Set(snapshot.platforms);

  return {
    ...snapshot,
    brandKeys: presentation.brandKeys.filter((brand) =>
      snapshotBrands.has(brand),
    ),
    modelKeys: presentation.modelKeys.filter((model) =>
      snapshotModels.has(model),
    ),
    platforms: presentation.platforms.filter((platform) =>
      snapshotPlatforms.has(platform),
    ),
  };
}

// D6 precedes D4: an all-failed acquisition explains the empty zone, so the
// "no candidate passed" notice must not replace it.
export function telegramZoneNotice(
  head: {
    completedAt: Date | null;
    kind: RunConfiguration["kind"];
    telegramAcquisition: {
      acquiredChannels: number;
      failures: readonly unknown[];
      totalChannels: number;
    };
  },
  laneCount: number,
): "acquisition_failed" | "no_candidates" | null {
  const { acquiredChannels, failures, totalChannels } =
    head.telegramAcquisition;

  if (head.completedAt === null || totalChannels === 0) return null;
  if (acquiredChannels === 0 && failures.length === totalChannels) {
    return "acquisition_failed";
  }

  return head.kind === "promo" || laneCount > 0 ? null : "no_candidates";
}

// Telegram routes commit in filter-and-score, one step before units are planned,
// so a planned unit means the zone's lanes are final.
export function telegramLanesPending(
  head: {
    completedAt: Date | null;
    configuration: RunConfiguration;
  } | null,
  telegramSourceIds: readonly string[],
  unitsPlanned: boolean,
) {
  if (head === null || head.completedAt !== null || unitsPlanned) return false;
  if (head.configuration.kind !== "news") return false;

  const selected = new Set(telegramSourceIds);

  return head.configuration.sourceIds.some((sourceId) =>
    selected.has(sourceId),
  );
}
