import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";

import type { AccountSummary } from "@/features/account/schemas/account";
import type {
  MarketAnalysisCatalogProjection,
  MarketAnalysisHistoryPage,
  MarketAnalysisOptionsProjection,
} from "@/features/market-analysis/schemas/reads";
import type {
  PublishingHistoryRow,
  SavedHistoryRow,
} from "@/features/publishing/schemas/history";
import type {
  UsagePage,
  UsageQuery,
  UsageSummary,
} from "@/features/usage/schemas/usage";

import {
  type AssistantReadInput,
  type AssistantReadResult,
  assistantReadResultSchema,
  MAX_ASSISTANT_READ_ITEMS,
} from "../schemas/assistant-message";

type ReadFact = AssistantReadResult["facts"][number];
type ReadItem = AssistantReadResult["items"][number];
type ReadPage<TRow> = {
  rows: readonly TRow[];
  olderCursor: string | null;
  newerCursor: string | null;
};

export function customerFactsOf(template: CustomerTemplate) {
  const enabledSources = template.sources.filter((source) => source.enabled);
  const destinationByKey = new Map(
    template.destinationAccounts.map((destination) => [
      destination.key,
      destination,
    ]),
  );

  return {
    productName: template.customer.productName,
    timeZone: template.customer.timeZone,
    brands: template.mediaBrands.map((brand) => ({
      key: brand.key,
      name: brand.name,
      promoEnabled: brand.editorial.promoEnabled,
      destinationPlatforms: [
        ...new Set(
          template.brandDestinations.flatMap((mapping) => {
            if (mapping.brandKey !== brand.key) return [];
            const destination = destinationByKey.get(mapping.destinationKey);
            return destination?.enabled ? [destination.platform] : [];
          }),
        ),
      ],
      hasLogo: brand.brandLogo !== undefined,
    })),
    sources: {
      total: template.sources.length,
      enabled: enabledSources.length,
      rss: enabledSources.filter((source) => source.origin === "rss").length,
      telegram: enabledSources.filter(
        (source) => source.origin === "telegram_public",
      ).length,
    },
    platforms: template.editorial.platforms,
    destinations: template.destinationAccounts.flatMap((destination) =>
      destination.enabled
        ? [
            {
              key: destination.key,
              label: destination.metadata.label,
              platform: destination.platform,
            },
          ]
        : [],
    ),
    marketAnalysis: template.marketAnalysis.enabled,
  };
}

export function projectUsageResult(
  input: Extract<AssistantReadInput, { target: "usage" }>,
  usage: { query: UsageQuery; summary: UsageSummary; page: UsagePage },
  timeZone: string,
): AssistantReadResult {
  const ownerHref = href("/usage", usage.query);
  const modelItems = usage.summary.models
    .slice(0, MAX_ASSISTANT_READ_ITEMS)
    .map((model) =>
      item(`model:${model.backend}:${model.model}`, model.model, {
        status: model.backend,
        facts: [
          fact("invocations", model.invocations),
          fact("totalTokens", model.totalTokens),
          fact("recordedCost", model.recordedCost),
        ],
      }),
    );
  const detailItems = usage.page.rows.map((row) =>
    item(row.id, row.resolvedModel ?? row.requestedModel, {
      status: row.status,
      occurredAt: row.occurredAt,
      facts: [
        fact("task", row.taskKey),
        fact("invocationKey", row.invocationKey),
        fact("backend", row.backend),
        fact("provider", row.provider),
        fact("requestedModel", row.requestedModel),
        fact("resolvedModel", row.resolvedModel ?? "—"),
        fact("promptTokens", row.promptTokens ?? "—"),
        fact("completionTokens", row.completionTokens ?? "—"),
        fact("totalTokens", row.totalTokens ?? "—"),
        fact("recordedCost", row.cost ?? "—"),
        fact("costAuthority", row.costAuthority),
      ],
    }),
  );
  return result("usage", ownerHref, {
    facts: [
      fact("period", usage.query.period),
      fact("timeZone", timeZone),
      fact("invocations", usage.summary.invocations),
      fact("recordedInvocations", usage.summary.recordedInvocations),
      fact("totalTokens", usage.summary.totalTokens),
      fact("recordedCost", usage.summary.recordedCost),
      fact("pendingCount", usage.summary.pendingCount),
      fact("unknownCount", usage.summary.unknownCount),
      ...(input.facet === "summary"
        ? [
            fact("models", usage.summary.models.length),
            fact("returned", modelItems.length),
          ]
        : [fact("items", detailItems.length)]),
    ],
    items: input.facet === "summary" ? modelItems : detailItems,
    cursors: input.facet === "details" ? usage.page : undefined,
  });
}

export function projectAccountResult(
  profile: { name: string; email: string; createdAt: Date },
  summary: AccountSummary,
): AssistantReadResult {
  const brands = summary.brands.slice(0, MAX_ASSISTANT_READ_ITEMS);
  return result("account", "/account", {
    facts: [
      fact("profile", profile.name),
      fact("email", profile.email),
      fact("createdAt", profile.createdAt.toISOString()),
      fact("generatedDrafts", summary.generatedDrafts),
      fact("scheduled", summary.scheduled),
      fact("saved", summary.saved),
      fact("brands", summary.brands.length),
      fact("returned", brands.length),
    ],
    items: brands.map((brand) =>
      item(brand.key, brand.name, {
        facts: [
          fact("generatedDrafts", brand.generatedDrafts),
          fact("scheduled", brand.scheduled),
          fact("saved", brand.saved),
        ],
      }),
    ),
  });
}

