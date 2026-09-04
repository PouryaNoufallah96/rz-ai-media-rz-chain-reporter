import "server-only";

import { IMAGE_OPTION_CAPABILITIES } from "@rz-chain-reporter/contracts";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import {
  customerEditorial,
  enabledImageModels,
} from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { marketAnalysisTags } from "../../db/cache/tags";
import { readMarketAnalysisOptions } from "../../db/queries";
import {
  marketCompositionCatalog,
  marketInstrumentTemplate,
  requireMarketTemplate,
} from "../../lib/template";
import type { MarketAnalysisOptionsProjection } from "../../schemas/reads";

function isImageCapabilityKey(
  key: string,
): key is keyof typeof IMAGE_OPTION_CAPABILITIES {
  return key in IMAGE_OPTION_CAPABILITIES;
}

export async function getMarketAnalysisOptions() {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedMarketAnalysisOptions(workspaceId, session.user.id);
}

async function readCachedMarketAnalysisOptions(
  workspaceId: string,
  userId: string,
) {
  "use cache";
  cacheTag(marketAnalysisTags.reads(workspaceId));
  cacheLife("minutes");
  const persisted = await readMarketAnalysisOptions(
    rpcDb(),
    workspaceId,
    userId,
  );
  const marketTemplate = requireMarketTemplate();
  const approved = new Set(marketTemplate.approvedImageOptionKeys);
  const imageOptions = enabledImageModels.flatMap((model) => {
    if (!isImageCapabilityKey(model.key)) return [];
    const capability = IMAGE_OPTION_CAPABILITIES[model.key];
    return approved.has(model.key) && capability.maxOrderedReferences >= 2
      ? [{ ...model, capability }]
      : [];
  });
  const clientOptions = {
    instruments: persisted.instruments.flatMap((instrument) => {
      const configured = marketInstrumentTemplate(instrument.key);
      return configured
        ? [
            {
              ...instrument,
              icon: {
                url: `/api/market-analysis-instruments/${encodeURIComponent(instrument.key)}/icon`,
                width: configured.selectorIcon.pixelWidth,
                height: configured.selectorIcon.pixelHeight,
              },
            },
          ]
        : [];
    }),
    brandInstruments: marketTemplate.brandInstruments,
    enabledPeriods: marketTemplate.enabledPeriods,
    enabledScales: marketTemplate.enabledScales,
    defaultPeriod: marketTemplate.defaults.period,
    defaultScale: marketTemplate.defaults.scale,
    compositions: marketCompositionCatalog.families.flatMap((family) =>
      family.enabled
        ? [
            {
              key: family.key,
              displayName: family.displayName,
              variants: family.variants.flatMap((variant) =>
                variant.enabled
                  ? [
                      {
                        key: variant.key,
                        displayName: variant.displayName,
                        formats: variant.formats,
                        minSeries: variant.minSeries,
                        maxSeries: variant.maxSeries,
                        allowedScales: variant.chartScaleRule.allowedScales,
                        preferredScale: variant.chartScaleRule.preferredScale,
                        sample: {
                          url: `/api/market-analysis-compositions/${encodeURIComponent(family.key)}/${encodeURIComponent(variant.key)}`,
                          width: variant.sample.pixelWidth,
                          height: variant.sample.pixelHeight,
                        },
                      },
                    ]
                  : [],
              ),
            },
          ]
        : [],
    ),
    defaultComparisonSymbol: marketTemplate.defaultComparisonSymbol,
    defaultImageOptionKey: marketTemplate.defaultImageOptionKey,
    featuredComparisonSymbols: marketTemplate.featuredComparisonSymbols,
    outputFormat: marketTemplate.defaults.outputFormat,
    imageOptions: imageOptions.map(({ key, name, vendor }) => ({
      key,
      name,
      vendor,
    })),
    copyModels: customerEditorial.models,
    defaultCopyModelOptionKey:
      customerEditorial.defaults.models[0] ??
      customerEditorial.models[0]?.key ??
      "",
  } satisfies MarketAnalysisOptionsProjection;
  return {
    ...clientOptions,
    defaults: persisted.defaults,
  };
}
