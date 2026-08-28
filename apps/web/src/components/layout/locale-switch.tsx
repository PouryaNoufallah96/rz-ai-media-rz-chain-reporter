"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { useRouter } from "@/i18n/navigation";

export function LocaleSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations(SHARED_NAMESPACE);
  const nextLocale = locale === "en" ? "fa" : "en";

  return (
    <Button
      aria-label={t("language.switchTo", {
        language: t(`language.${nextLocale}`),
      })}
      className="max-sm:size-11"
      onClick={() => {
        const pathname =
          window.location.pathname.replace(/^\/(?:en|fa)(?=\/|$)/, "") || "/";
        router.replace(`${pathname}${window.location.search}`, {
          locale: nextLocale,
        });
      }}
      size="icon"
      type="button"
      variant="outline"
    >
      <LanguagesIcon aria-hidden="true" />
    </Button>
  );
}