export function projectSavedResult(
  state: Extract<AssistantReadInput, { target: "saved" }>["state"],
  cursor: string | null,
  page: ReadPage<SavedHistoryRow>,
): AssistantReadResult {
  return result(
    "saved",
    href("/account", { savedState: state, savedCursor: cursor }),
    {
      facts: [fact("status", state), fact("items", page.rows.length)],
      items: page.rows.map((row) =>
        item(row.id, row.headline ?? row.originTitle, {
          status: row.discardedAt ? "discarded" : "active",
          occurredAt: row.savedAt,
          href: href("/account", { draft: row.platformDraftId }),
          facts: [
            fact("brands", row.brandName),
            fact("provider", row.platform),
          ],
        }),
      ),
      cursors: page,
    },
  );
}

export function projectPublishingResult(
  view: Extract<AssistantReadInput, { target: "publishing" }>["view"],
  cursor: string | null,
  publishing: {
    page: ReadPage<PublishingHistoryRow>;
    installationTimeZone: string;
  },
): AssistantReadResult {
  return result("publishing", href("/schedule", { view, cursor }), {
    facts: [
      fact("status", view),
      fact("items", publishing.page.rows.length),
      fact("timeZone", publishing.installationTimeZone),
    ],
    items: publishing.page.rows.map((row) =>
      item(row.id, row.headline, {
        status: row.lifecycle,
        occurredAt: row.occurredAt,
        href: href("/account", { draft: row.platformDraftId }),
        facts: [
          fact("brands", row.brandName),
          fact("provider", `${row.platform} · ${row.destinationLabel}`),
        ],
      }),
    ),
    cursors: publishing.page,
  });
}

export function projectMarketOptionsResult(
  options: Pick<
    MarketAnalysisOptionsProjection,
    "instruments" | "enabledPeriods" | "enabledScales" | "outputFormat"
  >,
): AssistantReadResult {
  const instruments = options.instruments.slice(0, MAX_ASSISTANT_READ_ITEMS);
  return result("marketOptions", "/market-analysis", {
    facts: [
      fact("instruments", options.instruments.length),
      fact("returned", instruments.length),
      fact("periods", options.enabledPeriods.join(", ")),
      fact("scales", options.enabledScales.join(", ")),
      fact("outputFormat", options.outputFormat),
    ],
    items: instruments.map((instrument) =>
      item(instrument.id, instrument.name, {
        href: instrument.icon.url,
        facts: [fact("items", instrument.symbol)],
      }),
    ),
  });
}

export function projectMarketCatalogResult(
  catalog: MarketAnalysisCatalogProjection,
): AssistantReadResult {
  return result("marketCatalog", "/market-analysis", {
    facts: [
      fact("comparisons", catalog.entries.length),
      fact(
        "returned",
        Math.min(catalog.entries.length, MAX_ASSISTANT_READ_ITEMS),
      ),
      fact("updatedAt", catalog.lastSuccessAt?.toISOString() ?? "—"),
    ],
    items: catalog.entries.slice(0, MAX_ASSISTANT_READ_ITEMS).map((entry) =>
      item(entry.canonicalIdentity, entry.displayName, {
        facts: [
          fact(
            "items",
            `${entry.symbol} · ${entry.baseAsset}/${entry.quoteAsset}`,
          ),
        ],
      }),
    ),
  });
}

export function projectMarketHistoryResult(
  history: MarketAnalysisHistoryPage,
  cursor: string | null,
): AssistantReadResult {
  return result(
    "marketHistory",
    href("/market-analysis", { view: "history", cursor }),
    {
      facts: [fact("analyses", history.rows.length)],
      items: history.rows.map((row) =>
        item(row.id, row.symbols, {
          status: row.status,
          occurredAt: row.updatedAt,
          href: `/market-analysis/${row.id}`,
          facts: [
            fact("stage", row.stage),
            fact("period", row.period),
            fact("contentLocale", row.contentLocale),
          ],
        }),
      ),
      cursors: history,
    },
  );
}

export function result(
  kind: AssistantReadResult["kind"],
  ownerHref: string,
  input: {
    observedAt?: Date;
    facts?: ReadFact[];
    items?: ReadItem[];
    cursors?: { olderCursor: string | null; newerCursor: string | null };
    notice?: AssistantReadResult["notice"];
  } = {},
): AssistantReadResult {
  return assistantReadResultSchema.parse({
    kind,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    href: ownerHref,
    facts: input.facts ?? [],
    items: input.items ?? [],
    cursors: input.cursors
      ? { older: input.cursors.olderCursor, newer: input.cursors.newerCursor }
      : null,
    notice: input.notice ?? "none",
  });
}

export function fact(
  key: ReadFact["key"],
  value: string | number | boolean,
): ReadFact {
  return { key, value: String(value) };
}

export function item(
  id: string,
  title: string,
  input: {
    status?: string | null;
    occurredAt?: Date | null;
    href?: string | null;
    facts?: ReadFact[];
  } = {},
): ReadItem {
  return {
    id,
    title,
    status: input.status ?? null,
    occurredAt: input.occurredAt?.toISOString() ?? null,
    href: input.href ?? null,
    facts: input.facts ?? [],
  };
}

export function href(
  pathname: string,
  values: Record<string, string | null | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const encoded = query.toString();
  return encoded ? `${pathname}?${encoded}` : pathname;
}
