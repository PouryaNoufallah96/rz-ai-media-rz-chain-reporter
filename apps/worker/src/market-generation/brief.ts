import type {
  ContentLocale,
  MarketPeriod,
  MarketScale,
  MarketSeriesRole,
} from "@rz-chain-reporter/contracts";
import type {
  MarketInstrumentProfile,
  marketCompositionCatalogSchema,
} from "@rz-chain-reporter/customer-template/schema";
import { z } from "zod";

export const MARKET_GENERATION_BRIEF_SCHEMA_VERSION = "market-brief-v2";
export const MARKET_GENERATION_BRIEF_POLICY_VERSION = "market-brief-policy-v2";
export const MARKET_GENERATION_PROMPT_POLICY_VERSION = "market-image-prompt-v5";

const boundedLine = z.string().trim().min(1).max(240);

export const marketGenerationBriefSchema = z.strictObject({
  backgroundScene: z.string().trim().min(1).max(600),
  brandTranslation: boundedLine,
  chartTreatment: boundedLine,
  composition: boundedLine,
  factualClaims: z.array(boundedLine).max(8),
  footerSafeArea: boundedLine,
  headline: z.string().trim().min(1).max(180),
  supportingText: z.string().trim().min(1).max(500),
});

export type MarketGenerationBrief = z.infer<typeof marketGenerationBriefSchema>;

type MarketCompositionVariant = z.infer<
  typeof marketCompositionCatalogSchema
>["families"][number]["variants"][number];

export type MarketGenerationSeriesFact =
  | {
      changePercent: string;
      color: string | null;
      displayName: string;
      endValue: string;
      role: MarketSeriesRole;
      startValue: string;
      status: "verified";
      symbol: string;
    }
  | {
      displayName: string;
      role: MarketSeriesRole;
      status: "unavailable";
      symbol: string;
    };

export type MarketGenerationFacts = {
  contentLocale: ContentLocale;
  family: { displayName: string; key: string };
  headline: string;
  output: { height: number; width: number };
  owner: {
    changePercent: number | null;
    name: string;
    profile: MarketInstrumentProfile;
    symbol: string;
  };
  period: MarketPeriod;
  scale: MarketScale;
  series: readonly MarketGenerationSeriesFact[];
  supportingText: string;
  variant: MarketCompositionVariant;
  verifiedClaims: readonly string[];
};

function fallbackBackgroundScene(facts: MarketGenerationFacts) {
  const change = facts.owner.changePercent ?? 0;
  const index = change > 5 ? 0 : change < -5 ? 1 : 2;
  const scene =
    facts.owner.profile.scenes[index] ?? facts.owner.profile.scenes[0];
  if (!scene) throw new Error("MARKET_GENERATION_SCENE_MISSING");
  return scene;
}

export function deterministicMarketBrief(
  facts: MarketGenerationFacts,
): MarketGenerationBrief {
  return {
    backgroundScene: fallbackBackgroundScene(facts),
    brandTranslation: facts.owner.profile.artDirection,
    chartTreatment:
      "Place the complete Reference 2 chart inside the protected chart area without redrawing, cropping, or relabeling it.",
    composition: facts.variant.fallbackDirection,
    factualClaims: [...facts.verifiedClaims].slice(0, 8),
    footerSafeArea:
      "Keep the reserved footer rail a seamless continuation of the artwork with its center empty for the brand mark.",
    headline: facts.headline,
    supportingText: facts.supportingText,
  };
}
