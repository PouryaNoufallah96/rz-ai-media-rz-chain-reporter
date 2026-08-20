"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";

export function SegmentError({ reset }: { reset: () => void }) {
  const t = useTranslations(SHARED_NAMESPACE);

  return (
    <>
      <p role="alert">{t("error.message")}</p>
      <Button onClick={reset} type="button" variant="outline">
        {t("error.retry")}
      </Button>
    </>
  );
}
