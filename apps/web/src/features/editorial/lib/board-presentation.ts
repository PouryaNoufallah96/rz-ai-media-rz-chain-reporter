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
