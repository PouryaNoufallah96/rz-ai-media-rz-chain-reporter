"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { operationCreated } from "@/features/operations/lib/focus-operation";
import { useAction } from "@/hooks/use-action";

import { startCopyVariantTranslationAction } from "../actions/commands";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { CopyVariantProjection } from "../schemas/drafts";
import { TranslationActionButton } from "./translation-action-button";

export function CopyVariantTranslationButton({
  candidate,
}: {
  candidate: CopyVariantProjection;
}) {
  const locale = useLocale();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const action = useAction(startCopyVariantTranslationAction);
  const title = candidate.headline;

  return (
    <TranslationActionButton
      available={candidate.contentLocale === locale}
      copy={{
        translate: t("copyVariantTranslation.translate", { title }),
        queueing: t("copyVariantTranslation.queueing", { title }),
        translating: t("copyVariantTranslation.translating", { title }),
        unknown: t("copyVariantTranslation.unknown", { title }),
        retry: t("copyVariantTranslation.retry", { title }),
        text: t("copyVariantTranslation.text"),
        hint: {
          translate: t("copyVariantTranslation.hint.translate"),
          queueing: t("copyVariantTranslation.hint.queueing"),
          translating: t("copyVariantTranslation.hint.translating"),
          retry: t("copyVariantTranslation.hint.retry"),
        },
      }}
      isActionPending={action.isPending}
      onTranslate={async () => {
        const result = await action.execute({
          copyVariantId: candidate.id,
          contentLocale: locale,
          idempotencyKey: crypto.randomUUID(),
        });

        if (result.data) {
          if (result.data.status === "created") {
            operationCreated(result.data.operationId);
          }
          toast.success(
            t(
              result.data.status === "already_available"
                ? "copyVariantTranslation.available"
                : "copyVariantTranslation.queued",
            ),
          );
          return;
        }

        toast.error(copyVariantTranslationError(t, result.code));
      }}
      status={candidate.translation}
    />
  );
}

function copyVariantTranslationError(
  t: ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>,
  code: string | undefined,
) {
  if (code === "NOT_FOUND") return t("copyVariantTranslation.notFound");
  if (code === "IDEMPOTENCY_KEY_REUSED") {
    return t("copyVariantTranslation.conflict");
  }
  if (code === "VALIDATION_FAILED") {
    return t("copyVariantTranslation.invalid");
  }
  return t("copyVariantTranslation.error");
}
