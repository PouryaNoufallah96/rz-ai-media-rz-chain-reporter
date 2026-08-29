"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  assembleCopy,
  type ContentLocale,
  INLINE_HASHTAG_TOKEN,
  MAX_REFERENCE_IMAGE_BYTES,
  type OperationLifecycle,
  PLATFORM_COPY_HARD_MAX,
  type Platform,
  platformCopyLength,
  REFERENCE_IMAGE_KIND,
  REFERENCE_IMAGE_MIME_TYPES,
} from "@rz-chain-reporter/contracts";
import { DIRECTION } from "@rz-chain-reporter/i18n";
import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
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
  FieldGroup,
} from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rz-chain-reporter/ui/components/input-group";
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
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  HistoryIcon,
  ImageIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
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
import {
  FieldCaption,
  FormField,
  FormInputField,
  FormRootError,
  FormSelectField,
  FormTextareaField,
  LabeledSelect,
} from "@/components/form/form-field";
import { useAssistant } from "@/features/assistant/lib/assistant-context";
import { createMediaUploadInputSchema } from "@/features/media/schemas/upload";
import { PublishingTicket } from "@/features/publishing/components/publishing-ticket";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { client } from "@/lib/orpc";

import {
  refreshArticleAndRegenerateAction,
  regenerateCopyAction,
  retryCopyGenerationAction,
  retryImageGenerationAction,
  startImageGenerationAction,
  updateDraftRevisionAction,
} from "../actions/commands";
import { refreshEditorialReadsAction } from "../actions/refresh-editorial-reads";
import { EDITORIAL_NAMESPACE } from "../constants";
import { useNarrowViewport } from "../hooks/use-narrow-viewport";
import {
  acceptRevisionCard,
  canChangeSavedCard,
  canCreateRevision,
  candidateEditSource,
  type EditSource,
  hasGenerationBlockingEdits,
  hasRevisionEdits,
  revisionEditorState,
  revisionEditSource,
  selectEditSource,
} from "../lib/revision-editor-state";
import {
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftCard,
  type UpdateDraftRevisionInput,
} from "../schemas/drafts";
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
  onOpenChange,
  open,
}: {
  card: PlatformDraftCard | null;
  finalFocus: HTMLElement | null;
  imageModels: readonly { key: string; name: string }[];
  loading?: boolean;
  freshness?: {
    analysisRunId: string;
    lifecycle: OperationLifecycle;
    readAt: Date;
  };
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const assistant = useAssistant();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const narrow = useNarrowViewport();
  const [pending, setPending] = useState(false);
  const [sourceCard, setSourceCard] = useState(incomingCard);
  const [editor, setEditor] = useState(() => revisionEditorState(incomingCard));
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

  const acceptCard = (next: PlatformDraftCard, revisionId: string) => {
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
    if (!next) publishSheetCard(null);
    onOpenChange(next);
  };

  return (
    <>
      <Sheet
        modal={false}
        onOpenChange={requestOpenChange}
        onOpenChangeComplete={(next) => {
          if (next) return;
          setSourceCard(null);
          setEditor(revisionEditorState(null));
        }}
        open={open}
      >
        <SheetContent
          aria-busy={loading || undefined}
          className="w-full gap-5 max-[599px]:rounded-t-xl sm:w-[min(900px,100vw)] sm:p-5"
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
                onClick={() => {
                  publishSheetCard(null);
                  onOpenChange(false);
                }}
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
          publishSheetCard(null);
          onOpenChange(false);
        }}
        onOpenChange={setConfirmDiscard}
        open={confirmDiscard}
        pendingLabel={t("cardSheet.discard.pending")}
        title={t("cardSheet.discard.title")}
      />
    </>
  );
}

type Revision = PlatformDraftCard["revisions"][number];

