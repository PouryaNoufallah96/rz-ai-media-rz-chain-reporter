import { useTranslations } from "next-intl";

import { useFallbackErrorMessage } from "@/components/form/use-error-message";

import { EDITORIAL_NAMESPACE } from "../constants";

const EDITORIAL_ERROR_KEYS = {
  FAN_OUT_EXCEEDS_MAX_UNITS: "errors.fanOutExceedsMaxUnits",
  KEYWORD_TOPIC_REQUIRED: "errors.keywordTopicRequired",
  NO_BRAND: "errors.noBrand",
  NO_MODEL: "errors.noModel",
  NO_PLATFORM: "errors.noPlatform",
  NO_PROMO_BRAND: "errors.noPromoBrand",
  NO_SOURCES: "errors.noSources",
  PROMO_PROMPT_REQUIRED: "errors.promoPromptRequired",
  PROMO_PROMPT_TOO_LONG: "errors.promoPromptTooLong",
  TELEGRAM_SOURCE_REQUIRED: "errors.telegramSourceRequired",
  TEMPLATE_DRIFT: "errors.templateDrift",
  TOO_MANY_SOURCES: "errors.tooManySources",
  TOO_MANY_TOPICS: "errors.tooManyTopics",
  TOPIC_REQUIRED: "errors.topicRequired",
  TOPIC_TOO_LONG: "errors.topicTooLong",
  TOP_N_BELOW_MINIMUM: "errors.topNBelowMinimum",
  TOP_N_EXCEEDS_CAP: "errors.topNExceedsCap",
} as const;

type EditorialSchemaCode = keyof typeof EDITORIAL_ERROR_KEYS;

function isEditorialSchemaCode(value: string): value is EditorialSchemaCode {
  return value in EDITORIAL_ERROR_KEYS;
}

export function useEditorialErrorMessage() {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const fallback = useFallbackErrorMessage();

  return (code: string | undefined, brand = "") => {
    if (code === undefined || !isEditorialSchemaCode(code)) return fallback();

    return code === "PROMO_PROMPT_REQUIRED"
      ? t(EDITORIAL_ERROR_KEYS.PROMO_PROMPT_REQUIRED, { brand })
      : t(EDITORIAL_ERROR_KEYS[code]);
  };
}
