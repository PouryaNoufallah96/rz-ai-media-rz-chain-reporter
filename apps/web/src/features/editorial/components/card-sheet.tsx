"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  isOperationInProgress,
  MAX_REFERENCE_IMAGE_BYTES,
  type ModelOption,
  REFERENCE_IMAGE_KIND,
  REFERENCE_IMAGE_MIME_TYPES,
} from "@rz-chain-reporter/contracts";
import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import {
  Field,
  FieldDescription,
} from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import { MetalButton } from "@rz-chain-reporter/ui/components/metal-button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@rz-chain-reporter/ui/components/sheet";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { Textarea } from "@rz-chain-reporter/ui/components/textarea";
import {
  ChevronDownIcon,
  DownloadIcon,
  ImageIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type UseFormReturn, useForm, useWatch } from "react-hook-form";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { GenerationPlaceholder } from "@/components/common/generation-placeholder";
import { ModelIcon } from "@/components/common/model-icon";
import { PlatformIcon } from "@/components/common/platform-icon";
import { FieldCaption, LabeledSelect } from "@/components/form/form-field";
import { useAssistant } from "@/features/assistant/lib/assistant-context";
import { MARKET_ANALYSIS_NAMESPACE } from "@/features/market-analysis/constants";
import { createMediaUploadInputSchema } from "@/features/media/schemas/upload";
import { operationCreated } from "@/features/operations/lib/focus-operation";
import { PublishingTicket } from "@/features/publishing/components/publishing-ticket";
import { useAction } from "@/hooks/use-action";
import { Link } from "@/i18n/navigation";
import { client } from "@/lib/orpc";

import {
  refreshArticleAndRegenerateAction,
  regenerateCopyAction,
  retryCopyGenerationAction,
  retryImageGenerationAction,
  startImageGenerationAction,
} from "../actions/commands";
import { EDITORIAL_NAMESPACE } from "../constants";
import { useNarrowViewport } from "../hooks/use-narrow-viewport";
import {
  acceptRevisionCard,
  candidateEditSource,
  type EditSource,
  hasGenerationBlockingEdits,
  hasRevisionEdits,
  type RevisionDraftCard,
  revisionEditorState,
  revisionEditSource,
  selectEditSource,
} from "../lib/revision-editor-state";
import { type DraftEditorInput, draftEditorSchema } from "../schemas/drafts";
import type { RunOptions } from "../schemas/workspace";
import {
  CopyVariantEditor,
  type CopyVariantEditorCommands,
  CopyVariantSelector,
  RevisionWorkspaceSkeleton,
  SelectableItemSkeleton,
  useCopyVariantRevisionCommands,
} from "./copy-variant-editor";
import { CopyVariantTranslationButton } from "./copy-variant-translation-button";
import { EditorialFreshness } from "./editorial-freshness";
import { ExpandablePreview } from "./expandable-preview";

type SheetOpenChangeDetails = Parameters<
  NonNullable<ComponentProps<typeof Sheet>["onOpenChange"]>
>[1];

