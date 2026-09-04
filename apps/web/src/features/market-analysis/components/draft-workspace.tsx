"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId, useLayoutEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import {
  CopyVariantEditor,
  useCopyVariantRevisionCommands,
} from "@/features/editorial/components/copy-variant-editor";
import {
  acceptRevisionCard,
  candidateEditSource,
  hasRevisionEdits,
  revisionEditorState,
  revisionEditSource,
  selectEditSource,
} from "@/features/editorial/lib/revision-editor-state";
import {
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftExactCard,
} from "@/features/editorial/schemas/drafts";
import { operationCreated } from "@/features/operations/lib/focus-operation";
import { PublishingTicket } from "@/features/publishing/components/publishing-ticket";
import { useAction } from "@/hooks/use-action";

import { retryMarketCaptionsAction } from "../actions/prepare-platform";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useMarketActionError } from "../hooks/use-market-action-error";
import { hasThreeReadyCaptions } from "../lib/publish-readiness";
import { CAPTION_EDITOR_ID, CaptionOptions } from "./caption-options";

export function DraftWorkspace({
  analysisId,
  analysisVersion,
  card: incomingCard,
  modelOptionKey,
  onDirtyChange,
  onPendingChange,
  setup,
}: {
  analysisId: string;
  analysisVersion: number;
  card: PlatformDraftExactCard;
  modelOptionKey: string;
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  setup: ReactNode;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const uiLocale = useLocale();
  const optionsHeadingId = useId();
  const [pending, setPending] = useState(false);
  const [sourceCard, setSourceCard] = useState(incomingCard);
  const retryCaptions = useAction(retryMarketCaptionsAction, {
    onSettled: () => {
      setPending(false);
      onPendingChange(false);
    },
  });
  const [editor, setEditor] = useState(() =>
    revisionEditorState(incomingCard, uiLocale),
  );
  const card = editor.card ?? incomingCard;
  const { hashtagDraft, source } = editor;
  const form = useForm<DraftEditorInput>({
    defaultValues: editor.editorValues,
    mode: "onSubmit",
    resolver: zodResolver(draftEditorSchema),
  });
  const [contentLocale, headline, body, hashtags] = useWatch({
    control: form.control,
    name: ["contentLocale", "headline", "body", "hashtags"],
  });
  const dirty = hasRevisionEdits(
    source,
    { contentLocale, headline, body, hashtags },
    hashtagDraft,
  );
  const generationActive = isGenerationActive(card.generation?.lifecycle);
  const captionsReady = hasThreeReadyCaptions(card);

  const regenerateCaptions = async () => {
    if (generationActive || pending) return;
    retryCaptions.reset();
    setPending(true);
    onPendingChange(true);
    const settled = await retryCaptions.execute({
      analysisId,
      expectedVersion: analysisVersion,
      idempotencyKey: crypto.randomUUID(),
      modelOptionKey,
      platformDraftId: card.id,
    });
    if (settled.data?.status === "created") {
      operationCreated(settled.data.operationId);
    }
  };

  if (sourceCard !== incomingCard) {
    setSourceCard(incomingCard);
    setEditor((current) => acceptRevisionCard(current, incomingCard, true));
  }

  useLayoutEffect(() => {
    form.reset(editor.editorValues);
  }, [editor.editorValues, form]);

  const commands = useCopyVariantRevisionCommands({
    card,
    dirty,
    form,
    hashtagDraft,
    onAcceptCard: (next, revisionId) => {
      setEditor((current) => {
        const accepted = acceptRevisionCard(current, next, false);
        const revision = next.revisions.find(
          (entry) => entry.id === revisionId,
        );
        return revision
          ? selectEditSource(accepted, revisionEditSource(revision))
          : accepted;
      });
      onDirtyChange(false);
    },
    onPendingChange: (next) => {
      setPending(next);
      onPendingChange(next);
    },
    onSelectSource: (next) => {
      setEditor((current) => selectEditSource(current, next));
      onDirtyChange(false);
    },
    pending,
    source,
  });

  return (
    <>
      <BackgroundGradient
        className="grid min-w-0 gap-4 p-4"
        containerClassName="min-w-0"
      >
        {setup}
        <section
          aria-labelledby={optionsHeadingId}
          className="grid min-w-0 gap-2"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3
              className="ticket-label text-muted-foreground"
              id={optionsHeadingId}
            >
              {t("publish.optionsTitle")}
            </h3>
            <Button
              disabled={generationActive || pending || commands.busy}
              onClick={() => void regenerateCaptions()}
              size="sm"
              type="button"
              variant="outline"
            >
              {retryCaptions.isPending ? (
                <Spinner
                  data-icon="inline-start"
                  label={t("publish.retryingCaptions")}
                />
              ) : (
                <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
              )}
              {t("publish.regenerateCaptions")}
            </Button>
          </div>
          {retryCaptions.status === "error" ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("publish.captionRetryFailed")}</AlertTitle>
              <AlertDescription>
                {resolveError(retryCaptions.code)}
              </AlertDescription>
            </Alert>
          ) : null}
          <CaptionOptions
            card={card}
            disabled={commands.busy || !captionsReady}
            generating={generationActive}
            onSelect={(candidate) =>
              commands.requestSelection(candidateEditSource(candidate))
            }
            selectedId={source?.kind === "copy_variant" ? source.id : null}
          />
        </section>
      </BackgroundGradient>
      <div
        className="scroll-mt-[calc(var(--header-height)+(--spacing(4)))]"
        id={CAPTION_EDITOR_ID}
      >
        <CopyVariantEditor
          commands={commands}
          disabled={commands.busy || !captionsReady}
          dirty={dirty}
          form={form}
          hashtagDraft={hashtagDraft}
          nextRevisionNumber={card.nextRevisionNumber}
          onEditorChange={() => onDirtyChange(true)}
          onHashtagDraftChange={(value) => {
            setEditor((current) => ({ ...current, hashtagDraft: value }));
            onDirtyChange(value.trim() !== "" || dirty);
          }}
          platform={card.platform}
          revisions={card.revisions}
          source={source}
          sourceLoading={generationActive}
        />
      </div>
      <PublishingTicket
        card={card}
        disabled={commands.busy || !captionsReady}
        effectDisabled={commands.effectsBlocked}
        onPendingChange={(next) => {
          setPending(next);
          onPendingChange(next);
        }}
        savedChangeDisabled={commands.savedChangeBlocked}
      />
      <ConfirmDialog
        cancelLabel={t("publish.stay")}
        confirmLabel={t("publish.discard")}
        description={t("publish.discardDescription")}
        fallbackError={t("publish.commandError")}
        onConfirm={commands.confirmSelection}
        onOpenChange={commands.changeSelectionOpen}
        open={commands.selectionOpen}
        pendingLabel={t("publish.switching")}
        title={t("publish.discardTitle")}
        variant="destructive"
      />
    </>
  );
}

function isGenerationActive(lifecycle: string | null | undefined) {
  return (
    lifecycle === "queued" ||
    lifecycle === "running" ||
    lifecycle === "settling"
  );
}
