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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import {
  NextIntlClientProvider,
  useFormatter,
  useLocale,
  useTranslations,
} from "next-intl";
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
import publishingEn from "@/features/publishing/messages/en.json";
import publishingFa from "@/features/publishing/messages/fa.json";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { client } from "@/lib/orpc";

import { refreshArticleAndRegenerateAction } from "../actions/refresh-article-and-regenerate";
import { refreshEditorialReadsAction } from "../actions/refresh-editorial-reads";
import { regenerateCopyAction } from "../actions/regenerate-copy";
import { retryCopyGenerationAction } from "../actions/retry-copy-generation";
import { retryImageGenerationAction } from "../actions/retry-image-generation";
import { startImageGenerationAction } from "../actions/start-image-generation";
import { updateDraftRevisionAction } from "../actions/update-draft-revision";
import { EDITORIAL_NAMESPACE } from "../constants";
import {
  acceptRevisionCard,
  type EditBaseline,
  revisionEditorState,
  revisionValues,
} from "../lib/revision-editor-state";
import {
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftCard,
  type UpdateDraftRevisionInput,
} from "../schemas/drafts";
import { EditorialFreshness } from "./editorial-freshness";
import { ExpandablePreview } from "./expandable-preview";

export function CardSheet({
  card: incomingCard,
  finalFocus,
  freshness,
  loading = false,
  onOpenChange,
  open,
}: {
  card: PlatformDraftCard | null;
  finalFocus: HTMLElement | null;
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
  const [narrow, setNarrow] = useState(false);
  const [pending, setPending] = useState(false);
  const [sourceCard, setSourceCard] = useState(incomingCard);
  const [editor, setEditor] = useState(() => revisionEditorState(incomingCard));
  const loadedVersion = useRef(-1);
  const { card, baseline, hashtagDraft } = editor;
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
  const dirty =
    hashtagDraft.trim() !== "" ||
    (baseline !== null &&
      EDITOR_FIELDS.some(
        (field) => !sameField(baseline.content, values, field),
      ));

  if (sourceCard !== incomingCard) {
    setSourceCard(incomingCard);
    setEditor((current) => acceptRevisionCard(current, incomingCard, dirty));
  }

  const publishSheetCard = assistant?.publishSheetCard;
  const publishLiveCard = () => {
    if (!publishSheetCard) return;
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
    if (!publishSheetCard) return;
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

  const setHashtagDraft = (value: string) => {
    setEditor((current) => ({ ...current, hashtagDraft: value }));
  };

  const acceptCard = (next: PlatformDraftCard) => {
    setEditor((current) => acceptRevisionCard(current, next, false));
  };

  const resetEditor = (revisionVersion: number, merged?: DraftEditorInput) => {
    setEditor((current) => {
      if (current.card?.revisionVersion !== revisionVersion) return current;
      const next = acceptRevisionCard(current, current.card, false);
      return merged
        ? { ...next, editorValues: merged, hashtagDraft: current.hashtagDraft }
        : next;
    });
  };

  useEffect(() => {
    const query = window.matchMedia("(max-width: 599px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const requestOpenChange = (next: boolean) => {
    if (pending) return;
    if (!next && dirty) {
      setConfirmDiscard(true);
      return;
    }
    if (!next) publishSheetCard?.(null);
    onOpenChange(next);
  };

  return (
    <>
      <Sheet
        disablePointerDismissal
        modal={false}
        onOpenChange={requestOpenChange}
        open={open}
      >
        <SheetContent
          aria-busy={loading || undefined}
          className="w-full gap-5 max-[599px]:rounded-t-xl sm:w-[min(960px,100vw)] sm:p-5"
          closeLabel={t("cardSheet.close")}
          finalFocus={() =>
            finalFocus?.isConnected
              ? finalFocus
              : document.getElementById("main-content")
          }
          side={narrow ? "block-end" : "inline-end"}
        >
          <SheetHeader className="border-border border-b pe-12 pb-4">
            <SheetTitle>{t("cardSheet.title")}</SheetTitle>
            {assistant && card ? (
              <Button
                className="justify-self-start"
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
                type="button"
                variant="outline"
              >
                {assistant.askAboutCardLabel}
              </Button>
            ) : null}
            <SheetDescription aria-live="polite">
              {loading
                ? t("cardSheet.loading")
                : card
                  ? t("cardSheet.description", {
                      brand: card.brandName,
                      platform: t(`run.platform.${card.platform}`),
                    })
                  : t("cardSheet.unavailable.description")}
            </SheetDescription>
          </SheetHeader>
          {freshness ? <EditorialFreshness {...freshness} /> : null}
          {loading ? (
            <Skeleton aria-hidden="true" className="h-48 w-full" />
          ) : card ? (
            <>
              <OriginFacts card={card} />
              <CardSheetBody
                baseline={baseline}
                card={card}
                dirty={dirty}
                form={form}
                hashtagDraft={hashtagDraft}
                onAcceptCard={acceptCard}
                onEditorChange={publishLiveCard}
                onHashtagDraftChange={setHashtagDraft}
                onPendingChange={setPending}
                onResetEditor={resetEditor}
                pending={pending}
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
                  publishSheetCard?.(null);
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
          publishSheetCard?.(null);
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

type RebaseState = {
  conflicts: EditorField[];
  choices: Partial<Record<EditorField, "mine" | "theirs">>;
  mine: DraftEditorInput;
  theirs: DraftEditorInput;
  base: DraftEditorInput;
  revisionNumber: number;
  revisionVersion: number;
};

const EDITOR_FIELDS = [
  "contentLocale",
  "headline",
  "body",
  "hashtags",
] as const;

type EditorField = (typeof EDITOR_FIELDS)[number];

const CARD_SHEET_ERROR_KEYS = {
  DRAFT_BODY_REQUIRED: "cardSheet.error.body",
  DRAFT_HASHTAG_REQUIRED: "cardSheet.error.hashtags",
  DRAFT_HASHTAGS_REQUIRED: "cardSheet.error.hashtags",
  DRAFT_HEADLINE_REQUIRED: "cardSheet.error.headline",
  MEDIA_CONTENT_MISMATCH: "cardSheet.error.mediaContentMismatch",
  MEDIA_INVALID: "cardSheet.error.mediaInvalid",
  OPERATION_IN_PROGRESS: "cardSheet.error.operationInProgress",
  OPERATOR_DIRECTION_INVALID: "cardSheet.error.imageDirection",
  REFERENCE_CONFLICT: "cardSheet.error.referenceConflict",
  IMAGE_SOURCE_EXTRACT_REQUIRED: "cardSheet.error.imageSourceExtractRequired",
  TEMPLATE_DRIFT: "cardSheet.error.templateDrift",
  VALIDATION_FAILED: "cardSheet.error.validation",
  VERSION_CONFLICT: "cardSheet.error.conflict",
} as const;

function isCardSheetErrorCode(
  value: string,
): value is keyof typeof CARD_SHEET_ERROR_KEYS {
  return value in CARD_SHEET_ERROR_KEYS;
}

function sameField(
  left: DraftEditorInput,
  right: DraftEditorInput,
  field: EditorField,
) {
  return field === "hashtags"
    ? left.hashtags.length === right.hashtags.length &&
        left.hashtags.every((value, index) => value === right.hashtags[index])
    : left[field] === right[field];
}

function withField(
  values: DraftEditorInput,
  source: DraftEditorInput,
  field: EditorField,
): DraftEditorInput {
  return field === "hashtags"
    ? { ...values, hashtags: [...source.hashtags] }
    : { ...values, [field]: source[field] };
}

function mergeRebase(state: RebaseState) {
  let merged = state.theirs;
  for (const field of EDITOR_FIELDS) {
    if (sameField(state.base, state.mine, field)) continue;
    if (state.conflicts.includes(field) && state.choices[field] !== "mine") {
      continue;
    }
    merged = withField(merged, state.mine, field);
  }
  return merged;
}

function OriginFacts({ card }: { card: PlatformDraftCard }) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const facts = card.originDetails;

  return (
    <section
      aria-labelledby={`draft-origin-${card.id}`}
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3 className="ticket-label" id={`draft-origin-${card.id}`}>
          {t("cardSheet.origin.title")}
        </h3>
        <span className="text-muted-foreground text-xs">
          {t("cardSheet.origin.platform", {
            platform: t(`run.platform.${card.platform}`),
          })}
        </span>
      </div>
      <dl className="@container grid gap-3 text-xs">
        {facts?.sourceName ? (
          <OriginFact label={t("detail.source")}>
            <Bdi>{facts.sourceName}</Bdi>
          </OriginFact>
        ) : null}
        {facts?.publishedAt ? (
          <OriginFact label={t("detail.publishedAt")}>
            {format.dateTime(facts.publishedAt, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </OriginFact>
        ) : null}
        {facts?.contentLocale ? (
          <OriginFact label={t("detail.contentLocale")}>
            <span className="font-mono">{facts.contentLocale}</span>
          </OriginFact>
        ) : null}
        {facts?.suggestedPlatform ? (
          <OriginFact label={t("detail.platform")}>
            {t(`run.platform.${facts.suggestedPlatform}`)}
          </OriginFact>
        ) : null}
        {facts?.suitabilityScore !== null &&
        facts?.suitabilityScore !== undefined ? (
          <OriginFact label={t("selection.suitability")}>
            <span className="tabular-nums">
              {format.number(facts.suitabilityScore)}
            </span>
          </OriginFact>
        ) : null}
        {facts?.telegramReason ? (
          <OriginFact label={t("detail.reason")}>
            {t(`reason.${facts.telegramReason}`)}
          </OriginFact>
        ) : null}
        {facts?.canonicalUrl ? (
          <OriginFact label={t("detail.link")}>
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
          </OriginFact>
        ) : null}
        {facts?.summary ? (
          <OriginFact label={t("detail.summary")}>
            <ExpandablePreview>{facts.summary}</ExpandablePreview>
          </OriginFact>
        ) : null}
        {facts?.reasoning ? (
          <OriginFact label={t("detail.reasoning")}>
            <Bdi className="block text-start" dir="auto">
              {facts.reasoning}
            </Bdi>
          </OriginFact>
        ) : null}
        {facts?.promoAngle ? (
          <OriginFact label={t("promo.angle")}>
            <Bdi className="block text-start" dir="auto">
              {facts.promoAngle}
            </Bdi>
          </OriginFact>
        ) : null}
      </dl>
    </section>
  );
}

function OriginFact({
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

type RevisionSelection =
  | { kind: "candidate"; id: string }
  | { kind: "revision"; id: string };

type CardSheetBodyProps = {
  baseline: EditBaseline | null;
  card: PlatformDraftCard;
  dirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  onAcceptCard: (card: PlatformDraftCard) => void;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  onPendingChange: (pending: boolean) => void;
  onResetEditor: (revisionVersion: number, merged?: DraftEditorInput) => void;
  pending: boolean;
};

function useRevisionCommands({
  baseline,
  card,
  dirty,
  form,
  hashtagDraft,
  onAcceptCard,
  onPendingChange,
  onResetEditor,
  pending,
}: CardSheetBodyProps) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [selection, setSelection] = useState<RevisionSelection | null>(null);
  const [serverConflict, setServerConflict] = useState<number | null>(null);
  const [rebase, setRebase] = useState<RebaseState | null>(null);
  const updateRevision = useAction(updateDraftRevisionAction, {
    onSuccess: (data) => {
      onAcceptCard(data.card);
      setServerConflict(null);
      setRebase(null);
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
  const stale =
    waitingForRefresh ||
    (baseline !== null && baseline.revisionVersion !== card.revisionVersion);
  const currentRebase =
    rebase?.revisionVersion === card.revisionVersion ? rebase : null;

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

  const applySelection = (next: RevisionSelection) => {
    const common = {
      platformDraftId: card.id,
      expectedActive,
      idempotencyKey: crypto.randomUUID(),
    };
    return executeRevision(
      next.kind === "candidate"
        ? {
            ...common,
            commandKind: "apply_copy_variant",
            copyVariantId: next.id,
          }
        : {
            ...common,
            commandKind: "select_revision",
            draftRevisionId: next.id,
          },
    );
  };

  const requestSelection = async (next: RevisionSelection) => {
    if (busy) return;
    if (next.kind === "revision" && next.id === card.activeRevisionId) return;
    if (dirty) {
      setSelection(next);
      return;
    }
    await applySelection(next);
  };

  const removeImage = async () => {
    if (dirty || stale) return;
    await executeRevision({
      commandKind: "remove_image",
      platformDraftId: card.id,
      expectedActive,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const adoptImage = async (finalMediaAssetId: string) => {
    if (dirty || stale) return;
    await executeRevision({
      commandKind: "adopt_image",
      platformDraftId: card.id,
      finalMediaAssetId,
      expectedActive,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const submit = form.handleSubmit(async (content) => {
    if (!active || stale || !baseline || !dirty) return;
    if (hashtagDraft.trim() !== "") {
      form.setFocus("hashtags");
      return;
    }
    await executeRevision({
      commandKind: "submit_content",
      platformDraftId: card.id,
      content,
      expectedActive: {
        id: baseline.id,
        version: baseline.revisionVersion,
      },
      idempotencyKey: crypto.randomUUID(),
    });
  });

  const reloadActive = () => {
    if (!active || waitingForRefresh || busy) return;
    form.clearErrors("root");
    onResetEditor(card.revisionVersion);
    setServerConflict(null);
    setRebase(null);
  };

  const applyRebase = (merged: DraftEditorInput) => {
    if (!active || waitingForRefresh || busy) return;
    form.clearErrors("root");
    onResetEditor(card.revisionVersion, merged);
    setServerConflict(null);
    setRebase(null);
  };

  const startRebase = () => {
    if (!active || !baseline || waitingForRefresh || busy) return;
    const base = baseline.content;
    const mine = form.getValues();
    const theirs = revisionValues(active);
    const conflicts = EDITOR_FIELDS.filter(
      (field) =>
        !sameField(base, mine, field) &&
        !sameField(base, theirs, field) &&
        !sameField(mine, theirs, field),
    );
    const state: RebaseState = {
      base,
      choices: {},
      conflicts,
      mine,
      revisionNumber: active.revisionNumber,
      revisionVersion: card.revisionVersion,
      theirs,
    };
    if (conflicts.length > 0) {
      setRebase(state);
      return;
    }
    applyRebase(mergeRebase(state));
  };

  const chooseRebase = (field: EditorField, choice: "mine" | "theirs") => {
    setRebase((current) =>
      current?.revisionVersion === card.revisionVersion
        ? { ...current, choices: { ...current.choices, [field]: choice } }
        : null,
    );
  };

  const confirmSelection = async () => {
    if (!selection) return;
    const applied = await applySelection(selection);
    return applied ? undefined : { error: t("cardSheet.error.unknown") };
  };

  const changeSelectionOpen = (open: boolean) => {
    if (!open) setSelection(null);
  };

  return {
    active,
    adoptImage,
    applyRebase,
    busy,
    changeSelectionOpen,
    chooseRebase,
    confirmSelection,
    currentRebase,
    isSubmitting,
    reloadActive,
    removeImage,
    requestSelection,
    resolveError,
    selectionOpen: selection !== null,
    stale,
    startRebase,
    submit,
    waitingForRefresh,
  };
}

function CardSheetBody(props: CardSheetBodyProps) {
  const {
    card,
    dirty,
    form,
    hashtagDraft,
    onHashtagDraftChange,
    onPendingChange,
  } = props;
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const locale = useLocale();
  const {
    active,
    adoptImage,
    applyRebase,
    busy,
    changeSelectionOpen,
    chooseRebase,
    confirmSelection,
    currentRebase,
    isSubmitting,
    reloadActive,
    removeImage,
    requestSelection,
    resolveError,
    selectionOpen,
    stale,
    startRebase,
    submit,
    waitingForRefresh,
  } = useRevisionCommands(props);
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    card.candidates[0]?.id ?? null,
  );
  const selectedCandidate =
    card.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    card.candidates[0] ??
    null;

  useEffect(() => {
    if (!card.activeRevisionId) return;
    document
      .getElementById(`revision-history-${card.activeRevisionId}`)
      ?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
  }, [card.activeRevisionId]);

  const rootError = form.formState.errors.root?.server?.message;
  return (
    <>
      <div className="grid items-start gap-5 min-[900px]:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] [&_button]:max-[599px]:min-h-11">
        <aside className="grid min-w-0 content-start gap-4">
          <CopyControls
            card={card}
            disabled={busy}
            form={form}
            onPendingChange={onPendingChange}
          />
          <CandidateHistory
            card={card}
            disabled={busy}
            onSelectCandidate={setSelectedCandidateId}
            onSelectRevision={(id) =>
              requestSelection({ kind: "revision", id })
            }
            selectedCandidateId={selectedCandidate?.id ?? null}
            selectedRevisionId={card.activeRevisionId}
          />
        </aside>
        <div className="grid min-w-0 content-start gap-4">
          <SelectedContentPreviews
            cardId={card.id}
            onApplyCandidate={async () => {
              if (selectedCandidate) {
                await requestSelection({
                  kind: "candidate",
                  id: selectedCandidate.id,
                });
              }
            }}
            pending={busy}
            selectedCandidate={selectedCandidate}
            selectedRevision={active}
          />
          {stale ? (
            <StaleBanner
              active={active}
              disabled={waitingForRefresh || busy}
              onApply={applyRebase}
              onChoose={chooseRebase}
              onDiscard={reloadActive}
              onRebase={startRebase}
              rebase={currentRebase}
            />
          ) : null}
          <RevisionEditor
            active={active}
            dirty={dirty}
            disabled={currentRebase !== null}
            form={form}
            hashtagDraft={hashtagDraft}
            isSubmitting={isSubmitting}
            onEditorChange={props.onEditorChange}
            onHashtagDraftChange={onHashtagDraftChange}
            platform={card.platform}
            onSubmit={submit}
            resolveError={resolveError}
            rootError={rootError}
            stale={stale}
            updatePending={busy}
          />
          <Collapsible className="rounded-xl border border-border bg-card">
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
              <ChevronDownIcon
                className="ms-auto transition-transform group-data-panel-open:rotate-180"
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
                editorDirty={dirty || stale}
                form={form}
                key={active?.id ?? "no-active-revision"}
                onAdopt={adoptImage}
                onPendingChange={onPendingChange}
                onRemove={removeImage}
                revisionPending={busy}
              />
            </CollapsibleContent>
          </Collapsible>
          <NextIntlClientProvider
            locale={locale}
            messages={locale === "fa" ? publishingFa : publishingEn}
          >
            <PublishingTicket
              card={card}
              disabled={busy}
              editorDirty={dirty || stale}
              key={active?.id ?? "no-active-revision"}
              onPendingChange={onPendingChange}
            />
          </NextIntlClientProvider>
        </div>
      </div>
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

function SelectedContentPreviews({
  cardId,
  onApplyCandidate,
  pending,
  selectedCandidate,
  selectedRevision,
}: {
  cardId: string;
  onApplyCandidate: () => Promise<void>;
  pending: boolean;
  selectedCandidate: PlatformDraftCard["candidates"][number] | null;
  selectedRevision: Revision | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <>
      <ContentPreview
        action={
          selectedCandidate
            ? { label: t("cardSheet.useVariant"), run: onApplyCandidate }
            : null
        }
        content={selectedCandidate}
        emptyLabel={t("cardSheet.previewEmpty")}
        heading={t("cardSheet.preview")}
        id={`copy-preview-${cardId}`}
        pending={pending}
      />
      {selectedRevision ? (
        <ContentPreview
          action={null}
          content={selectedRevision}
          emptyLabel={t("cardSheet.previewEmpty")}
          heading={t("cardSheet.revision", {
            n: selectedRevision.revisionNumber,
          })}
          id={`revision-preview-${cardId}`}
          pending={pending}
        />
      ) : null}
    </>
  );
}

function StaleBanner({
  active,
  disabled,
  onApply,
  onChoose,
  onDiscard,
  onRebase,
  rebase,
}: {
  active: Revision | null;
  disabled: boolean;
  onApply: (merged: DraftEditorInput) => void;
  onChoose: (field: EditorField, choice: "mine" | "theirs") => void;
  onDiscard: () => void;
  onRebase: () => void;
  rebase: RebaseState | null;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const resolved =
    rebase?.conflicts.every((field) => rebase.choices[field] !== undefined) ??
    false;

  return (
    <Alert className="gap-2 p-4" role="status" variant="working">
      <AlertTitle>{t("cardSheet.stale.title")}</AlertTitle>
      <AlertDescription>
        {active ? (
          <p>
            {t("cardSheet.stale.arrived", {
              author: active.authorName,
              n: active.revisionNumber,
              time: format.dateTime(active.createdAt, { timeStyle: "short" }),
            })}
          </p>
        ) : null}
        <p>{t("cardSheet.stale.description")}</p>
      </AlertDescription>
      {rebase === null ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            disabled={disabled}
            onClick={onRebase}
            type="button"
            variant="secondary"
          >
            {t("cardSheet.stale.rebase")}
          </Button>
          <Button
            disabled={disabled}
            onClick={onDiscard}
            type="button"
            variant="outline"
          >
            {t("cardSheet.stale.reload")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <p className="ticket-label">{t("cardSheet.rebase.title")}</p>
          {rebase.conflicts.map((field) => (
            <fieldset
              className="grid gap-2 rounded-lg border border-border bg-card p-3"
              key={field}
            >
              <legend className="ticket-label px-1">
                {t(
                  `cardSheet.editor.${field === "contentLocale" ? "locale" : field}`,
                )}
              </legend>
              <RebaseChoice
                label={t("cardSheet.rebase.mine")}
                onSelect={() => onChoose(field, "mine")}
                selected={rebase.choices[field] === "mine"}
                value={fieldPreview(rebase.mine, field)}
              />
              <RebaseChoice
                label={t("cardSheet.rebase.theirs", {
                  n: rebase.revisionNumber,
                })}
                onSelect={() => onChoose(field, "theirs")}
                selected={rebase.choices[field] === "theirs"}
                value={fieldPreview(rebase.theirs, field)}
              />
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled || !resolved}
              onClick={() => onApply(mergeRebase(rebase))}
              type="button"
            >
              {t("cardSheet.rebase.apply")}
            </Button>
            <Button
              disabled={disabled}
              onClick={onDiscard}
              type="button"
              variant="outline"
            >
              {t("cardSheet.stale.reload")}
            </Button>
          </div>
        </div>
      )}
    </Alert>
  );
}

function RebaseChoice({
  label,
  onSelect,
  selected,
  value,
}: {
  label: string;
  onSelect: () => void;
  selected: boolean;
  value: string;
}) {
  return (
    <Button
      aria-pressed={selected}
      className="grid h-auto w-full justify-normal gap-1 whitespace-normal p-2 text-start data-selected:border-primary/40 data-selected:bg-accent data-selected:ring-1 data-selected:ring-primary/30"
      data-selected={selected || undefined}
      onClick={onSelect}
      type="button"
      variant={selected ? "secondary" : "outline"}
    >
      <span className="flex w-full items-center gap-1">
        {selected ? (
          <CheckIcon aria-hidden="true" className="size-3.5" />
        ) : null}
        <strong className="min-w-0 flex-1">{label}</strong>
      </span>
      <span className="line-clamp-3 w-full font-normal text-muted-foreground">
        <Bdi>{value}</Bdi>
      </span>
    </Button>
  );
}

function fieldPreview(values: DraftEditorInput, field: EditorField) {
  return field === "hashtags" ? values.hashtags.join(" ") : values[field];
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

function ImageControls({
  active,
  card,
  editorDirty,
  form,
  onAdopt,
  onPendingChange,
  onRemove,
  revisionPending,
}: {
  card: PlatformDraftCard;
  editorDirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  active: Revision | null;
  onAdopt: (mediaAssetId: string) => Promise<void>;
  onPendingChange: (pending: boolean) => void;
  onRemove: () => Promise<void>;
  revisionPending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [modelOptionKey, setModelOptionKey] = useState(
    card.imageGeneration?.modelOptionKey ?? card.imageModels[0]?.key ?? "",
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
  const referenceBusy =
    reference?.status === "uploading" || reference?.status === "verifying";
  const imageSourceReady = active?.imageSourceReadiness === "ready";
  const disabled =
    !imageSourceReady ||
    !modelOptionKey ||
    nonterminal ||
    pending ||
    referenceBusy ||
    revisionPending ||
    editorDirty;
  const selectedFinalMediaAssetId = active?.selectedFinalMediaAssetId ?? null;
  const finalMediaAssetIds = [
    ...new Set(
      [selectedFinalMediaAssetId, operation?.finalMediaAssetId ?? null].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];

  const execute = async () => {
    if (!active || disabled) return;
    form.clearErrors("root");
    const common = {
      draftRevisionId: active.id,
      expectedRevisionVersion: card.revisionVersion,
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
      form.setError("root.server", {
        message: settled.fieldErrors?.operatorDirection ?? settled.code,
        type: "server",
      });
    }
  };

  return (
    <div className="mt-1 grid gap-4">
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
      <LabeledSelect
        disabled={nonterminal || pending || revisionPending || editorDirty}
        id={`image-model-${card.id}`}
        label={t("cardSheet.imageModel")}
        onValueChange={(next) => {
          if (next) setModelOptionKey(next);
        }}
        options={card.imageModels.map((model) => ({
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
          disabled={nonterminal || pending || revisionPending || editorDirty}
          id={`image-direction-${card.id}`}
          maxLength={1_000}
          onChange={(event) => setOperatorDirection(event.currentTarget.value)}
          value={operatorDirection}
        />
        <FieldDescription>{t("cardSheet.imageDirectionHint")}</FieldDescription>
      </Field>
      <ReferenceImageField
        cardId={card.id}
        clearDisabled={nonterminal || pending || revisionPending || editorDirty}
        disabled={
          nonterminal ||
          pending ||
          referenceBusy ||
          revisionPending ||
          editorDirty
        }
        onChange={setReference}
        reference={reference}
      />
      <OperatorFinalImageField
        adoptDisabled={revisionPending || editorDirty}
        cardId={card.id}
        inputDisabled={!active || revisionPending || editorDirty}
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
      {finalMediaAssetIds.map((final) => (
        <div
          className="grid gap-3 rounded-lg border border-border p-3"
          key={final}
        >
          <Image
            alt={t("cardSheet.imageAlt", {
              brand: card.brandName,
              headline: active?.headline ?? card.originTitle,
            })}
            className="h-auto w-full rounded-lg border border-border"
            height={1350}
            sizes="(max-width: 639px) 100vw, 62vw"
            src={`/api/media/${final}`}
            unoptimized
            width={1080}
          />
          <Button
            nativeButton={false}
            render={
              <a
                aria-label={t("cardSheet.imageDownload")}
                download
                href={`/api/media/${final}?download=1`}
              />
            }
            variant="outline"
          >
            <DownloadIcon aria-hidden="true" />
            {t("cardSheet.imageDownload")}
          </Button>
          <p className="text-muted-foreground text-sm">
            {selectedFinalMediaAssetId === final
              ? t("cardSheet.imageAttached")
              : t("cardSheet.imageNotAttached")}
          </p>
          {editorDirty ? (
            <p className="text-muted-foreground text-xs">
              {t("cardSheet.imageRemoveBlocked")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {selectedFinalMediaAssetId === final ? (
              <Button
                disabled={revisionPending || editorDirty}
                onClick={onRemove}
                type="button"
                variant="outline"
              >
                {t("cardSheet.imageRemove")}
              </Button>
            ) : (
              <Button
                disabled={!active || revisionPending || pending || editorDirty}
                onClick={() => onAdopt(final)}
                type="button"
                variant="secondary"
              >
                {t("cardSheet.imageUse")}
              </Button>
            )}
          </div>
        </div>
      ))}
      <Button disabled={disabled} onClick={execute} type="button">
        {nonterminal || pending ? (
          <Spinner
            data-icon="inline-start"
            label={t("cardSheet.imagePending")}
          />
        ) : null}
        {operation ? t("cardSheet.imageRetry") : t("cardSheet.imageGenerate")}
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
  const live = useRef(true);
  const run = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const busy =
    reference?.status === "uploading" || reference?.status === "verifying";

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const clear = () => {
    run.current += 1;
    onChange(null);
    if (input.current) input.current.value = "";
    input.current?.focus();
  };

  const select = async (file: File | undefined) => {
    run.current += 1;
    const selection = run.current;
    const current = () => live.current && run.current === selection;
    if (!file) {
      onChange(null);
      return;
    }
    onChange({
      fileName: file.name,
      mediaAssetId: null,
      status: "uploading",
    });
    const mediaAssetId = await uploadImage(file, REFERENCE_IMAGE_KIND).catch(
      () => null,
    );
    if (!current()) return;
    if (!mediaAssetId) {
      onChange({
        fileName: file.name,
        mediaAssetId: null,
        status: "failed",
      });
      return;
    }
    onChange({ fileName: file.name, mediaAssetId, status: "verifying" });
    for (let attempt = 0; attempt < REFERENCE_POLL_ATTEMPTS; attempt += 1) {
      const confirmed = await client.media
        .confirm({ mediaAssetId })
        .catch(() => null);
      if (!current()) return;
      if (!confirmed) {
        onChange({ fileName: file.name, mediaAssetId, status: "failed" });
        return;
      }
      if (confirmed.lifecycle === "verified") {
        onChange({ fileName: file.name, mediaAssetId, status: "verified" });
        return;
      }
      if (confirmed.lifecycle === "rejected") {
        onChange({ fileName: file.name, mediaAssetId, status: "rejected" });
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, REFERENCE_POLL_INTERVAL_MS),
      );
      if (!current()) return;
    }
    onChange({ fileName: file.name, mediaAssetId, status: "failed" });
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
  const live = useRef(true);
  const run = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const select = async (file: File | undefined) => {
    run.current += 1;
    const selection = run.current;
    const current = () => live.current && run.current === selection;
    if (!file) {
      setUpload(null);
      return;
    }
    setUpload({
      fileName: file.name,
      mediaAssetId: null,
      status: "uploading",
    });
    const mediaAssetId = await uploadImage(file, "image").catch(() => null);
    if (!current()) return;
    if (!mediaAssetId) {
      setUpload({
        fileName: file.name,
        mediaAssetId: null,
        status: "failed",
      });
      return;
    }
    setUpload({ fileName: file.name, mediaAssetId, status: "verifying" });
    for (let attempt = 0; attempt < REFERENCE_POLL_ATTEMPTS; attempt += 1) {
      const confirmed = await client.media
        .confirm({ mediaAssetId })
        .catch(() => null);
      if (!current()) return;
      if (!confirmed) {
        setUpload({ fileName: file.name, mediaAssetId, status: "failed" });
        return;
      }
      if (confirmed.lifecycle === "verified") {
        setUpload({ fileName: file.name, mediaAssetId, status: "verified" });
        return;
      }
      if (confirmed.lifecycle === "rejected") {
        setUpload({ fileName: file.name, mediaAssetId, status: "rejected" });
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, REFERENCE_POLL_INTERVAL_MS),
      );
      if (!current()) return;
    }
    setUpload({ fileName: file.name, mediaAssetId, status: "failed" });
  };

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
  label,
  meta,
  onSelect,
  preview,
  selected,
  time,
}: {
  contentLocale: ContentLocale;
  disabled: boolean;
  label: string;
  meta: string;
  onSelect: () => void;
  preview: string;
  selected: boolean;
  time: string;
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
        <span className="shrink-0 font-normal text-muted-foreground">
          {time}
        </span>
      </span>
      <span
        className="line-clamp-2 w-full font-normal text-muted-foreground"
        lang={contentLocale}
      >
        <Bdi>{preview}</Bdi>
      </span>
      <span className="ticket-label w-full text-muted-foreground">{meta}</span>
    </Button>
  );
}

function CandidateHistory({
  card,
  disabled,
  onSelectCandidate,
  onSelectRevision,
  selectedCandidateId,
  selectedRevisionId,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  onSelectCandidate: (candidateId: string) => void;
  onSelectRevision: (revisionId: string) => void;
  selectedCandidateId: string | null;
  selectedRevisionId: string | null;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const at = (value: Date) =>
    format.dateTime(value, { dateStyle: "short", timeStyle: "short" });

  return (
    <>
      <section
        aria-labelledby={`candidates-${card.id}`}
        className="rounded-xl border border-border bg-card p-3"
      >
        <h3 className="ticket-label" id={`candidates-${card.id}`}>
          {t("cardSheet.candidates")}
        </h3>
        {card.candidates.length === 0 ? (
          <p className="mt-2 text-muted-foreground">
            {t("cardSheet.candidatesEmpty")}
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {card.candidates.map((candidate) => (
              <li key={candidate.id}>
                <SelectableItem
                  contentLocale={candidate.contentLocale}
                  disabled={disabled}
                  label={candidate.variantKey}
                  meta={t("cardSheet.candidateMeta", {
                    locale: candidate.contentLocale,
                    model: candidate.modelOptionKey,
                  })}
                  onSelect={() => onSelectCandidate(candidate.id)}
                  preview={candidate.headline}
                  selected={selectedCandidateId === candidate.id}
                  time={at(candidate.createdAt)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <Collapsible className="rounded-xl border border-border bg-card">
        <CollapsibleTrigger
          render={
            <Button
              className="group w-full justify-start px-3"
              variant="ghost"
            />
          }
        >
          <HistoryIcon aria-hidden="true" />
          {t("cardSheet.more")}
          <ChevronDownIcon
            className="ms-auto transition-transform group-data-panel-open:rotate-180"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="p-3 pt-1 data-closed:hidden" keepMounted>
          <section aria-labelledby={`history-${card.id}`}>
            <h3 className="ticket-label" id={`history-${card.id}`}>
              {t("cardSheet.history")}
            </h3>
            {card.revisions.length === 0 ? (
              <p className="mt-2 text-muted-foreground">
                {t("cardSheet.historyEmpty")}
              </p>
            ) : (
              <ol className="mt-2 grid gap-2">
                {card.revisions.map((revision) => (
                  <li id={`revision-history-${revision.id}`} key={revision.id}>
                    <SelectableItem
                      contentLocale={revision.contentLocale}
                      disabled={disabled}
                      label={t("cardSheet.revision", {
                        n: revision.revisionNumber,
                      })}
                      meta={t("cardSheet.revisionMeta", {
                        author: revision.authorName,
                        locale: revision.contentLocale,
                      })}
                      onSelect={() => onSelectRevision(revision.id)}
                      preview={revision.headline}
                      selected={selectedRevisionId === revision.id}
                      time={at(revision.createdAt)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}

function ContentPreview({
  action,
  content,
  emptyLabel,
  heading,
  id,
  pending,
}: {
  action: { label: string; run: () => Promise<void> } | null;
  content: {
    contentLocale: "en" | "fa";
    headline: string;
    body: string;
    hashtags: readonly string[];
  } | null;
  emptyLabel: string;
  heading: string;
  id: string;
  pending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <section aria-labelledby={id}>
      <h3 className="ticket-label" id={id}>
        {heading}
      </h3>
      {content ? (
        <article
          className="mt-2 grid gap-3 rounded-xl border border-border bg-card p-4"
          dir={DIRECTION[content.contentLocale]}
          lang={content.contentLocale}
        >
          <strong className="wrap-anywhere text-sm/relaxed">
            {content.headline}
          </strong>
          <p className="wrap-anywhere whitespace-pre-wrap text-sm/relaxed">
            {content.body}
          </p>
          <HashtagChips hashtags={content.hashtags} />
          {action ? (
            <Button
              disabled={pending}
              onClick={action.run}
              type="button"
              variant="secondary"
            >
              {pending ? (
                <Spinner
                  data-icon="inline-start"
                  label={t("cardSheet.applying")}
                />
              ) : null}
              {action.label}
            </Button>
          ) : null}
        </article>
      ) : (
        <p className="mt-2 text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

function HashtagChips({ hashtags }: { hashtags: readonly string[] }) {
  return (
    <ul className="flex flex-wrap items-start gap-1">
      {hashtags.map((hashtag) => (
        <li key={hashtag}>
          <Badge className="h-6" variant="secondary">
            <Bdi className="max-w-48 truncate">{hashtag}</Bdi>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const HASHTAG_SEPARATOR = /[\s,\u060C]+/u;

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
      {({ controlId, controlProps, descriptionId, field }) => {
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
            <FieldDescription id={descriptionId}>
              {t("cardSheet.editor.hashtagHint")}
            </FieldDescription>
          </>
        );
      }}
    </FormField>
  );
}

function RevisionEditor({
  active,
  dirty,
  disabled,
  form,
  hashtagDraft,
  isSubmitting,
  onEditorChange,
  onHashtagDraftChange,
  onSubmit,
  platform,
  resolveError,
  rootError,
  stale,
  updatePending,
}: {
  form: UseFormReturn<DraftEditorInput>;
  dirty: boolean;
  disabled: boolean;
  hashtagDraft: string;
  isSubmitting: boolean;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  active: Revision | null;
  platform: Platform;
  onSubmit: NonNullable<ComponentProps<"form">["onSubmit"]>;
  resolveError: (code: string | undefined) => string;
  rootError: string | undefined;
  stale: boolean;
  updatePending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [contentLocale, headline, body, hashtags] = useWatch({
    control: form.control,
    name: ["contentLocale", "headline", "body", "hashtags"],
  });
  const localeChanged =
    active !== null && contentLocale !== active.contentLocale;
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
  const blocked = used > limit || inlineHashtag;

  return (
    <>
      {active ? (
        <form
          aria-busy={updatePending}
          className="grid gap-4 rounded-xl border border-border bg-card p-4"
          onChange={onEditorChange}
          onSubmit={onSubmit}
        >
          <fieldset disabled={updatePending || disabled}>
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
                rows={8}
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
              {localeChanged ? (
                <p className="text-muted-foreground">
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
                  localeChanged ||
                  blocked ||
                  stale ||
                  hashtagDraft.trim() !== "" ||
                  !dirty
                }
                type="submit"
              >
                {isSubmitting || updatePending ? (
                  <Spinner
                    data-icon="inline-start"
                    label={t("cardSheet.saving")}
                  />
                ) : null}
                {t("cardSheet.saveRevision")}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      ) : (
        <Field>
          <p className="text-muted-foreground">
            {t("cardSheet.editor.noRevision")}
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
  onPendingChange,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  form: UseFormReturn<DraftEditorInput>;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const onSettled = () => onPendingChange(false);
  const regenerate = useAction(regenerateCopyAction, { onSettled });
  const refreshArticle = useAction(refreshArticleAndRegenerateAction, {
    onSettled,
  });
  const retry = useAction(retryCopyGenerationAction, { onSettled });
  const pending =
    regenerate.isPending || refreshArticle.isPending || retry.isPending;
  const nonterminal =
    card.generation?.lifecycle === "queued" ||
    card.generation?.lifecycle === "running" ||
    card.generation?.lifecycle === "settling";
  const failedUnits =
    card.generation?.units.filter((unit) => unit.status === "failed").length ??
    0;

  const run = async (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => {
    if (disabled || pending || nonterminal) return;
    form.clearErrors("root");
    const common = {
      platformDraftId: card.id,
      idempotencyKey: crypto.randomUUID(),
    };
    const requestedContentLocale = form.getValues("contentLocale");
    const modelOptionKey = card.generation?.modelOptionKey ?? "";
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
      aria-busy={pending}
      aria-labelledby={`copy-actions-${card.id}`}
      className="grid gap-3 rounded-xl border border-border bg-card p-3"
    >
      <h3 className="ticket-label" id={`copy-actions-${card.id}`}>
        {t("cardSheet.copyActions")}
      </h3>
      <div className="grid gap-2">
        <Button
          className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
          disabled={disabled || pending || nonterminal || !card.generation}
          onClick={() => run("regenerate")}
          type="button"
          variant="outline"
        >
          <RotateCcwIcon aria-hidden="true" />
          {t("cardSheet.regenerate")}
        </Button>
        {card.sourceKind === "rss" ? (
          <Button
            className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
            disabled={disabled || pending || nonterminal || !card.generation}
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
            className="h-auto min-h-8 justify-start whitespace-normal py-1.5"
            disabled={disabled || pending || nonterminal}
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
