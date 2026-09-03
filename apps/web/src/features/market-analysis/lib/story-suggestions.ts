import type { ContentLocale, MarketPeriod } from "@rz-chain-reporter/contracts";
import {
  formatMarketPercent,
  formatMarketValue,
} from "@rz-chain-reporter/market-chart";

import type { MarketStorySuggestion } from "../schemas/reads";

type Fact = {
  displayName: string;
  symbol: string;
  startPrice: string;
  endPrice: string;
  changePercent: string;
};

const PERIOD_PHRASE: Record<ContentLocale, Record<MarketPeriod, string>> = {
  en: {
    "24h": "24 hours",
    "7d": "7 days",
    "30d": "30 days",
    "90d": "90 days",
    "1y": "1 year",
  },
  fa: {
    "24h": "۲۴ ساعت",
    "7d": "۷ روز",
    "30d": "۳۰ روز",
    "90d": "۹۰ روز",
    "1y": "۱ سال",
  },
};

export function suggestMarketStories(
  locale: ContentLocale,
  scale: "relative" | "absolute",
  period: MarketPeriod,
  facts: readonly Fact[],
): readonly MarketStorySuggestion[] {
  const primary = facts[0];
  if (!primary) return [];
  const span = PERIOD_PHRASE[locale][period];
  const percent = (fact: Fact) =>
    formatMarketPercent(locale, Number(fact.changePercent));
  const value = (price: string) =>
    formatMarketValue(locale, Number(price), scale);
  const ranked = facts.toSorted(
    (a, b) => Number(b.changePercent) - Number(a.changePercent),
  );
  const best = ranked[0] ?? primary;
  const worst = ranked[ranked.length - 1] ?? primary;
  const rival = facts[1];
  const leading = best === primary;

  switch (locale) {
    case "en": {
      const lead: MarketStorySuggestion = {
        kind: "performanceLead",
        headline: `${primary.displayName} closes the ${span} window at ${percent(primary)}`,
        supportingText: `${primary.symbol} moved from ${value(primary.startPrice)} to ${value(primary.endPrice)} across the verified ${span} window.`,
      };
      if (!rival) return [lead];
      return [
        {
          kind: "marketComparison",
          headline:
            facts.length === 2
              ? leading
                ? `${primary.displayName} outpaces ${rival.displayName} over ${span}`
                : `${primary.displayName} vs ${rival.displayName} over ${span}`
              : leading
                ? `${primary.displayName} leads the ${span} market comparison`
                : `${primary.displayName} vs the market over ${span}`,
          supportingText: `${best.symbol} led at ${percent(best)} while ${worst.symbol} finished at ${percent(worst)} across the verified ${span} window.`,
        },
        lead,
      ];
    }
    case "fa": {
      const lead: MarketStorySuggestion = {
        kind: "performanceLead",
        headline: `${primary.displayName} بازهٔ ${span} را با ${percent(primary)} به پایان رساند`,
        supportingText: `${primary.symbol} در بازهٔ تأییدشدهٔ ${span} از ${value(primary.startPrice)} به ${value(primary.endPrice)} رسید.`,
      };
      if (!rival) return [lead];
      return [
        {
          kind: "marketComparison",
          headline:
            facts.length === 2
              ? leading
                ? `${primary.displayName} در بازهٔ ${span} از ${rival.displayName} پیشی گرفت`
                : `${primary.displayName} در برابر ${rival.displayName} در بازهٔ ${span}`
              : leading
                ? `${primary.displayName} در مقایسهٔ ${span} بازار پیشتاز شد`
                : `${primary.displayName} در برابر بازار در بازهٔ ${span}`,
          supportingText: `${best.symbol} با ${percent(best)} پیشتاز بود و ${worst.symbol} با ${percent(worst)} بازهٔ تأییدشده را به پایان رساند.`,
        },
        lead,
      ];
    }
  }
}
