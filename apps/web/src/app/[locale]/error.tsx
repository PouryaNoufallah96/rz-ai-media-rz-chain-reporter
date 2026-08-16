"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";

export default function SegmentError({ reset }: { reset: () => void }) {
  const t = useTranslations(SHARED_NAMESPACE);

  return (
    <main
      className="mx-auto flex w-full max-w-lg flex-col items-start justify-center gap-4 px-6 py-16"
      id="main-content"
    >
      <p role="alert">{t("error.message")}</p>
      <Button onClick={reset} type="button" variant="outline">
        {t("error.retry")}
      </Button>
    </main>
  );
}
