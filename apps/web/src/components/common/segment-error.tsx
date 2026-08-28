"use client";

import { Alert, AlertTitle } from "@rz-chain-reporter/ui/components/alert";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { AlertCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";

export function SegmentError({ reset }: { reset: () => void }) {
  const t = useTranslations(SHARED_NAMESPACE);

  return (
    <Alert className="flex max-w-md flex-col items-start gap-5 p-6" role="none">
      <AlertCircleIcon aria-hidden="true" className="text-destructive" />
      <AlertTitle role="alert">{t("error.message")}</AlertTitle>
      <Button onClick={reset} type="button" variant="outline">
        {t("error.retry")}
      </Button>
    </Alert>
  );
}
