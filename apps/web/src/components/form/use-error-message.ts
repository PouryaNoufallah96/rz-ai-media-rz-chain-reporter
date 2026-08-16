"use client";

import { useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";

export function useFallbackErrorMessage() {
  const t = useTranslations(SHARED_NAMESPACE);

  return () => t("error.invalid");
}