export function CardSheet({
  card: incomingCard,
  finalFocus,
  freshness,
  imageModels,
  loading = false,
  models,
  onOpenChange,
  open,
}: {
  card: RevisionDraftCard | null;
  finalFocus: HTMLElement | null;
  imageModels: readonly ModelOption[];
  models: RunOptions["models"];
  loading?: boolean;
  freshness?: {
    analysisRunId: string;
    readAt: Date;
  };
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();
  const [initialUiLocale] = useState(uiLocale);
  const assistant = useAssistant();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const narrow = useNarrowViewport();
  const [pending, setPending] = useState(false);
  const [sourceCard, setSourceCard] = useState(incomingCard);
  const [editor, setEditor] = useState(() =>
    revisionEditorState(incomingCard, initialUiLocale),
  );
  const loadedVersion = useRef(-1);
  const { card, source, hashtagDraft } = editor;
  const form = useForm<DraftEditorInput>({
    defaultValues: editor.editorValues,
    mode: "onSubmit",
    resolver: zodResolver(draftEditorSchema),
  });
  const [contentLocale, headline, body, hashtags] = useWatch({
    control: form.control,
    name: ["contentLocale", "headline", "body", "hashtags"],
  });
  const values: DraftEditorInput = { contentLocale, headline, body, hashtags };
  const dirty = hasRevisionEdits(source, values, hashtagDraft);
  const generationBlocked = hasGenerationBlockingEdits(
    source,
    values,
    hashtagDraft,
  );

  if (sourceCard !== incomingCard && (open || incomingCard !== null)) {
    setSourceCard(incomingCard);
    setEditor((current) => acceptRevisionCard(current, incomingCard, true));
  }

  const publishSheetCard = assistant.publishSheetCard;
  const publishLiveCard = () => {
    if (!open || !card) {
      publishSheetCard(null);
      return;
    }
    const current = form.getValues();
    publishSheetCard({
      contentLocale: current.contentLocale,
      copy: current.body,
      draftId: card.id,
      headline: current.headline,
      platform: card.platform,
    });
  };

  useLayoutEffect(() => {
    if (loadedVersion.current === editor.loadVersion) return;
    form.reset(editor.editorValues, { keepFieldsRef: true });
    loadedVersion.current = editor.loadVersion;
    if (!open || !card) {
      publishSheetCard(null);
      return;
    }
    publishSheetCard({
      contentLocale: editor.editorValues.contentLocale,
      copy: editor.editorValues.body,
      draftId: card.id,
      headline: editor.editorValues.headline,
      platform: card.platform,
    });
  }, [
    card,
    editor.editorValues,
    editor.loadVersion,
    form,
    open,
    publishSheetCard,
  ]);

  // Base UI leaves the shell tabbable behind a non-modal sheet's scrim, so
  // keyboard reach has to be closed to match the pointer block the scrim gives.
  useEffect(() => {
    if (!open) return;

    const shell = document.querySelector("[data-app-shell]");

    if (!shell) return;

    const inerted: HTMLElement[] = [];

    for (const child of shell.children) {
      if (
        child instanceof HTMLElement &&
        !child.inert &&
        !child.hasAttribute("data-assistant-fab")
      ) {
        child.inert = true;
        inerted.push(child);
      }
    }

    return () => {
      for (const child of inerted) {
        child.inert = false;
      }
    };
  }, [open]);

  const setHashtagDraft = (value: string) => {
    setEditor((current) => ({ ...current, hashtagDraft: value }));
  };

  const acceptCard = (next: RevisionDraftCard, revisionId: string) => {
    setEditor((current) => {
      const accepted = acceptRevisionCard(current, next, false);
      const revision = next.revisions.find((entry) => entry.id === revisionId);
      return revision
        ? selectEditSource(accepted, revisionEditSource(revision))
        : accepted;
    });
  };

  const selectSource = (next: EditSource) => {
    setEditor((current) => selectEditSource(current, next));
  };

  const requestOpenChange = (
    next: boolean,
    eventDetails: SheetOpenChangeDetails,
  ) => {
    const eventTarget =
      eventDetails.reason === "focus-out" &&
      eventDetails.event instanceof FocusEvent
        ? eventDetails.event.relatedTarget
        : eventDetails.event.target;
    const assistantInteraction =
      !next &&
      (eventDetails.reason === "outside-press" ||
        eventDetails.reason === "focus-out") &&
      eventTarget instanceof Element &&
      eventTarget.closest("[data-assistant-surface]") !== null;

    if (assistantInteraction || pending) {
      eventDetails.cancel();
      return;
    }
    if (!next && dirty) {
      eventDetails.cancel();
      setConfirmDiscard(true);
      return;
    }
    if (next) onOpenChange(true);
    else dismiss();
  };

  const dismiss = () => {
    publishSheetCard(null);
    assistant.clearCard();
    onOpenChange(false);
  };

  return (
    <>
      <Sheet
        modal={false}
        onOpenChange={requestOpenChange}
        onOpenChangeComplete={(next) => {
          if (next) return;
          setSourceCard(null);
          setEditor(revisionEditorState(null, initialUiLocale));
        }}
        open={open}
      >
        <SheetContent
          aria-busy={loading || undefined}
          className="w-full gap-5 max-compact:rounded-t-xl sm:w-[min(900px,100vw)] sm:[--sheet-padding:--spacing(5)] [&_button]:max-compact:min-h-11 [&_button]:max-compact:min-w-11"
          closeLabel={t("cardSheet.close")}
          finalFocus={() =>
            finalFocus?.isConnected
              ? finalFocus
              : document.getElementById("main-content")
          }
          side={narrow ? "block-end" : "inline-end"}
        >
          <SheetHeader className="flex-row flex-wrap items-center gap-2 pe-12">
            <SheetTitle className="me-1">{t("cardSheet.title")}</SheetTitle>
            {card ? (
              <MetalButton
                disableGlow
                onClick={() =>
                  assistant.askAboutCard({
                    contentLocale: values.contentLocale,
                    copy: values.body,
                    draftId: card.id,
                    headline: values.headline,
                    platform: card.platform,
                  })
                }
                size="sm"
                strength={0.25}
                type="button"
                variant="ghost"
              >
                {assistant.askAboutCardLabel}
              </MetalButton>
            ) : null}
            {freshness ? (
              <EditorialFreshness
                compact
                copyOperation={card?.generation ?? null}
                platformDraftId={card?.id}
                {...freshness}
              />
            ) : null}
          </SheetHeader>
          {loading ? (
            <CardSheetSkeleton />
          ) : card ? (
            <>
              <Information card={card} />
              <CardSheetBody
                card={card}
                dirty={dirty}
                generationBlocked={generationBlocked}
                form={form}
                hashtagDraft={hashtagDraft}
                imageModels={imageModels}
                models={models}
                onAcceptCard={acceptCard}
                onEditorChange={publishLiveCard}
                onHashtagDraftChange={setHashtagDraft}
                onPendingChange={setPending}
                onSelectSource={selectSource}
                pending={pending}
                source={source}
              />
            </>
          ) : (
            <div className="grid gap-2 rounded-xl border border-border bg-muted/40 p-5">
              <strong>{t("cardSheet.unavailable.title")}</strong>
              <p className="text-muted-foreground">
                {t("cardSheet.unavailable.body")}
              </p>
              <Button
                className="justify-self-start"
                onClick={dismiss}
                type="button"
                variant="outline"
              >
                {t("cardSheet.unavailable.dismiss")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        cancelLabel={t("cardSheet.discard.cancel")}
        confirmLabel={t("cardSheet.discard.confirm")}
        description={t("cardSheet.discard.description")}
        fallbackError={t("cardSheet.error.unknown")}
        onConfirm={() => {
          setEditor((current) =>
            acceptRevisionCard(current, current.card, false),
          );
          dismiss();
        }}
        onOpenChange={setConfirmDiscard}
        open={confirmDiscard}
        pendingLabel={t("cardSheet.discard.pending")}
        title={t("cardSheet.discard.title")}
      />
    </>
  );
}

function CardSheetSkeleton() {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const rows = [0, 1, 2] as const;

  return (
    <div aria-busy="true" className="grid gap-5" role="status">
      <span className="sr-only">{t("cardSheet.loading")}</span>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="grid workspace:grid-cols-[minmax(16rem,0.38fr)_minmax(0,0.62fr)] items-stretch gap-5">
        <div className="flex min-h-0 flex-col gap-4">
          <div className="grid gap-3 rounded-xl border border-border p-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid workspace:flex-1 content-start gap-2 rounded-xl border border-primary/20 p-3">
            <Skeleton className="mb-1 h-5 w-32" />
            {rows.map((row) => (
              <SelectableItemSkeleton key={row} />
            ))}
          </div>
        </div>
        <RevisionWorkspaceSkeleton />
      </div>
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="grid gap-4 rounded-xl border border-border p-4">
        <Skeleton className="h-5 w-36" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
    </div>
  );
}

function Information({ card }: { card: RevisionDraftCard }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <Collapsible className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger
        render={
          <Button
            className="group h-11 w-full justify-start px-4"
            variant="ghost"
          />
        }
      >
        <span className="font-medium text-sm">
          {t("cardSheet.information.title")}
        </span>
        <span className="ms-auto hidden items-center gap-1.5 text-muted-foreground text-xs sm:inline-flex">
          <PlatformIcon className="size-3.5" platform={card.platform} />
          {t("cardSheet.information.platform", {
            platform: t(`run.platform.${card.platform}`),
          })}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pt-2 pb-4 data-closed:hidden">
        <dl className="@container grid gap-3 text-xs">
          <CoreInformationFacts facts={card.originDetails} />
          <NarrativeInformationFacts facts={card.originDetails} />
          <MarketInformationFacts card={card} />
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function CoreInformationFacts({
  facts,
}: {
  facts: RevisionDraftCard["originDetails"];
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      {facts?.sourceName ? (
        <InformationFact label={t("detail.source")}>
          <Bdi>{facts.sourceName}</Bdi>
        </InformationFact>
      ) : null}
      {facts?.publishedAt ? (
        <InformationFact label={t("detail.publishedAt")}>
          {format.dateTime(facts.publishedAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </InformationFact>
      ) : null}
      {facts?.contentLocale ? (
        <InformationFact label={t("detail.contentLocale")}>
          <span className="font-mono">{facts.contentLocale}</span>
        </InformationFact>
      ) : null}
      {facts?.suggestedPlatform ? (
        <InformationFact label={t("detail.platform")}>
          <span className="inline-flex items-center gap-1.5">
            <PlatformIcon
              className="size-3.5"
              platform={facts.suggestedPlatform}
            />
            {t(`run.platform.${facts.suggestedPlatform}`)}
          </span>
        </InformationFact>
      ) : null}
      {facts?.suitabilityScore !== null &&
      facts?.suitabilityScore !== undefined ? (
        <InformationFact label={t("selection.suitability")}>
          <span className="tabular-nums">
            {format.number(facts.suitabilityScore)}
          </span>
        </InformationFact>
      ) : null}
    </>
  );
}

function NarrativeInformationFacts({
  facts,
}: {
  facts: RevisionDraftCard["originDetails"];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      {facts?.telegramReason ? (
        <InformationFact label={t("detail.reason")}>
          {t(`reason.${facts.telegramReason}`)}
        </InformationFact>
      ) : null}
      {facts?.canonicalUrl ? (
        <InformationFact label={t("detail.link")}>
          <a
            className="wrap-anywhere font-mono underline underline-offset-2"
            href={facts.canonicalUrl}
            rel="noreferrer"
            target="_blank"
          >
            <Bdi dir="ltr">
              {facts.canonicalUrl.replace(/^https?:\/\//, "")}
            </Bdi>
          </a>
        </InformationFact>
      ) : null}
      {facts?.summary ? (
        <InformationFact label={t("detail.summary")}>
          <ExpandablePreview>{facts.summary}</ExpandablePreview>
        </InformationFact>
      ) : null}
      {facts?.reasoning ? (
        <InformationFact label={t("detail.reasoning")}>
          <Bdi className="block text-start" dir="auto">
            {facts.reasoning}
          </Bdi>
        </InformationFact>
      ) : null}
      {facts?.promoAngle ? (
        <InformationFact label={t("promo.angle")}>
          <Bdi className="block text-start" dir="auto">
            {facts.promoAngle}
          </Bdi>
        </InformationFact>
      ) : null}
    </>
  );
}

function MarketInformationFacts({ card }: { card: RevisionDraftCard }) {
  const facts = card.originDetails;

  if (
    card.sourceKind !== "market" ||
    !facts ||
    !("marketAnalysisId" in facts) ||
    !facts.marketAnalysisId
  ) {
    return null;
  }

  return (
    <MarketOriginFacts
      marketAnalysisId={facts.marketAnalysisId}
      verifiedFacts={facts.verifiedFacts}
    />
  );
}

function MarketOriginFacts({
  marketAnalysisId,
  verifiedFacts,
}: {
  marketAnalysisId: string;
  verifiedFacts: unknown;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);

  return (
    <>
      <InformationFact label={t("publish.verifiedFacts")}>
        <Bdi className="block text-start" dir="auto">
          {verifiedFacts
            ? JSON.stringify(verifiedFacts)
            : t("publish.noVerifiedFacts")}
        </Bdi>
      </InformationFact>
      <InformationFact label={t("publish.analysis")}>
        <Link
          className="font-medium underline underline-offset-2"
          href={`/market-analysis/${marketAnalysisId}`}
        >
          {t("publish.analysisLink")}
        </Link>
      </InformationFact>
    </>
  );
}

function InformationFact({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid @sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1">
      <dt className="wrap-anywhere text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere min-w-0">{children}</dd>
    </div>
  );
}

type CardSheetBodyProps = {
  card: RevisionDraftCard;
  dirty: boolean;
  generationBlocked: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  imageModels: readonly ModelOption[];
  models: RunOptions["models"];
  onAcceptCard: (card: RevisionDraftCard, revisionId: string) => void;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  onSelectSource: (source: EditSource) => void;
  pending: boolean;
  source: EditSource | null;
};

function CardSheetBody(props: CardSheetBodyProps) {
  const {
    card,
    dirty,
    form,
    generationBlocked,
    hashtagDraft,
    imageModels,
    models,
    onHashtagDraftChange,
    onPendingChange,
    source,
  } = props;
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [generationPending, setGenerationPending] = useState(false);
  const generating =
    generationPending || isOperationInProgress(card.generation?.lifecycle);
  const commands = useCopyVariantRevisionCommands(props);
  const { active } = commands;
  const activeRevisionId = active?.id ?? null;
  const selectedImageId = active?.selectedFinalMediaAssetId ?? null;
  const [imagePanel, setImagePanel] = useState(() => ({
    cardId: card.id,
    imageId: selectedImageId,
    open: selectedImageId !== null,
    revisionId: activeRevisionId,
  }));

  if (
    imagePanel.cardId !== card.id ||
    imagePanel.revisionId !== activeRevisionId ||
    imagePanel.imageId !== selectedImageId
  ) {
    setImagePanel({
      cardId: card.id,
      imageId: selectedImageId,
      open:
        imagePanel.cardId === card.id
          ? selectedImageId !== null || imagePanel.open
          : selectedImageId !== null,
      revisionId: activeRevisionId,
    });
  }

  return (
    <>
      <span aria-live="polite" className="sr-only">
        {commands.switchingRevision ? t("cardSheet.switch.pending") : ""}
      </span>
      <CardRevisionWorkspace
        card={card}
        commands={commands}
        dirty={dirty}
        form={form}
        generating={generating}
        generationBlocked={generationBlocked}
        hashtagDraft={hashtagDraft}
        models={models}
        onEditorChange={props.onEditorChange}
        onGenerationPendingChange={setGenerationPending}
        onHashtagDraftChange={onHashtagDraftChange}
        onPendingChange={onPendingChange}
        source={source}
      />
      <CardImagePanel
        card={card}
        commands={commands}
        imageModels={imageModels}
        onOpenChange={(open) =>
          setImagePanel({
            cardId: card.id,
            imageId: selectedImageId,
            open,
            revisionId: activeRevisionId,
          })
        }
        onPendingChange={onPendingChange}
        open={imagePanel.open}
      />
      <PublishingTicket
        card={card}
        disabled={commands.busy}
        effectDisabled={
          commands.effectsBlocked ||
          Boolean(active?.hasNonterminalImageGeneration)
        }
        key={active?.id ?? "no-active-revision"}
        onPendingChange={onPendingChange}
        savedChangeDisabled={commands.savedChangeBlocked}
      />
      <ConfirmDialog
        cancelLabel={t("cardSheet.discard.cancel")}
        confirmLabel={t("cardSheet.switch.confirm")}
        description={t("cardSheet.discard.description")}
        fallbackError={t("cardSheet.error.unknown")}
        onConfirm={commands.confirmSelection}
        onOpenChange={commands.changeSelectionOpen}
        open={commands.selectionOpen}
        pendingLabel={t("cardSheet.switch.pending")}
        title={t("cardSheet.switch.title")}
        variant="destructive"
      />
    </>
  );
}

function CardRevisionWorkspace({
  card,
  commands,
  dirty,
  form,
  generating,
  generationBlocked,
  hashtagDraft,
  models,
  onEditorChange,
  onGenerationPendingChange,
  onHashtagDraftChange,
  onPendingChange,
  source,
}: {
  card: RevisionDraftCard;
  commands: CopyVariantEditorCommands;
  dirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  generating: boolean;
  generationBlocked: boolean;
  hashtagDraft: string;
  models: RunOptions["models"];
  onEditorChange: () => void;
  onGenerationPendingChange: (pending: boolean) => void;
  onHashtagDraftChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  source: EditSource | null;
}) {
  return (
    <div className="grid workspace:grid-cols-[minmax(16rem,0.38fr)_minmax(0,0.62fr)] items-start workspace:items-stretch gap-5">
      <aside className="flex workspace:min-h-0 min-w-0 flex-col gap-4">
        <CopyControls
          card={card}
          disabled={commands.busy}
          form={form}
          generationBlocked={generationBlocked}
          onGenerationPendingChange={onGenerationPendingChange}
          onPendingChange={onPendingChange}
        />
        <CopyVariantSelector
          card={card}
          disabled={commands.busy}
          generating={generating}
          models={models}
          onSelectCandidate={(candidate) =>
            commands.requestSelection(candidateEditSource(candidate))
          }
          renderCandidateMeta={(candidate) =>
            card.sourceKind === "market" ? null : (
              <CopyVariantTranslationButton candidate={candidate} />
            )
          }
          selectedSource={source}
        />
      </aside>
      <div className="min-w-0">
        <CopyVariantEditor
          commands={commands}
          disabled={commands.busy || generating}
          dirty={dirty}
          form={form}
          hashtagDraft={hashtagDraft}
          nextRevisionNumber={card.nextRevisionNumber}
          onEditorChange={onEditorChange}
          onHashtagDraftChange={onHashtagDraftChange}
          platform={card.platform}
          revisions={card.revisions}
          source={source}
          sourceLoading={generating && source === null}
        />
      </div>
    </div>
  );
}

function CardImagePanel({
  card,
  commands,
  imageModels,
  onOpenChange,
  onPendingChange,
  open,
}: {
  card: RevisionDraftCard;
  commands: CopyVariantEditorCommands;
  imageModels: readonly ModelOption[];
  onOpenChange: (open: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  open: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const active = commands.active;
  const selectedImageId = active?.selectedFinalMediaAssetId ?? null;

  if (card.sourceKind === "market" && !selectedImageId) return null;

  return (
    <BackgroundGradient containerClassName="w-full" className="ring-0">
      <Collapsible
        className="rounded-xl bg-card"
        onOpenChange={onOpenChange}
        open={open}
      >
        <CollapsibleTrigger
          render={
            <Button
              className="group h-12 w-full justify-start px-4"
              variant="ghost"
            />
          }
        >
          <ImageIcon aria-hidden="true" />
          {t("cardSheet.image")}
          {active?.imageProvenanceMismatch ? (
            <span className="ms-auto text-working text-xs">
              {t("cardSheet.imageMismatchSummary")}
            </span>
          ) : null}
          <ChevronDownIcon
            className={`${active?.imageProvenanceMismatch ? "" : "ms-auto"} transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none`}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent
          className="px-4 pb-4 data-closed:hidden"
          keepMounted
        >
          {card.sourceKind === "market" && selectedImageId ? (
            <RevisionImage
              alt={t("cardSheet.imageAlt", {
                brand: card.brandName,
                headline: active?.headline ?? card.originTitle,
              })}
              mediaAssetId={selectedImageId}
            />
          ) : (
            <ImageControls
              active={active}
              card={card}
              editorDirty={commands.effectsBlocked}
              imageModels={imageModels}
              key={active?.id ?? "no-active-revision"}
              onAdopt={commands.adoptImage}
              onPendingChange={onPendingChange}
              onRemove={commands.removeImage}
              resolveError={commands.resolveError}
              revisionPending={commands.busy}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </BackgroundGradient>
  );
}

type ReferenceUpload = {
  fileName: string;
  mediaAssetId: string | null;
  status: "uploading" | "verifying" | "verified" | "rejected" | "failed";
};

const REFERENCE_POLL_INTERVAL_MS = 1_500;
const REFERENCE_POLL_ATTEMPTS = 40;

async function uploadImage(
  file: File,
  kind: "image" | typeof REFERENCE_IMAGE_KIND,
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const parsed = createMediaUploadInputSchema.safeParse({
    file,
    declaredBytes: file.size,
    declaredChecksum: Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    declaredMimeType: file.type,
    kind,
  });
  if (!parsed.success) return null;
  const intent = await client.media.createIntent(parsed.data);
  return intent.mediaAssetId;
}

function useVerifiedImageUpload(
  platformDraftId: string,
  kind: "image" | typeof REFERENCE_IMAGE_KIND,
  emit: (upload: ReferenceUpload | null) => void,
) {
  const live = useRef(true);
  const run = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const cancel = () => {
    run.current += 1;
    emit(null);
  };

  const select = async (file: File | undefined) => {
    run.current += 1;
    const selection = run.current;
    const current = () => live.current && run.current === selection;
    if (!file) {
      emit(null);
      return;
    }
    emit({ fileName: file.name, mediaAssetId: null, status: "uploading" });
    const mediaAssetId = await uploadImage(file, kind).catch(() => null);
    if (!current()) return;
    if (!mediaAssetId) {
      emit({ fileName: file.name, mediaAssetId: null, status: "failed" });
      return;
    }
    emit({ fileName: file.name, mediaAssetId, status: "verifying" });
    for (let attempt = 0; attempt < REFERENCE_POLL_ATTEMPTS; attempt += 1) {
      const confirmed = await client.media
        .confirm({ mediaAssetId, platformDraftId })
        .catch(() => null);
      if (!current()) return;
      if (!confirmed) {
        emit({ fileName: file.name, mediaAssetId, status: "failed" });
        return;
      }
      if (confirmed.lifecycle === "verified") {
        emit({ fileName: file.name, mediaAssetId, status: "verified" });
        return;
      }
      if (confirmed.lifecycle === "rejected") {
        emit({ fileName: file.name, mediaAssetId, status: "rejected" });
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, REFERENCE_POLL_INTERVAL_MS),
      );
      if (!current()) return;
    }
    emit({ fileName: file.name, mediaAssetId, status: "failed" });
  };

  return { cancel, select };
}

function RevisionImage({
  alt,
  children,
  mediaAssetId,
}: {
  alt: string;
  children?: ReactNode;
  mediaAssetId: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <Image
        alt={alt}
        className="h-auto w-full rounded-lg border border-border"
        height={1350}
        sizes="(max-width: 639px) 100vw, 62vw"
        src={`/api/media/${mediaAssetId}`}
        unoptimized
        width={1080}
      />
      <Button
        nativeButton={false}
        render={
          <a
            aria-label={t("cardSheet.imageDownload")}
            download
            href={`/api/media/${mediaAssetId}?download=1`}
          />
        }
        variant="outline"
      >
        <DownloadIcon aria-hidden="true" />
        {t("cardSheet.imageDownload")}
      </Button>
      {children}
    </div>
  );
}

function isReferenceBusy(reference: ReferenceUpload | null) {
  return reference?.status === "uploading" || reference?.status === "verifying";
}

function imageInteractionDisabled({
  busy,
  editorDirty,
  mediaLocked,
  revisionPending,
}: {
  busy: boolean;
  editorDirty: boolean;
  mediaLocked: boolean;
  revisionPending: boolean;
}) {
  return busy || revisionPending || editorDirty || mediaLocked;
}

function imageGenerationDisabled({
  imageSourceReady,
  interactionDisabled,
  modelOptionKey,
  referenceBusy,
}: {
  imageSourceReady: boolean;
  interactionDisabled: boolean;
  modelOptionKey: string;
  referenceBusy: boolean;
}) {
  return (
    !imageSourceReady || !modelOptionKey || interactionDisabled || referenceBusy
  );
}

function ImageControls({
  active,
  card,
  editorDirty,
  imageModels,
  onAdopt,
  onPendingChange,
  onRemove,
  resolveError,
  revisionPending,
}: {
  card: RevisionDraftCard;
  editorDirty: boolean;
  active: RevisionDraftCard["revisions"][number] | null;
  imageModels: readonly ModelOption[];
  onAdopt: (mediaAssetId: string) => Promise<void>;
  onPendingChange: (pending: boolean) => void;
  onRemove: () => Promise<void>;
  resolveError: (code: string | undefined) => string;
  revisionPending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [commandError, setCommandError] = useState("");
  const [modelOptionKey, setModelOptionKey] = useState(
    card.imageGeneration?.modelOptionKey ?? imageModels[0]?.key ?? "",
  );
  const [operatorDirection, setOperatorDirection] = useState("");
  const [reference, setReference] = useState<ReferenceUpload | null>(null);
  const onSettled = () => onPendingChange(false);
  const start = useAction(startImageGenerationAction, { onSettled });
  const retry = useAction(retryImageGenerationAction, { onSettled });
  const operation = card.imageGeneration;
  const nonterminal = isOperationInProgress(operation?.lifecycle);
  const pending = start.isPending || retry.isPending;
  const busy = pending || nonterminal;
  const referenceBusy = isReferenceBusy(reference);
  const imageSourceReady = active?.imageSourceReadiness === "ready";
  const interactionDisabled = imageInteractionDisabled({
    busy,
    editorDirty,
    mediaLocked: Boolean(active?.mediaLocked),
    revisionPending,
  });
  const disabled = imageGenerationDisabled({
    imageSourceReady,
    interactionDisabled,
    modelOptionKey,
    referenceBusy,
  });

  const execute = async () => {
    if (!active || disabled) return;
    setCommandError("");
    const common = {
      draftRevisionId: active.id,
      expectedRevisionVersion: card.revisionVersion,
      expectedImageIntentVersion: active.imageIntentVersion,
      idempotencyKey: crypto.randomUUID(),
      modelOptionKey,
      operatorDirection,
      ...(reference?.status === "verified" && reference.mediaAssetId
        ? { referenceMediaAssetId: reference.mediaAssetId }
        : {}),
    };
    onPendingChange(true);
    const settled = operation
      ? await retry.execute({ ...common, kind: "retry" })
      : await start.execute({ ...common, kind: "start" });
    if (settled.data?.status === "created") {
      operationCreated(settled.data.operationId);
    }
    if (settled.status === "error") {
      setCommandError(
        resolveError(settled.fieldErrors?.operatorDirection ?? settled.code),
      );
    }
  };

  return (
    <div aria-busy={busy || undefined} className="mt-1 grid gap-4">
      <ImageReadinessMessages
        active={active}
        imageSourceReady={imageSourceReady}
      />
      <LabeledSelect
        disabled={interactionDisabled}
        id={`image-model-${card.id}`}
        label={t("cardSheet.imageModel")}
        onValueChange={(next) => {
          if (next) setModelOptionKey(next);
        }}
        options={imageModels.map((model) => ({
          label: (
            <span className="flex items-center gap-2">
              <ModelIcon className="size-4 shrink-0" vendor={model.vendor} />
              {model.name}
            </span>
          ),
          value: model.key,
        }))}
        triggerClassName="w-full"
        value={modelOptionKey}
      />
      <ImageDirectionField
        cardId={card.id}
        commandError={commandError}
        disabled={interactionDisabled}
        onChange={setOperatorDirection}
        value={operatorDirection}
      />
      <ReferenceImageField
        cardId={card.id}
        clearDisabled={interactionDisabled}
        disabled={interactionDisabled || referenceBusy}
        onChange={setReference}
        reference={reference}
      />
      <OperatorFinalImageField
        adoptDisabled={interactionDisabled}
        cardId={card.id}
        inputDisabled={!active || interactionDisabled}
        onAdopt={onAdopt}
      />
      <ImageGenerationStatus
        imageSourceReady={imageSourceReady}
        nonterminal={nonterminal}
        operation={operation}
      />
      <SelectedFinalImage
        active={active}
        card={card}
        disabled={interactionDisabled}
        editorDirty={editorDirty}
        onRemove={onRemove}
      />
      <Button disabled={disabled} onClick={execute} type="button">
        {busy ? (
          <Spinner
            data-icon="inline-start"
            label={t("cardSheet.imagePending")}
          />
        ) : null}
        {busy
          ? t("cardSheet.imagePending")
          : operation
            ? t("cardSheet.imageRetry")
            : t("cardSheet.imageGenerate")}
      </Button>
    </div>
  );
}

function ImageReadinessMessages({
  active,
  imageSourceReady,
}: {
  active: CopyVariantEditorCommands["active"];
  imageSourceReady: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      <p
        aria-live="polite"
        className={
          active && !imageSourceReady
            ? "text-destructive"
            : "text-muted-foreground"
        }
      >
        {!active
          ? t("cardSheet.imageNeedsRevision")
          : imageSourceReady
            ? t("cardSheet.imageReady")
            : t("cardSheet.imageSourceExtractRequired")}
      </p>
      {active?.mediaLocked ? (
        <p className="text-muted-foreground text-sm" role="status">
          {t("cardSheet.imageLocked")}
        </p>
      ) : null}
      {active?.imageProvenanceMismatch ? (
        <p className="text-sm text-working" role="status">
          {t("cardSheet.imageMismatch")}
        </p>
      ) : null}
    </>
  );
}

function ImageDirectionField({
  cardId,
  commandError,
  disabled,
  onChange,
  value,
}: {
  cardId: string;
  commandError: string;
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const errorId = `image-direction-error-${cardId}`;

  return (
    <Field>
      <FieldCaption htmlFor={`image-direction-${cardId}`}>
        {t("cardSheet.imageDirection")}
      </FieldCaption>
      <Textarea
        aria-describedby={commandError ? errorId : undefined}
        aria-invalid={commandError ? true : undefined}
        disabled={disabled}
        id={`image-direction-${cardId}`}
        maxLength={1_000}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
      <FieldDescription>{t("cardSheet.imageDirectionHint")}</FieldDescription>
      {commandError ? (
        <p className="text-destructive text-xs" id={errorId} role="alert">
          {commandError}
        </p>
      ) : null}
    </Field>
  );
}

function ImageGenerationStatus({
  imageSourceReady,
  nonterminal,
  operation,
}: {
  imageSourceReady: boolean;
  nonterminal: boolean;
  operation: RevisionDraftCard["imageGeneration"];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      {operation && nonterminal ? (
        <GenerationPlaceholder
          height={1350}
          label={t("cardSheet.imageStatus", {
            status: t(`platformDraft.lifecycle.${operation.lifecycle}`),
          })}
          width={1080}
        />
      ) : (
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {operation
            ? t("cardSheet.imageStatus", {
                status: t(`platformDraft.lifecycle.${operation.lifecycle}`),
              })
            : t("cardSheet.imageStatusIdle")}
        </p>
      )}
      {operation?.lifecycle === "failed" && imageSourceReady ? (
        <p className="text-destructive text-sm">{t("cardSheet.imageFailed")}</p>
      ) : null}
    </>
  );
}

function SelectedFinalImage({
  active,
  card,
  disabled,
  editorDirty,
  onRemove,
}: {
  active: CopyVariantEditorCommands["active"];
  card: RevisionDraftCard;
  disabled: boolean;
  editorDirty: boolean;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const mediaAssetId = active?.selectedFinalMediaAssetId;

  if (!mediaAssetId) return null;

  return (
    <RevisionImage
      alt={t("cardSheet.imageAlt", {
        brand: card.brandName,
        headline: active.headline ?? card.originTitle,
      })}
      mediaAssetId={mediaAssetId}
    >
      <p className="text-muted-foreground text-sm">
        {t("cardSheet.imageAttached")}
      </p>
      {editorDirty ? (
        <p className="text-muted-foreground text-xs">
          {t("cardSheet.imageRemoveBlocked")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          onClick={onRemove}
          type="button"
          variant="outline"
        >
          {t("cardSheet.imageRemove")}
        </Button>
      </div>
    </RevisionImage>
  );
}

function ReferenceImageField({
  cardId,
  clearDisabled,
  disabled,
  onChange,
  reference,
}: {
  cardId: string;
  clearDisabled: boolean;
  disabled: boolean;
  onChange: (reference: ReferenceUpload | null) => void;
  reference: ReferenceUpload | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const input = useRef<HTMLInputElement>(null);
  const { cancel, select } = useVerifiedImageUpload(
    cardId,
    REFERENCE_IMAGE_KIND,
    onChange,
  );
  const busy =
    reference?.status === "uploading" || reference?.status === "verifying";

  const clear = () => {
    cancel();
    if (input.current) input.current.value = "";
    input.current?.focus();
  };

  return (
    <Field>
      <FieldCaption htmlFor={`image-reference-${cardId}`}>
        {t("cardSheet.imageReference")}
      </FieldCaption>
      <Input
        accept={REFERENCE_IMAGE_MIME_TYPES.join(",")}
        disabled={disabled}
        id={`image-reference-${cardId}`}
        ref={input}
        onChange={(event) => select(event.currentTarget.files?.[0])}
        type="file"
      />
      <FieldDescription>
        {t("cardSheet.imageReferenceHint", {
          kb: Math.floor(MAX_REFERENCE_IMAGE_BYTES / 1024),
        })}
      </FieldDescription>
      {reference ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            aria-live="polite"
            className={
              reference.status === "rejected" || reference.status === "failed"
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {busy ? (
              <Spinner
                className="size-4"
                label={t("cardSheet.imageReferenceUploading")}
              />
            ) : null}
            {t(`cardSheet.imageReferenceState.${reference.status}`, {
              file: reference.fileName,
            })}
          </p>
          <Button
            aria-label={t("cardSheet.imageReferenceRemove", {
              file: reference.fileName,
            })}
            disabled={clearDisabled}
            onClick={clear}
            size="sm"
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" />
            {t("cardSheet.imageReferenceClear")}
          </Button>
        </div>
      ) : null}
    </Field>
  );
}

function OperatorFinalImageField({
  adoptDisabled,
  cardId,
  inputDisabled,
  onAdopt,
}: {
  adoptDisabled: boolean;
  cardId: string;
  inputDisabled: boolean;
  onAdopt: (mediaAssetId: string) => Promise<void>;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [upload, setUpload] = useState<ReferenceUpload | null>(null);
  const { select } = useVerifiedImageUpload(cardId, "image", setUpload);

  return (
    <Field>
      <FieldCaption htmlFor={`image-final-upload-${cardId}`}>
        {t("cardSheet.imageFinalUpload")}
      </FieldCaption>
      <Input
        accept={REFERENCE_IMAGE_MIME_TYPES.join(",")}
        disabled={inputDisabled}
        id={`image-final-upload-${cardId}`}
        onChange={(event) => select(event.currentTarget.files?.[0])}
        type="file"
      />
      <FieldDescription>{t("cardSheet.imageFinalUploadHint")}</FieldDescription>
      {upload ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            aria-live="polite"
            className={
              upload.status === "failed" || upload.status === "rejected"
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {t(`cardSheet.imageReferenceState.${upload.status}`, {
              file: upload.fileName,
            })}
          </p>
          {upload.status === "verified" && upload.mediaAssetId ? (
            <Button
              disabled={adoptDisabled}
              onClick={() => onAdopt(upload.mediaAssetId ?? "")}
              size="sm"
              type="button"
            >
              {t("cardSheet.imageFinalSelect")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}

function isCopyCommandPending(
  regeneratePending: boolean,
  refreshPending: boolean,
  retryPending: boolean,
) {
  return regeneratePending || refreshPending || retryPending;
}

function copyGenerationBlocked(
  disabled: boolean,
  generationBlocked: boolean,
  pending: boolean,
  nonterminal: boolean,
) {
  return disabled || generationBlocked || pending || nonterminal;
}

function CopyControls({
  card,
  disabled,
  form,
  generationBlocked,
  onGenerationPendingChange,
  onPendingChange,
}: {
  card: RevisionDraftCard;
  disabled: boolean;
  form: UseFormReturn<DraftEditorInput>;
  generationBlocked: boolean;
  onGenerationPendingChange: (pending: boolean) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const uiLocale = useLocale();
  const onSettled = () => {
    onGenerationPendingChange(false);
    onPendingChange(false);
  };
  const regenerate = useAction(regenerateCopyAction, { onSettled });
  const refreshArticle = useAction(refreshArticleAndRegenerateAction, {
    onSettled,
  });
  const retry = useAction(retryCopyGenerationAction, { onSettled });
  const pending = isCopyCommandPending(
    regenerate.isPending,
    refreshArticle.isPending,
    retry.isPending,
  );
  const nonterminal = isOperationInProgress(card.generation?.lifecycle);
  const actionBlocked = copyGenerationBlocked(
    disabled,
    generationBlocked,
    pending,
    nonterminal,
  );
  const failedUnits =
    card.generation?.units.filter((unit) => unit.status === "failed").length ??
    0;

  const run = async (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => {
    if (actionBlocked) return;
    form.clearErrors("root");
    const common = {
      platformDraftId: card.id,
      idempotencyKey: crypto.randomUUID(),
    };
    const requestedContentLocale = uiLocale;
    const modelOptionKey = card.generation?.modelOptionKey ?? "";
    onGenerationPendingChange(true);
    onPendingChange(true);
    const settled =
      kind === "retry_failed"
        ? await retry.execute({ kind, ...common, requestedContentLocale })
        : kind === "refresh_article"
          ? await refreshArticle.execute({
              kind,
              ...common,
              modelOptionKey,
              requestedContentLocale,
            })
          : await regenerate.execute({
              kind,
              ...common,
              modelOptionKey,
              requestedContentLocale,
            });
    if (settled.data?.status === "created") {
      operationCreated(settled.data.operationId);
    }
    if (settled.status === "error") {
      form.setError("root.server", {
        message: settled.code,
        type: "server",
      });
    }
  };

  return (
    <section
      aria-busy={pending || nonterminal || undefined}
      aria-labelledby={`copy-actions-${card.id}`}
      className="grid gap-3 rounded-xl border border-border bg-card p-3"
    >
      <h3 className="ticket-label" id={`copy-actions-${card.id}`}>
        {t("cardSheet.copyActions")}
      </h3>
      {generationBlocked ? (
        <p
          className="text-muted-foreground text-xs"
          id={`copy-actions-dirty-${card.id}`}
        >
          {t("cardSheet.generationDirtyBlocked")}
        </p>
      ) : null}
      <CopyActionButtons
        actionBlocked={actionBlocked}
        card={card}
        failedUnits={failedUnits}
        generationBlocked={generationBlocked}
        onRun={run}
        uiLocale={uiLocale}
      />
    </section>
  );
}

function CopyActionButtons({
  actionBlocked,
  card,
  failedUnits,
  generationBlocked,
  onRun,
  uiLocale,
}: {
  actionBlocked: boolean;
  card: RevisionDraftCard;
  failedUnits: number;
  generationBlocked: boolean;
  onRun: (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => Promise<void>;
  uiLocale: string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const descriptionId = generationBlocked
    ? `copy-actions-dirty-${card.id}`
    : undefined;

  return (
    <div className="grid gap-2">
      <Button
        aria-describedby={descriptionId}
        className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
        disabled={actionBlocked || !card.generation}
        onClick={() => onRun("regenerate")}
        type="button"
        variant="outline"
      >
        <RotateCcwIcon aria-hidden="true" />
        {t("cardSheet.regenerate")}
      </Button>
      {card.sourceKind === "rss" ? (
        <Button
          aria-describedby={descriptionId}
          className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
          disabled={actionBlocked || !card.generation}
          onClick={() => onRun("refresh_article")}
          type="button"
          variant="outline"
        >
          <RefreshCwIcon aria-hidden="true" />
          {t("cardSheet.refreshArticle")}
        </Button>
      ) : null}
      {failedUnits > 0 &&
      card.generation?.requestedContentLocale === uiLocale ? (
        <Button
          aria-describedby={descriptionId}
          className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
          disabled={actionBlocked}
          onClick={() => onRun("retry_failed")}
          type="button"
          variant="outline"
        >
          <RotateCcwIcon aria-hidden="true" />
          {t("cardSheet.retryFailed", { n: failedUnits })}
        </Button>
      ) : null}
    </div>
  );
}
