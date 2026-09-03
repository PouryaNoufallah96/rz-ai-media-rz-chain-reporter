"use client";

import { DEFAULT_LOCALE, LOCALES } from "@rz-chain-reporter/i18n";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations(SHARED_NAMESPACE);
  const nextLocale =
    LOCALES.find((candidate) => candidate !== locale) ?? DEFAULT_LOCALE;
  const label = t("language.switchTo", {
    language: t(`language.${nextLocale}`),
  });

  return (
    <Hint label={label}>
      <Button
        aria-label={label}
        className="max-sm:size-11"
        onClick={() => {
          router.replace(`${pathname}${window.location.search}`, {
            locale: nextLocale,
          });
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <LanguagesIcon aria-hidden="true" />
      </Button>
    </Hint>
  );
}