function CardSheetSkeleton() {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const rows = [0, 1, 2] as const;

  return (
    <div aria-busy="true" className="grid gap-5" role="status">
      <span className="sr-only">{t("cardSheet.loading")}</span>
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="grid items-stretch gap-5 min-[900px]:grid-cols-[minmax(16rem,0.38fr)_minmax(0,0.62fr)]">
        <div className="grid content-start gap-4">
          <div className="grid gap-3 rounded-xl border border-border p-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid gap-2 rounded-xl border border-primary/20 p-3">
            <Skeleton className="mb-1 h-5 w-32" />
            {rows.map((row) => (
              <SelectableItemSkeleton key={row} />
            ))}
          </div>
          <div className="grid gap-2 rounded-xl border border-border p-3">
            <Skeleton className="mb-1 h-5 w-24" />
            <SelectableItemSkeleton />
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

function SelectableItemSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid min-h-20 gap-2 rounded-lg border border-border bg-background/70 p-2"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

function RevisionWorkspaceSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid content-start gap-4 rounded-xl border border-border bg-card p-4 min-[900px]:h-full"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

const CARD_SHEET_ERROR_KEYS = {
  DRAFT_BODY_REQUIRED: "cardSheet.error.body",
  DRAFT_HASHTAG_REQUIRED: "cardSheet.error.hashtags",
  DRAFT_HASHTAGS_REQUIRED: "cardSheet.error.hashtags",
  DRAFT_HEADLINE_REQUIRED: "cardSheet.error.headline",
  MEDIA_CONTENT_MISMATCH: "cardSheet.error.mediaContentMismatch",
  MEDIA_INVALID: "cardSheet.error.mediaInvalid",
  MEDIA_LOCKED: "cardSheet.error.mediaLocked",
  OPERATION_IN_PROGRESS: "cardSheet.error.operationInProgress",
  OPERATOR_DIRECTION_INVALID: "cardSheet.error.imageDirection",
  REFERENCE_CONFLICT: "cardSheet.error.referenceConflict",
  IMAGE_SOURCE_EXTRACT_REQUIRED: "cardSheet.error.imageSourceExtractRequired",
  IMAGE_INTENT_CONFLICT: "cardSheet.error.conflict",
  TEMPLATE_DRIFT: "cardSheet.error.templateDrift",
  VALIDATION_FAILED: "cardSheet.error.validation",
  VERSION_CONFLICT: "cardSheet.error.conflict",
} as const;

function isCardSheetErrorCode(
  value: string,
): value is keyof typeof CARD_SHEET_ERROR_KEYS {
  return value in CARD_SHEET_ERROR_KEYS;
}

function Information({ card }: { card: PlatformDraftCard }) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const facts = card.originDetails;

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
        <span className="ms-auto hidden text-muted-foreground text-xs sm:inline">
          {t("cardSheet.information.platform", {
            platform: t(`run.platform.${card.platform}`),
          })}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pt-2 pb-4 data-closed:hidden">
        <dl className="@container grid gap-3 text-xs">
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
              {t(`run.platform.${facts.suggestedPlatform}`)}
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
        </dl>
      </CollapsibleContent>
    </Collapsible>
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
  card: PlatformDraftCard;
  dirty: boolean;
  generationBlocked: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  imageModels: readonly { key: string; name: string }[];
  onAcceptCard: (card: PlatformDraftCard, revisionId: string) => void;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  onSelectSource: (source: EditSource) => void;
  pending: boolean;
  source: EditSource | null;
};

function isCopyGenerationNonterminal(
  generation: PlatformDraftCard["generation"],
) {
  return (
    generation?.lifecycle === "queued" ||
    generation?.lifecycle === "running" ||
    generation?.lifecycle === "settling"
  );
}

function useRevisionCommands({
  card,
  dirty,
  form,
  hashtagDraft,
  onAcceptCard,
  onPendingChange,
  onSelectSource,
  pending,
  source,
}: CardSheetBodyProps) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [selection, setSelection] = useState<EditSource | null>(null);
  const [switchingRevision, setSwitchingRevision] = useState(false);
  const [serverConflict, setServerConflict] = useState<number | null>(null);
  const updateRevision = useAction(updateDraftRevisionAction, {
    onSuccess: (data) => {
      onAcceptCard(data.card, data.revision.id);
      setServerConflict(null);
    },
    onSettled: () => onPendingChange(false),
  });
  const { isSubmitting } = form.formState;
  const busy = pending || updateRevision.isPending || isSubmitting;
  const active =
    card.revisions.find((revision) => revision.id === card.activeRevisionId) ??
    null;
  const waitingForRefresh =
    serverConflict !== null && card.revisionVersion <= serverConflict;
  const sourceIsActive =
    source?.kind === "draft_revision" && source.id === card.activeRevisionId;
  const effectsBlocked = dirty || waitingForRefresh || !sourceIsActive;
  const savedChangeBlocked = !canChangeSavedCard(
    source,
    dirty,
    waitingForRefresh,
  );

  const resolveError = (code: string | undefined) =>
    code !== undefined && isCardSheetErrorCode(code)
      ? t(CARD_SHEET_ERROR_KEYS[code])
      : t("cardSheet.error.unknown");

  const executeRevision = async (input: UpdateDraftRevisionInput) => {
    if (pending || updateRevision.isPending) return false;
    onPendingChange(true);
    form.clearErrors("root");
    const settled = await updateRevision.execute(input);
    if (settled.status === "error" || !settled.data) {
      applyActionErrorToForm(form.setError, settled, form.setFocus);
      if (settled.code === "VERSION_CONFLICT") {
        setServerConflict(input.expectedActive.version);
        try {
          await refreshEditorialReadsAction();
        } catch {
          form.setError("root.server", {
            type: "server",
            message: "VERSION_CONFLICT",
          });
        }
      }
      return false;
    }
    return true;
  };

  const expectedActive = {
    id: card.activeRevisionId,
    version: card.revisionVersion,
  };

  const applySelection = async (next: EditSource) => {
    form.clearErrors("root");
    if (next.kind === "copy_variant") {
      onSelectSource(next);
      return true;
    }
    setSwitchingRevision(true);
    const selected = await executeRevision({
      commandKind: "select_revision",
      platformDraftId: card.id,
      draftRevisionId: next.id,
      expectedActive,
      idempotencyKey: crypto.randomUUID(),
    });
    setSwitchingRevision(false);
    return selected;
  };

  const requestSelection = (next: EditSource) => {
    if (busy) return;
    if (source?.kind === next.kind && source.id === next.id) return;
    if (dirty) {
      setSelection(next);
      return;
    }
    void applySelection(next);
  };

  const removeImage = async () => {
    if (effectsBlocked) return;
    await executeRevision({
      commandKind: "remove_image",
      platformDraftId: card.id,
      expectedActive,
      expectedImageIntentVersion: active?.imageIntentVersion ?? 0,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const adoptImage = async (finalMediaAssetId: string) => {
    if (effectsBlocked) return;
    await executeRevision({
      commandKind: "adopt_image",
      platformDraftId: card.id,
      finalMediaAssetId,
      expectedActive,
      expectedImageIntentVersion: active?.imageIntentVersion ?? 0,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const submit = form.handleSubmit(async (content) => {
    if (!source || waitingForRefresh) return;
    if (!canCreateRevision(source, dirty)) return;
    if (hashtagDraft.trim() !== "") {
      form.setFocus("hashtags");
      return;
    }
    await executeRevision({
      commandKind: "submit_content",
      platformDraftId: card.id,
      content,
      expectedActive,
      idempotencyKey: crypto.randomUUID(),
      source: { kind: source.kind, id: source.id },
    });
  });

  const confirmSelection = async () => {
    if (!selection) return;
    const selected = await applySelection(selection);
    return selected ? undefined : { error: t("cardSheet.error.unknown") };
  };

  const changeSelectionOpen = (open: boolean) => {
    if (!open) setSelection(null);
  };

  return {
    active,
    adoptImage,
    busy,
    changeSelectionOpen,
    confirmSelection,
    effectsBlocked,
    isSubmitting,
    removeImage,
    requestSelection,
    resolveError,
    selectionOpen: selection !== null,
    savedChangeBlocked,
    submit,
    switchingRevision,
    waitingForRefresh,
  };
}

function CardSheetBody(props: CardSheetBodyProps) {
  const {
    card,
    dirty,
    form,
    generationBlocked,
    hashtagDraft,
    imageModels,
    onHashtagDraftChange,
    onPendingChange,
    source,
  } = props;
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [generationPending, setGenerationPending] = useState(false);
  const generating =
    generationPending || isCopyGenerationNonterminal(card.generation);
  const {
    active,
    adoptImage,
    busy,
    changeSelectionOpen,
    confirmSelection,
    effectsBlocked,
    isSubmitting,
    removeImage,
    requestSelection,
    resolveError,
    selectionOpen,
    savedChangeBlocked,
    submit,
    switchingRevision,
    waitingForRefresh,
  } = useRevisionCommands(props);

  useEffect(() => {
    if (source?.kind !== "draft_revision") return;
    document.getElementById(`revision-history-${source.id}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
  }, [source]);

  const rootError = form.formState.errors.root?.server?.message;
  return (
    <>
      <span aria-live="polite" className="sr-only">
        {switchingRevision ? t("cardSheet.switch.pending") : ""}
      </span>
      <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(16rem,0.38fr)_minmax(0,0.62fr)] min-[900px]:items-stretch [&_button]:max-[599px]:min-h-11">
        <aside className="flex min-w-0 flex-col gap-4 min-[900px]:min-h-0">
          <CopyControls
            card={card}
            disabled={busy}
            form={form}
            generationBlocked={generationBlocked}
            onGenerationPendingChange={setGenerationPending}
            onPendingChange={onPendingChange}
          />
          <CandidateHistory
            card={card}
            disabled={busy}
            generating={generating}
            onSelectCandidate={(candidate) =>
              requestSelection(candidateEditSource(candidate))
            }
            onSelectRevision={(revision) =>
              requestSelection(revisionEditSource(revision))
            }
            selectedSource={source}
          />
        </aside>
        <div className="min-w-0 min-[900px]:h-full">
          <RevisionEditor
            dirty={dirty}
            form={form}
            hashtagDraft={hashtagDraft}
            isSubmitting={isSubmitting}
            nextRevisionNumber={card.nextRevisionNumber}
            onEditorChange={props.onEditorChange}
            onHashtagDraftChange={onHashtagDraftChange}
            platform={card.platform}
            onSubmit={submit}
            resolveError={resolveError}
            rootError={rootError}
            source={source}
            sourceLoading={generating && source === null}
            stale={waitingForRefresh}
            updatePending={busy}
          />
        </div>
      </div>
      <BackgroundGradient containerClassName="w-full" className="ring-0">
        <Collapsible className="rounded-xl bg-card">
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
              className={`${active?.imageProvenanceMismatch ? "" : "ms-auto"} transition-transform group-data-panel-open:rotate-180`}
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent
            className="px-4 pb-4 data-closed:hidden"
            keepMounted
          >
            <ImageControls
              active={active}
              card={card}
              editorDirty={effectsBlocked}
              imageModels={imageModels}
              key={active?.id ?? "no-active-revision"}
              onAdopt={adoptImage}
              onPendingChange={onPendingChange}
              onRemove={removeImage}
              resolveError={resolveError}
              revisionPending={busy}
            />
          </CollapsibleContent>
        </Collapsible>
      </BackgroundGradient>
      <PublishingTicket
        card={card}
        disabled={busy}
        effectDisabled={
          effectsBlocked || Boolean(active?.hasNonterminalImageGeneration)
        }
        key={active?.id ?? "no-active-revision"}
        onPendingChange={onPendingChange}
        savedChangeDisabled={savedChangeBlocked}
      />
      <ConfirmDialog
        cancelLabel={t("cardSheet.discard.cancel")}
        confirmLabel={t("cardSheet.switch.confirm")}
        description={t("cardSheet.discard.description")}
        fallbackError={t("cardSheet.error.unknown")}
        onConfirm={confirmSelection}
        onOpenChange={changeSelectionOpen}
        open={selectionOpen}
        pendingLabel={t("cardSheet.switch.pending")}
        title={t("cardSheet.switch.title")}
        variant="destructive"
      />
    </>
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
  card: PlatformDraftCard;
  editorDirty: boolean;
  active: Revision | null;
  imageModels: readonly { key: string; name: string }[];
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
  const nonterminal =
    operation?.lifecycle === "queued" ||
    operation?.lifecycle === "running" ||
    operation?.lifecycle === "settling";
  const pending = start.isPending || retry.isPending;
  const busy = pending || nonterminal;
  const referenceBusy =
    reference?.status === "uploading" || reference?.status === "verifying";
  const imageSourceReady = active?.imageSourceReadiness === "ready";
  const disabled =
    !imageSourceReady ||
    !modelOptionKey ||
    busy ||
    referenceBusy ||
    revisionPending ||
    editorDirty ||
    Boolean(active?.mediaLocked);
  const selectedFinalMediaAssetId = active?.selectedFinalMediaAssetId ?? null;

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
    if (settled.status === "error") {
      setCommandError(
        resolveError(settled.fieldErrors?.operatorDirection ?? settled.code),
      );
    }
  };

  return (
    <div aria-busy={busy || undefined} className="mt-1 grid gap-4">
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
      <LabeledSelect
        disabled={busy || revisionPending || editorDirty || active?.mediaLocked}
        id={`image-model-${card.id}`}
        label={t("cardSheet.imageModel")}
        onValueChange={(next) => {
          if (next) setModelOptionKey(next);
        }}
        options={imageModels.map((model) => ({
          label: model.name,
          value: model.key,
        }))}
        triggerClassName="w-full"
        value={modelOptionKey}
      />
      <Field>
        <FieldCaption htmlFor={`image-direction-${card.id}`}>
          {t("cardSheet.imageDirection")}
        </FieldCaption>
        <Textarea
          aria-describedby={
            commandError ? `image-direction-error-${card.id}` : undefined
          }
          aria-invalid={commandError ? true : undefined}
          disabled={
            busy || revisionPending || editorDirty || active?.mediaLocked
          }
          id={`image-direction-${card.id}`}
          maxLength={1_000}
          onChange={(event) => setOperatorDirection(event.currentTarget.value)}
          value={operatorDirection}
        />
        <FieldDescription>{t("cardSheet.imageDirectionHint")}</FieldDescription>
        {commandError ? (
          <p
            className="text-destructive text-xs"
            id={`image-direction-error-${card.id}`}
            role="alert"
          >
            {commandError}
          </p>
        ) : null}
      </Field>
      <ReferenceImageField
        cardId={card.id}
        clearDisabled={
          busy || revisionPending || editorDirty || Boolean(active?.mediaLocked)
        }
        disabled={
          busy ||
          referenceBusy ||
          revisionPending ||
          editorDirty ||
          Boolean(active?.mediaLocked)
        }
        onChange={setReference}
        reference={reference}
      />
      <OperatorFinalImageField
        adoptDisabled={
          busy || revisionPending || editorDirty || Boolean(active?.mediaLocked)
        }
        cardId={card.id}
        inputDisabled={
          !active ||
          busy ||
          revisionPending ||
          editorDirty ||
          Boolean(active?.mediaLocked)
        }
        onAdopt={onAdopt}
      />
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {operation
          ? t("cardSheet.imageStatus", {
              status: t(`platformDraft.lifecycle.${operation.lifecycle}`),
            })
          : t("cardSheet.imageStatusIdle")}
      </p>
      {operation?.lifecycle === "failed" && imageSourceReady ? (
        <p className="text-destructive text-sm">{t("cardSheet.imageFailed")}</p>
      ) : null}
      {selectedFinalMediaAssetId ? (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <Image
            alt={t("cardSheet.imageAlt", {
              brand: card.brandName,
              headline: active?.headline ?? card.originTitle,
            })}
            className="h-auto w-full rounded-lg border border-border"
            height={1350}
            sizes="(max-width: 639px) 100vw, 62vw"
            src={`/api/media/${selectedFinalMediaAssetId}`}
            unoptimized
            width={1080}
          />
          <Button
            nativeButton={false}
            render={
              <a
                aria-label={t("cardSheet.imageDownload")}
                download
                href={`/api/media/${selectedFinalMediaAssetId}?download=1`}
              />
            }
            variant="outline"
          >
            <DownloadIcon aria-hidden="true" />
            {t("cardSheet.imageDownload")}
          </Button>
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
              disabled={
                busy ||
                revisionPending ||
                editorDirty ||
                Boolean(active?.mediaLocked)
              }
              onClick={onRemove}
              type="button"
              variant="outline"
            >
              {t("cardSheet.imageRemove")}
            </Button>
          </div>
        </div>
      ) : null}
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

function SelectableItem({
  contentLocale,
  disabled,
  footerMeta,
  headerMeta,
  label,
  onSelect,
  preview,
  selected,
  statusMeta,
}: {
  contentLocale: ContentLocale;
  disabled: boolean;
  footerMeta?: string;
  headerMeta: string;
  label: string;
  onSelect: () => void;
  preview: string;
  selected: boolean;
  statusMeta?: string;
}) {
  return (
    <Button
      aria-pressed={selected}
      className="grid h-auto w-full justify-normal gap-1 whitespace-normal p-2 text-start data-selected:border-primary/40 data-selected:bg-accent data-selected:ring-1 data-selected:ring-primary/30 data-selected:forced-colors:border-[HighlightText] data-selected:forced-colors:bg-[Highlight] data-selected:forced-colors:text-[HighlightText] data-selected:forced-colors:[&_.text-muted-foreground]:text-[HighlightText]"
      data-selected={selected || undefined}
      disabled={disabled}
      onClick={onSelect}
      type="button"
      variant={selected ? "secondary" : "outline"}
    >
      <span className="flex w-full items-center gap-1">
        {selected ? (
          <CheckIcon aria-hidden="true" className="size-3.5" />
        ) : null}
        <strong className="min-w-0 flex-1 truncate">{label}</strong>
        {statusMeta ? (
          <span className="ticket-label shrink-0 text-primary">
            {statusMeta}
          </span>
        ) : null}
        <span className="shrink-0 font-normal text-muted-foreground">
          {headerMeta}
        </span>
      </span>
      <span
        className="line-clamp-2 w-full font-normal text-muted-foreground"
        lang={contentLocale}
      >
        <Bdi>{preview}</Bdi>
      </span>
      {footerMeta ? (
        <span className="ticket-label w-full text-muted-foreground">
          {footerMeta}
        </span>
      ) : null}
    </Button>
  );
}

function CandidateHistory({
  card,
  disabled,
  generating,
  onSelectCandidate,
  onSelectRevision,
  selectedSource,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  generating: boolean;
  onSelectCandidate: (
    candidate: PlatformDraftCard["candidates"][number],
  ) => void;
  onSelectRevision: (revision: Revision) => void;
  selectedSource: EditSource | null;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const at = (value: Date) =>
    format.dateTime(value, { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="grid min-h-0 flex-1 content-start gap-4 min-[900px]:grid-rows-[minmax(0,1fr)_auto]">
      <section
        aria-busy={generating || undefined}
        aria-labelledby={`candidates-${card.id}`}
        className="rounded-xl border border-primary/20 bg-linear-to-br from-accent/50 via-card to-card p-3 min-[900px]:flex min-[900px]:min-h-0 min-[900px]:flex-col"
      >
        <h3 className="font-medium text-sm" id={`candidates-${card.id}`}>
          {t("cardSheet.candidates")}
        </h3>
        {generating ? (
          <div
            aria-live="polite"
            className="mt-2 grid min-h-0 gap-2 overflow-hidden min-[900px]:flex-1"
            role="status"
          >
            <span className="sr-only">{t("cardSheet.generatingStyles")}</span>
            {[0, 1, 2].map((row) => (
              <SelectableItemSkeleton key={row} />
            ))}
          </div>
        ) : card.candidates.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            {t("cardSheet.candidatesEmpty")}
          </p>
        ) : (
          <div className="scrollbar-none mt-2 max-h-72 overflow-y-auto overscroll-contain p-px min-[900px]:max-h-none min-[900px]:min-h-0 min-[900px]:flex-1">
            <ul className="grid gap-2">
              {card.candidates.map((candidate) => (
                <li key={candidate.id}>
                  <SelectableItem
                    contentLocale={candidate.contentLocale}
                    disabled={disabled}
                    headerMeta={t("cardSheet.candidateMeta", {
                      locale: candidate.contentLocale,
                      model: candidate.modelOptionKey,
                    })}
                    label={
                      candidate.variantKey === "to_the_point"
                        ? t("cardSheet.variant.toThePoint")
                        : candidate.variantKey
                    }
                    onSelect={() => onSelectCandidate(candidate)}
                    preview={candidate.headline}
                    selected={
                      selectedSource?.kind === "copy_variant" &&
                      selectedSource.id === candidate.id
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <Collapsible
        className="rounded-xl border border-border bg-card"
        defaultOpen
        key={card.id}
      >
        <CollapsibleTrigger
          render={
            <Button
              className="group w-full justify-start px-3"
              variant="ghost"
            />
          }
        >
          <HistoryIcon aria-hidden="true" />
          {t("cardSheet.revisions")}
          <ChevronDownIcon
            className="ms-auto transition-transform group-data-panel-open:rotate-180"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="p-3 pt-1 data-closed:hidden" keepMounted>
          <div>
            {card.revisions.length === 0 ? (
              <p className="text-muted-foreground">
                {t("cardSheet.historyEmpty")}
              </p>
            ) : (
              <div className="scrollbar-none max-h-64 overflow-y-auto overscroll-contain p-px">
                <ol className="grid gap-2">
                  {card.revisions.map((revision) => (
                    <li
                      id={`revision-history-${revision.id}`}
                      key={revision.id}
                    >
                      <SelectableItem
                        contentLocale={revision.contentLocale}
                        disabled={disabled}
                        label={t("cardSheet.revision", {
                          n: revision.revisionNumber,
                        })}
                        footerMeta={at(revision.createdAt)}
                        headerMeta={t("cardSheet.revisionMeta", {
                          author: revision.authorName,
                          locale: revision.contentLocale,
                        })}
                        onSelect={() => onSelectRevision(revision)}
                        preview={revision.headline}
                        selected={
                          selectedSource?.kind === "draft_revision" &&
                          selectedSource.id === revision.id
                        }
                      />
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const HASHTAG_SEPARATOR = /[\s,\u060C#]+/u;

function hashtagKey(hashtag: string) {
  return hashtag.toLocaleLowerCase("und");
}

function hashtagEntries(raw: string) {
  return raw
    .split(HASHTAG_SEPARATOR)
    .map((entry) => entry.replace(/^#+/u, ""))
    .filter((entry) => entry !== "")
    .map((entry) => `#${entry}`);
}

function HashtagField({
  draft,
  form,
  onDraftChange,
  resolveError,
}: {
  draft: string;
  form: UseFormReturn<DraftEditorInput>;
  onDraftChange: (value: string) => void;
  resolveError: (code: string | undefined) => string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormField
      control={form.control}
      description={t("cardSheet.editor.hashtagHint")}
      name="hashtags"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, descriptionNode, field }) => {
        const hashtags = field.value;
        const change = (next: string[]) => {
          field.onChange(next);
        };
        const commitDraft = () => {
          const seen = new Set(hashtags.map(hashtagKey));
          const added: string[] = [];
          for (const entry of hashtagEntries(draft)) {
            const key = hashtagKey(entry);
            if (seen.has(key)) continue;
            seen.add(key);
            added.push(entry);
          }
          onDraftChange("");
          if (added.length > 0) change([...hashtags, ...added]);
        };

        return (
          <>
            <FieldCaption htmlFor={controlId}>
              {t("cardSheet.editor.hashtags")}
            </FieldCaption>
            <InputGroup className="w-full">
              <InputGroupInput
                {...controlProps}
                onBlur={field.onBlur}
                placeholder={t("cardSheet.editor.hashtagPlaceholder")}
                onChange={(event) => onDraftChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    commitDraft();
                    return;
                  }
                  if (
                    event.key !== "Backspace" ||
                    draft !== "" ||
                    hashtags.length <= 1
                  ) {
                    return;
                  }
                  event.preventDefault();
                  change(hashtags.slice(0, -1));
                }}
                ref={field.ref}
                value={draft}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  disabled={draft.trim() === ""}
                  onClick={commitDraft}
                >
                  {t("cardSheet.editor.hashtagAdd")}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <ul className="flex flex-wrap items-start gap-1">
              {hashtags.map((hashtag, index) => (
                <li key={hashtag}>
                  <Badge
                    className="h-auto min-h-6 gap-1 overflow-visible py-0 ps-2 pe-0.5 data-locked:pe-2"
                    data-locked={index === 0 || undefined}
                    variant="secondary"
                  >
                    <Bdi className="max-w-48 truncate">{hashtag}</Bdi>
                    {index === 0 ? null : (
                      <Button
                        aria-label={t("cardSheet.editor.hashtagRemove", {
                          hashtag,
                        })}
                        className="size-5"
                        onClick={() =>
                          change(hashtags.filter((entry) => entry !== hashtag))
                        }
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <XIcon />
                      </Button>
                    )}
                  </Badge>
                </li>
              ))}
            </ul>
            {descriptionNode}
          </>
        );
      }}
    </FormField>
  );
}

function RevisionEditor({
  dirty,
  form,
  hashtagDraft,
  isSubmitting,
  nextRevisionNumber,
  onEditorChange,
  onHashtagDraftChange,
  onSubmit,
  platform,
  resolveError,
  rootError,
  source,
  sourceLoading,
  stale,
  updatePending,
}: {
  form: UseFormReturn<DraftEditorInput>;
  dirty: boolean;
  hashtagDraft: string;
  isSubmitting: boolean;
  nextRevisionNumber: number;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  platform: Platform;
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>;
  resolveError: (code: string | undefined) => string;
  rootError: string | undefined;
  source: EditSource | null;
  sourceLoading: boolean;
  stale: boolean;
  updatePending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [contentLocale, headline, body, hashtags] = useWatch({
    control: form.control,
    name: ["contentLocale", "headline", "body", "hashtags"],
  });
  const used = platformCopyLength(
    platform,
    assembleCopy(platform, {
      headline: headline.trim(),
      body: body.trim(),
      hashtags,
    }),
  );
  const limit = PLATFORM_COPY_HARD_MAX[platform];
  const inlineHashtag =
    headline.match(INLINE_HASHTAG_TOKEN) !== null ||
    body.match(INLINE_HASHTAG_TOKEN) !== null;
  const localeMismatch = contentLocale !== source?.content.contentLocale;
  const blocked = used > limit || inlineHashtag || localeMismatch;

  return (
    <>
      {source ? (
        <form
          aria-busy={updatePending}
          className="grid gap-4 rounded-xl border border-border bg-card p-4 min-[900px]:h-full"
          onChange={onEditorChange}
          onSubmit={onSubmit}
        >
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-base">
                {t("cardSheet.editor.workspace")}
              </h3>
              <p className="mt-1 text-muted-foreground text-xs">
                {source.kind === "copy_variant"
                  ? t("cardSheet.editor.fromVariation")
                  : t("cardSheet.editor.fromRevision", {
                      n: source.revisionNumber ?? 0,
                    })}
              </p>
            </div>
            <Badge variant={dirty ? "secondary" : "outline"}>
              {dirty
                ? t("cardSheet.editor.edited")
                : t("cardSheet.editor.sourceReady")}
            </Badge>
          </header>
          <fieldset disabled={updatePending}>
            <FieldGroup className="gap-3">
              <FormInputField
                control={form.control}
                dir={DIRECTION[contentLocale]}
                lang={contentLocale}
                label={t("cardSheet.editor.headline")}
                name="headline"
                resolveError={resolveError}
              />
              <FormTextareaField
                control={form.control}
                dir={DIRECTION[contentLocale]}
                lang={contentLocale}
                label={t("cardSheet.editor.body")}
                name="body"
                resolveError={resolveError}
                rows={12}
              />
              <HashtagField
                draft={hashtagDraft}
                form={form}
                onDraftChange={onHashtagDraftChange}
                resolveError={resolveError}
              />
              <FormSelectField
                control={form.control}
                label={t("cardSheet.editor.locale")}
                name="contentLocale"
                onValueChange={() => onEditorChange()}
                options={[
                  { label: t("route.localeEn"), value: "en" },
                  { label: t("route.localeFa"), value: "fa" },
                ]}
                resolveError={resolveError}
              />
              {localeMismatch ? (
                <p className="text-muted-foreground text-xs">
                  {t("cardSheet.editor.localeRegenerate")}
                </p>
              ) : null}
              <p
                className={
                  used > limit
                    ? "text-destructive text-xs"
                    : "text-muted-foreground text-xs"
                }
              >
                {t("cardSheet.editor.copyBudget", {
                  limit,
                  platform: t(`run.platform.${platform}`),
                  used,
                })}
              </p>
              {inlineHashtag ? (
                <p className="text-destructive text-xs">
                  {t("cardSheet.editor.inlineHashtag")}
                </p>
              ) : null}
              {stale ? (
                <p className="text-muted-foreground text-xs">
                  {t("cardSheet.stale.blocked")}
                </p>
              ) : null}
              <FormRootError
                message={rootError ? resolveError(rootError) : undefined}
              />
              <Button
                aria-busy={isSubmitting || updatePending}
                disabled={
                  isSubmitting ||
                  updatePending ||
                  blocked ||
                  stale ||
                  hashtagDraft.trim() !== "" ||
                  !canCreateRevision(source, dirty)
                }
                type="submit"
              >
                {isSubmitting || updatePending ? (
                  <Spinner
                    data-icon="inline-start"
                    label={t("cardSheet.saving")}
                  />
                ) : null}
                {t("cardSheet.createRevision", { n: nextRevisionNumber })}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      ) : sourceLoading ? (
        <div aria-live="polite" className="h-full" role="status">
          <span className="sr-only">{t("cardSheet.generatingStyles")}</span>
          <RevisionWorkspaceSkeleton />
        </div>
      ) : (
        <Field className="rounded-xl border border-border bg-card p-5">
          <p className="text-muted-foreground">
            {t("cardSheet.editor.noSource")}
          </p>
          <FormRootError
            message={rootError ? resolveError(rootError) : undefined}
          />
        </Field>
      )}
    </>
  );
}

function CopyControls({
  card,
  disabled,
  form,
  generationBlocked,
  onGenerationPendingChange,
  onPendingChange,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  form: UseFormReturn<DraftEditorInput>;
  generationBlocked: boolean;
  onGenerationPendingChange: (pending: boolean) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const onSettled = () => {
    onGenerationPendingChange(false);
    onPendingChange(false);
  };
  const regenerate = useAction(regenerateCopyAction, { onSettled });
  const refreshArticle = useAction(refreshArticleAndRegenerateAction, {
    onSettled,
  });
  const retry = useAction(retryCopyGenerationAction, { onSettled });
  const pending =
    regenerate.isPending || refreshArticle.isPending || retry.isPending;
  const nonterminal = isCopyGenerationNonterminal(card.generation);
  const failedUnits =
    card.generation?.units.filter((unit) => unit.status === "failed").length ??
    0;

  const run = async (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => {
    if (disabled || generationBlocked || pending || nonterminal) return;
    form.clearErrors("root");
    const common = {
      platformDraftId: card.id,
      idempotencyKey: crypto.randomUUID(),
    };
    const requestedContentLocale = form.getValues("contentLocale");
    const modelOptionKey = card.generation?.modelOptionKey ?? "";
    onGenerationPendingChange(true);
    onPendingChange(true);
    const settled =
      kind === "retry_failed"
        ? await retry.execute({ kind, ...common })
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
      <div className="grid gap-2">
        <Button
          aria-describedby={
            generationBlocked ? `copy-actions-dirty-${card.id}` : undefined
          }
          className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
          disabled={
            disabled ||
            generationBlocked ||
            pending ||
            nonterminal ||
            !card.generation
          }
          onClick={() => run("regenerate")}
          type="button"
          variant="outline"
        >
          <RotateCcwIcon aria-hidden="true" />
          {t("cardSheet.regenerate")}
        </Button>
        {card.sourceKind === "rss" ? (
          <Button
            aria-describedby={
              generationBlocked ? `copy-actions-dirty-${card.id}` : undefined
            }
            className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
            disabled={
              disabled ||
              generationBlocked ||
              pending ||
              nonterminal ||
              !card.generation
            }
            onClick={() => run("refresh_article")}
            type="button"
            variant="outline"
          >
            <RefreshCwIcon aria-hidden="true" />
            {t("cardSheet.refreshArticle")}
          </Button>
        ) : null}
        {failedUnits > 0 ? (
          <Button
            aria-describedby={
              generationBlocked ? `copy-actions-dirty-${card.id}` : undefined
            }
            className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
            disabled={disabled || generationBlocked || pending || nonterminal}
            onClick={() => run("retry_failed")}
            type="button"
            variant="outline"
          >
            <RotateCcwIcon aria-hidden="true" />
            {t("cardSheet.retryFailed", { n: failedUnits })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
