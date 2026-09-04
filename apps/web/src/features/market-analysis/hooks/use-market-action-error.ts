"use client";

import { useTranslations } from "next-intl";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";

export function useMarketActionError() {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (code: string | undefined) => {
    switch (code) {
      case "MARKET_PRIMARY_REQUIRED":
        return t("create.errors.primary");
      case "MARKET_PRIMARY_LIMIT":
        return t("create.errors.primaryLimit");
      case "MARKET_PRIMARY_DUPLICATE":
        return t("create.errors.primaryDuplicate");
      case "MARKET_BRANDING_REQUIRED":
        return t("create.errors.branding");
      case "MARKET_COMPARISON_LIMIT":
        return t("create.errors.comparisonLimit");
      case "MARKET_COMPARISON_DUPLICATE":
        return t("create.errors.comparisonDuplicate");
      case "MARKET_INSTRUMENT_REQUIRED":
        return t("create.errors.primary");
      case "MARKET_STORY_HEADLINE_REQUIRED":
        return t("story.errors.headline");
      case "MARKET_STORY_TEXT_REQUIRED":
        return t("story.errors.supportingText");
      case "NOT_FOUND":
        return t("errors.notFound");
      case "TRANSIENT_CONFLICT":
      case "OPERATION_IN_PROGRESS":
        return t("errors.conflict");
      case "IDEMPOTENCY_KEY_REUSED":
        return t("errors.idempotency");
      case "MARKET_ANALYSIS_COMPLETED":
        return t("errors.completed");
      case "MARKET_ANALYSIS_NOT_READY":
        return t("errors.notReady");
      default:
        return t("errors.validation");
    }
  };
}
