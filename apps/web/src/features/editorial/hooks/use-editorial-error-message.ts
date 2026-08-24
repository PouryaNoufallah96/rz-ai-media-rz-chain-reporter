import { useTranslations } from "next-intl";

import { useFallbackErrorMessage } from "@/components/form/use-error-message";

import { EDITORIAL_NAMESPACE } from "../constants";

const EDITORIAL_ERROR_KEYS = {
  FAN_OUT_EXCEEDS_MAX_UNITS: "errors.fanOutExceedsMaxUnits",
  NO_PROMO_BRAND: "errors.noPromoBrand",
  PROMO_PROMPT_REQUIRED: "errors.promoPromptRequired",
  PROMO_PROMPT_TOO_LONG: "errors.promoPromptTooLong",
  TOO_MANY_TOPICS: "errors.tooManyTopics",
  TOPIC_TOO_LONG: "errors.topicTooLong",
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
