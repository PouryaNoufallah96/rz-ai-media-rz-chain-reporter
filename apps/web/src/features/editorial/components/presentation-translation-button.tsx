"use client";

import type { CardOriginReference } from "@rz-chain-reporter/contracts";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { operationCreated } from "@/features/operations/lib/focus-operation";
import { useAction } from "@/hooks/use-action";

import { startPresentationTranslationAction } from "../actions/commands";
import { EDITORIAL_NAMESPACE } from "../constants";
import type { PresentationTranslationStatus } from "../schemas/workspace";
import { TranslationActionButton } from "./translation-action-button";

export function PresentationTranslationButton({
  origin,
  presentationReady,
  title,
  translation,
}: {
  origin: CardOriginReference;
  presentationReady: boolean;
  title: string;
  translation: PresentationTranslationStatus | null;
}) {
  const locale = useLocale();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const action = useAction(startPresentationTranslationAction);

  return (
    <TranslationActionButton
      available={presentationReady}
      copy={{
        translate: t("presentationTranslation.translate", { title }),
        queueing: t("presentationTranslation.queueing", { title }),
        translating: t("presentationTranslation.translating", { title }),
        unknown: t("presentationTranslation.unknown", { title }),
        retry: t("presentationTranslation.retry", { title }),
        hint: {
          translate: t("presentationTranslation.hint.translate"),
          queueing: t("presentationTranslation.hint.queueing"),
          translating: t("presentationTranslation.hint.translating"),
          retry: t("presentationTranslation.hint.retry"),
        },
      }}
      isActionPending={action.isPending}
      onTranslate={async () => {
        const result = await action.execute({
          idempotencyKey: crypto.randomUUID(),
          origin,
          presentationLocale: locale,
        });

        if (result.data) {
          if (result.data.status === "created") {
            operationCreated(result.data.operationId);
          }
          toast.success(
            t(
              result.data.status === "already_available"
                ? "presentationTranslation.available"
                : "presentationTranslation.queued",
            ),
          );
          return;
        }

        toast.error(presentationTranslationError(t, result.code));
      }}
      status={translation}
    />
  );
}

function presentationTranslationError(
  t: ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>,
  code: string | undefined,
) {
  if (code === "NOT_FOUND") return t("presentationTranslation.notFound");
  if (code === "IDEMPOTENCY_KEY_REUSED") {
    return t("presentationTranslation.conflict");
  }
  if (code === "VALIDATION_FAILED") {
    return t("presentationTranslation.invalid");
  }
  return t("presentationTranslation.error");
}
