import "server-only";

import {
  type MarketComparisonProvider,
  type MarketPeriod,
  type MarketScale,
  normalizedMarketRequestSchema,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";

import {
  readMarketAnalysisCatalog,
  readMarketAnalysisSelectionContext,
} from "../db/queries";
import { marketInstrumentTemplate, requireMarketTemplate } from "./template";

const COMPARISON_MAPPING_KINDS = {
  binance: "binance_pair",
} as const satisfies Record<MarketComparisonProvider, string>;

type MarketRequestSelection = {
  primaryInstrumentIds: readonly string[];
  comparisonCatalogIdentities: readonly string[];
  period: MarketPeriod;
  scale: MarketScale;
};

export async function normalizeMarketRequestSelection(
  executor: Executor,
  workspaceId: string,
  userId: string,
  selection: MarketRequestSelection,
) {
  const { comparisonProvider } = requireMarketTemplate();
  const primaryInstrumentIds = [...new Set(selection.primaryInstrumentIds)];
  if (primaryInstrumentIds.length !== selection.primaryInstrumentIds.length) {
    return null;
  }

  const [catalog, ...selected] = await Promise.all([
    readMarketAnalysisCatalog(executor, workspaceId, userId),
    ...primaryInstrumentIds.map((marketInstrumentId) =>
      readMarketAnalysisSelectionContext(executor, workspaceId, userId, {
        marketInstrumentId,
      }),
    ),
  ]);
  const primaryInstruments = selected.flatMap((entry) =>
    entry.instrument?.enabled ? [entry.instrument] : [],
  );
  if (
    primaryInstruments.length !== primaryInstrumentIds.length ||
    primaryInstruments.some(
      (instrument) => !marketInstrumentTemplate(instrument.key),
    )
  ) {
    return null;
  }

  const catalogRows = new Map(
    catalog.comparison.rows.map((row) => [row.canonicalIdentity, row]),
  );
  const comparisons = selection.comparisonCatalogIdentities.flatMap(
    (identity) => {
      const row = catalogRows.get(identity);
      return row ? [row] : [];
    },
  );
  const primarySymbols = new Set(
    primaryInstruments.map((instrument) => instrument.symbol.toUpperCase()),
  );
  if (
    comparisons.length !== selection.comparisonCatalogIdentities.length ||
    comparisons.some(
      (comparison) =>
        comparison.provider !== comparisonProvider ||
        comparison.quoteAsset !== "USDT" ||
        comparison.tradingStatus !== "TRADING" ||
        primarySymbols.has(comparison.baseAsset.toUpperCase()),
    )
  ) {
    return null;
  }

  const request = normalizedMarketRequestSchema.safeParse({
    period: selection.period,
    scale: selection.scale,
    series: [
      ...primaryInstruments.map((instrument) => ({
        controlledInstrumentId: instrument.id,
        descriptorIdentity: `controlled:${instrument.key}`,
        displayName: instrument.name,
        providerMappings: instrument.providerMappings,
        role: "primary" as const,
        symbol: instrument.symbol,
      })),
      ...comparisons.map((comparison) => ({
        controlledInstrumentId: null,
        descriptorIdentity: comparison.canonicalIdentity,
        displayName: comparison.displayName,
        providerMappings: [
          {
            fallback: false,
            kind: COMPARISON_MAPPING_KINDS[comparisonProvider],
            pair: comparison.symbol,
            provider: comparisonProvider,
          },
        ],
        role: "comparison" as const,
        symbol: comparison.symbol,
      })),
    ],
  });
  if (!request.success) return null;
  return {
    catalogFingerprint: catalog.comparison.state?.currentBatchId ?? null,
    primaryInstruments,
    request: request.data,
  };
}
