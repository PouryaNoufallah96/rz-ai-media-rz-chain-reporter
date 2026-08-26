"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  assembleCopy,
  type ContentLocale,
  INLINE_HASHTAG_TOKEN,
  MAX_REFERENCE_IMAGE_BYTES,
  PLATFORM_COPY_HARD_MAX,
  type Platform,
  platformCopyLength,
  REFERENCE_IMAGE_KIND,
  REFERENCE_IMAGE_MIME_TYPES,
} from "@rz-chain-reporter/contracts";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
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
  SheetTrigger,
} from "@rz-chain-reporter/ui/components/sheet";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { Textarea } from "@rz-chain-reporter/ui/components/textarea";
import { CheckIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
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
import { createMediaUploadInputSchema } from "@/features/media/schemas/upload";
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
  type DraftEditorInput,
  draftEditorSchema,
  type PlatformDraftCard,
} from "../schemas/drafts";

const EMPTY_EDITOR: DraftEditorInput = {
  contentLocale: "en",
  headline: "",
  body: "",
  hashtags: [],
};

export function CardSheet({
  card,
  children,
}: {
  card: PlatformDraftCard;
  children: ReactNode;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const form = useForm<DraftEditorInput>({
    defaultValues: revisionValues(card.revisions[0]) ?? EMPTY_EDITOR,
    mode: "onSubmit",
    resolver: zodResolver(draftEditorSchema),
  });
  const [baseline, setBaseline] = useState<EditBaseline | null>(() => {
    const revision = card.revisions[0];
    return revision ? baselineOf(revision) : null;
  });
  const { isDirty } = form.formState;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 599px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const requestOpenChange = (next: boolean) => {
    if (!next && isDirty) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(next);
  };

  return (
    <>
      <Sheet onOpenChange={requestOpenChange} open={open}>
        <SheetTrigger
          render={
            <Button
              className="grid h-auto w-full min-w-0 flex-1 gap-1 whitespace-normal p-2 text-start"
              type="button"
              variant="ghost"
            />
          }
        >
          {children}
        </SheetTrigger>
        <SheetContent
          className="w-full sm:w-[min(760px,100vw)]"
          closeLabel={t("cardSheet.close")}
          side={narrow ? "block-end" : "inline-end"}
        >
          <SheetHeader className="border-border border-b border-dashed pb-3">
            <SheetTitle>{t("cardSheet.title")}</SheetTitle>
            <SheetDescription>
              {t("cardSheet.description", {
                brand: card.brandName,
                platform: t(`run.platform.${card.platform}`),
              })}
            </SheetDescription>
          </SheetHeader>
          <CardSheetBody
            baseline={baseline}
            card={card}
            form={form}
            onBaselineChange={setBaseline}
          />
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        cancelLabel={t("cardSheet.discard.cancel")}
        confirmLabel={t("cardSheet.discard.confirm")}
        description={t("cardSheet.discard.description")}
        onConfirm={() => {
          const revision = card.revisions[0];
          form.reset(revisionValues(revision) ?? EMPTY_EDITOR);
          setBaseline(revision ? baselineOf(revision) : null);
          setOpen(false);
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

type RevisionSnapshot = Pick<
  Revision,
  "id" | "revisionNumber" | "contentLocale" | "headline" | "body" | "hashtags"
>;

type EditBaseline = {
  id: string;
  revisionNumber: number;
  content: DraftEditorInput;
};

type RebaseState = {
  conflicts: EditorField[];
  choices: Partial<Record<EditorField, "mine" | "theirs">>;
  mine: DraftEditorInput;
  theirs: DraftEditorInput;
  base: DraftEditorInput;
  revisionNumber: number;
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

function baselineOf(revision: RevisionSnapshot): EditBaseline {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    content: revisionValues(revision) ?? EMPTY_EDITOR,
  };
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

function CardSheetBody({
  baseline,
  card,
  form,
  onBaselineChange,
}: {
  baseline: EditBaseline | null;
  card: PlatformDraftCard;
  form: UseFormReturn<DraftEditorInput>;
  onBaselineChange: (baseline: EditBaseline | null) => void;
}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    card.candidates[0]?.id ?? null,
  );
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null,
  );
  const revealedRevisionId = useRef<string | null>(null);
  const selectedCandidate =
    card.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
    card.candidates[0] ??
    null;
  const selectedRevision =
    card.revisions.find((revision) => revision.id === selectedRevisionId) ??
    null;

  const selectRevision = (revisionId: string) => {
    revealedRevisionId.current = null;
    setSelectedRevisionId(revisionId);
  };

  useEffect(() => {
    if (
      selectedRevisionId === null ||
      revealedRevisionId.current === selectedRevisionId ||
      !card.revisions.some((revision) => revision.id === selectedRevisionId)
    ) {
      return;
    }
    const item = document.getElementById(
      `revision-history-${selectedRevisionId}`,
    );
    if (!item) return;
    item.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
    });
    revealedRevisionId.current = selectedRevisionId;
  }, [card.revisions, selectedRevisionId]);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,0.38fr)_minmax(0,0.62fr)]">
      <CandidateHistory
        card={card}
        onSelectCandidate={setSelectedCandidateId}
        onSelectRevision={selectRevision}
        selectedCandidateId={selectedCandidate?.id ?? null}
        selectedRevisionId={selectedRevision?.id ?? null}
      />
      <CardSheetEditor
        baseline={baseline}
        card={card}
        form={form}
        onBaselineChange={onBaselineChange}
        onSelectedRevisionChange={selectRevision}
        selectedCandidate={selectedCandidate}
        selectedRevision={selectedRevision}
      />
    </div>
  );
}

function CardSheetEditor({
  baseline,
  card,
  form,
  onBaselineChange,
  onSelectedRevisionChange,
  selectedCandidate,
  selectedRevision,
}: {
  baseline: EditBaseline | null;
  card: PlatformDraftCard;
  form: UseFormReturn<DraftEditorInput>;
  onBaselineChange: (baseline: EditBaseline | null) => void;
  onSelectedRevisionChange: (revisionId: string) => void;
  selectedCandidate: PlatformDraftCard["candidates"][number] | null;
  selectedRevision: Revision | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const latest = card.revisions[0] ?? null;
  const [serverConflict, setServerConflict] = useState(false);
  const [rebase, setRebase] = useState<RebaseState | null>(null);
  const { isSubmitting } = form.formState;
  // React Compiler memoises the stable formState proxy, so a keystroke-only
  // change never re-renders through form.formState.isDirty. useWatch does.
  const [contentLocale, headline, body, hashtags] = useWatch({
    control: form.control,
    name: ["contentLocale", "headline", "body", "hashtags"],
  });
  const values: DraftEditorInput = { contentLocale, headline, body, hashtags };
  const dirty =
    baseline !== null &&
    EDITOR_FIELDS.some((field) => !sameField(baseline.content, values, field));
  const stale =
    serverConflict ||
    (dirty &&
      latest !== null &&
      baseline !== null &&
      latest.id !== baseline.id);
  const updateRevision = useAction(updateDraftRevisionAction);
  const regenerate = useAction(regenerateCopyAction);
  const refreshArticle = useAction(refreshArticleAndRegenerateAction);
  const retry = useAction(retryCopyGenerationAction);
  const operationPending =
    regenerate.isPending || refreshArticle.isPending || retry.isPending;
  const nonterminal =
    card.generation?.lifecycle === "queued" ||
    card.generation?.lifecycle === "running" ||
    card.generation?.lifecycle === "settling";

  useEffect(() => {
    if (!latest || dirty || latest.id === baseline?.id) return;
    form.reset(revisionValues(latest) ?? EMPTY_EDITOR);
    onBaselineChange(baselineOf(latest));
  }, [baseline, dirty, form, latest, onBaselineChange]);

  const resolveError = (code: string | undefined) =>
    code !== undefined && isCardSheetErrorCode(code)
      ? t(CARD_SHEET_ERROR_KEYS[code])
      : t("cardSheet.error.unknown");

  const setActionError = async (
    settled: Awaited<ReturnType<typeof updateRevision.execute>>,
  ) => {
    applyActionErrorToForm(form.setError, settled, form.setFocus);
    if (settled.code !== "VERSION_CONFLICT") return;
    setServerConflict(true);
    await refreshEditorialReadsAction();
  };

  const settleRevision = (revision: RevisionSnapshot, select = false) => {
    form.reset(revisionValues(revision) ?? EMPTY_EDITOR);
    onBaselineChange(baselineOf(revision));
    if (select) onSelectedRevisionChange(revision.id);
    setServerConflict(false);
    setRebase(null);
  };

  const expectedLatest = () => ({
    id: latest?.id ?? null,
    revisionNumber: latest?.revisionNumber ?? null,
  });

  const applyCandidate = async () => {
    if (!selectedCandidate) return;
    form.clearErrors("root");
    const settled = await updateRevision.execute({
      commandKind: "apply_copy_variant",
      platformDraftId: card.id,
      copyVariantId: selectedCandidate.id,
      expectedLatest: expectedLatest(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (settled.status === "error" || !settled.data) {
      await setActionError(settled);
      return;
    }
    settleRevision(settled.data.revision, true);
  };

  const removeImage = async () => {
    form.clearErrors("root");
    const settled = await updateRevision.execute({
      commandKind: "remove_image",
      platformDraftId: card.id,
      expectedLatest: expectedLatest(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (settled.status === "error" || !settled.data) {
      await setActionError(settled);
      return;
    }
    settleRevision(settled.data.revision);
  };

  const submit = form.handleSubmit(async (content) => {
    if (!latest || stale || !baseline) return;
    form.clearErrors("root");
    const settled = await updateRevision.execute({
      commandKind: "submit_content",
      platformDraftId: card.id,
      content,
      expectedLatest: {
        id: baseline.id,
        revisionNumber: baseline.revisionNumber,
      },
      idempotencyKey: crypto.randomUUID(),
    });
    if (settled.status === "error" || !settled.data) {
      await setActionError(settled);
      return;
    }
    settleRevision(settled.data.revision, true);
  });

  const runCopy = async (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => {
    form.clearErrors("root");
    const common = {
      platformDraftId: card.id,
      idempotencyKey: crypto.randomUUID(),
    };
    const locale = form.getValues("contentLocale");
    const modelOptionKey = card.generation?.modelOptionKey;
    const settled =
      kind === "retry_failed"
        ? await retry.execute({ kind, ...common })
        : kind === "refresh_article"
          ? await refreshArticle.execute({
              kind,
              ...common,
              modelOptionKey: modelOptionKey ?? "",
              requestedContentLocale: locale,
            })
          : await regenerate.execute({
              kind,
              ...common,
              modelOptionKey: modelOptionKey ?? "",
              requestedContentLocale: locale,
            });
    if (settled.status === "error") {
      form.setError("root.server", {
        message: settled.code,
        type: "server",
      });
    }
  };

  const reloadLatest = () => {
    if (!latest) return;
    form.clearErrors("root");
    settleRevision(latest);
  };

  const startRebase = () => {
    if (!latest || !baseline) return;
    const base = baseline.content;
    const mine = form.getValues();
    const theirs = revisionValues(latest) ?? EMPTY_EDITOR;
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
      revisionNumber: latest.revisionNumber,
      theirs,
    };
    if (conflicts.length > 0) {
      setRebase(state);
      return;
    }
    applyRebase(mergeRebase(state));
  };

  const applyRebase = (merged: DraftEditorInput) => {
    if (!latest) return;
    const theirs = revisionValues(latest) ?? EMPTY_EDITOR;
    form.clearErrors("root");
    form.reset(theirs);
    for (const field of EDITOR_FIELDS) {
      if (sameField(theirs, merged, field)) continue;
      form.setValue(field, merged[field], { shouldDirty: true });
    }
    onBaselineChange(baselineOf(latest));
    setServerConflict(false);
    setRebase(null);
  };

  const rootError = form.formState.errors.root?.server?.message;
  const failedUnits =
    card.generation?.units.filter((unit) => unit.status === "failed").length ??
    0;

  return (
    <div className="grid content-start gap-4">
      <SelectedContentPreviews
        cardId={card.id}
        onApplyCandidate={applyCandidate}
        pending={updateRevision.isPending}
        selectedCandidate={selectedCandidate}
        selectedRevision={selectedRevision}
      />
      {stale ? (
        <StaleBanner
          latest={latest}
          onApply={applyRebase}
          onChoose={(field, choice) =>
            setRebase((current) =>
              current
                ? {
                    ...current,
                    choices: { ...current.choices, [field]: choice },
                  }
                : current,
            )
          }
          onDiscard={reloadLatest}
          onRebase={startRebase}
          rebase={rebase}
        />
      ) : null}
      <RevisionEditor
        form={form}
        isSubmitting={isSubmitting}
        latest={latest}
        platform={card.platform}
        onSubmit={submit}
        resolveError={resolveError}
        rootError={rootError}
        stale={stale}
        updatePending={updateRevision.isPending}
      />
      <CopyControls
        card={card}
        failedUnits={failedUnits}
        nonterminal={nonterminal}
        onRun={runCopy}
        pending={operationPending}
      />
      <ImageControls
        card={card}
        editorDirty={dirty}
        form={form}
        latest={latest}
        onRemove={removeImage}
        revisionPending={updateRevision.isPending}
      />
    </div>
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
  latest,
  onApply,
  onChoose,
  onDiscard,
  onRebase,
  rebase,
}: {
  latest: Revision | null;
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
    <div className="border border-working p-3" role="status">
      <strong>{t("cardSheet.stale.title")}</strong>
      {latest ? (
        <p>
          {t("cardSheet.stale.arrived", {
            author: latest.authorName,
            n: latest.revisionNumber,
            time: format.dateTime(latest.createdAt, { timeStyle: "short" }),
          })}
        </p>
      ) : null}
      <p>{t("cardSheet.stale.description")}</p>
      {rebase === null ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={onRebase} type="button" variant="secondary">
            {t("cardSheet.stale.rebase")}
          </Button>
          <Button onClick={onDiscard} type="button" variant="outline">
            {t("cardSheet.stale.reload")}
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          <p className="ticket-label">{t("cardSheet.rebase.title")}</p>
          {rebase.conflicts.map((field) => (
            <fieldset
              className="grid gap-1 border border-border p-2"
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
              disabled={!resolved}
              onClick={() => onApply(mergeRebase(rebase))}
              type="button"
            >
              {t("cardSheet.rebase.apply")}
            </Button>
            <Button onClick={onDiscard} type="button" variant="outline">
              {t("cardSheet.stale.reload")}
            </Button>
          </div>
        </div>
      )}
    </div>
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
      className="grid h-auto w-full justify-normal gap-1 whitespace-normal p-2 text-start data-selected:border-ring data-selected:ring-2 data-selected:ring-ring"
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

async function uploadReference(file: File) {
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
    kind: REFERENCE_IMAGE_KIND,
  });
  if (!parsed.success) return null;
  const intent = await client.media.createIntent(parsed.data);
  return intent.mediaAssetId;
}

function ImageControls({
  card,
  editorDirty,
  form,
  latest,
  onRemove,
  revisionPending,
}: {
  card: PlatformDraftCard;
  editorDirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  latest: Revision | null;
  onRemove: () => Promise<void>;
  revisionPending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [modelOptionKey, setModelOptionKey] = useState(
    card.imageGeneration?.modelOptionKey ?? card.imageModels[0]?.key ?? "",
  );
  const [operatorDirection, setOperatorDirection] = useState("");
  const [reference, setReference] = useState<ReferenceUpload | null>(null);
  const start = useAction(startImageGenerationAction);
  const retry = useAction(retryImageGenerationAction);
  const operation = card.imageGeneration;
  const nonterminal =
    operation?.lifecycle === "queued" ||
    operation?.lifecycle === "running" ||
    operation?.lifecycle === "settling";
  const pending = start.isPending || retry.isPending;
  const referenceBusy =
    reference?.status === "uploading" || reference?.status === "verifying";
  const imageSourceReady = latest?.imageSourceReadiness === "ready";
  const disabled =
    !imageSourceReady ||
    !modelOptionKey ||
    nonterminal ||
    pending ||
    referenceBusy;
  const selectedFinalMediaAssetId = latest?.selectedFinalMediaAssetId ?? null;
  const final = operation?.finalMediaAssetId ?? null;
  const live = useRef(true);
  const referenceRun = useRef(0);
  const referenceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const clearReference = () => {
    referenceRun.current += 1;
    setReference(null);
    if (referenceInput.current) referenceInput.current.value = "";
    referenceInput.current?.focus();
  };

  const selectReference = async (file: File | undefined) => {
    referenceRun.current += 1;
    const run = referenceRun.current;
    const current = () => live.current && referenceRun.current === run;
    if (!file) {
      setReference(null);
      return;
    }
    setReference({
      fileName: file.name,
      mediaAssetId: null,
      status: "uploading",
    });
    let mediaAssetId: string | null = null;
    try {
      mediaAssetId = await uploadReference(file);
    } catch {
      mediaAssetId = null;
    }
    if (!current()) return;
    if (!mediaAssetId) {
      setReference({
        fileName: file.name,
        mediaAssetId: null,
        status: "failed",
      });
      return;
    }
    setReference({ fileName: file.name, mediaAssetId, status: "verifying" });
    for (let attempt = 0; attempt < REFERENCE_POLL_ATTEMPTS; attempt += 1) {
      const confirmed = await client.media
        .confirm({ mediaAssetId })
        .catch(() => null);
      if (!current()) return;
      if (!confirmed) {
        setReference({ fileName: file.name, mediaAssetId, status: "failed" });
        return;
      }
      if (confirmed.lifecycle === "verified") {
        setReference({ fileName: file.name, mediaAssetId, status: "verified" });
        return;
      }
      if (confirmed.lifecycle === "rejected") {
        setReference({ fileName: file.name, mediaAssetId, status: "rejected" });
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, REFERENCE_POLL_INTERVAL_MS),
      );
      if (!current()) return;
    }
    setReference({ fileName: file.name, mediaAssetId, status: "failed" });
  };

  const execute = async () => {
    if (!latest || !imageSourceReady || !modelOptionKey) return;
    form.clearErrors("root");
    const common = {
      draftRevisionId: latest.id,
      expectedRevisionNumber: latest.revisionNumber,
      idempotencyKey: crypto.randomUUID(),
      modelOptionKey,
      operatorDirection,
      ...(reference?.status === "verified" && reference.mediaAssetId
        ? { referenceMediaAssetId: reference.mediaAssetId }
        : {}),
    };
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
    <details className="border border-border border-dashed p-3">
      <summary className="ticket-label cursor-pointer select-none">
        {t("cardSheet.image")}
      </summary>
      <div className="mt-3 grid gap-2">
        <p
          aria-live="polite"
          className={
            latest && !imageSourceReady
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {!latest
            ? t("cardSheet.imageNeedsRevision")
            : imageSourceReady
              ? t("cardSheet.imageReady")
              : t("cardSheet.imageSourceExtractRequired")}
        </p>
        <LabeledSelect
          disabled={nonterminal || pending}
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
            disabled={nonterminal || pending}
            id={`image-direction-${card.id}`}
            maxLength={1_000}
            onChange={(event) =>
              setOperatorDirection(event.currentTarget.value)
            }
            value={operatorDirection}
          />
          <FieldDescription>
            {t("cardSheet.imageDirectionHint")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldCaption htmlFor={`image-reference-${card.id}`}>
            {t("cardSheet.imageReference")}
          </FieldCaption>
          <Input
            accept={REFERENCE_IMAGE_MIME_TYPES.join(",")}
            disabled={nonterminal || pending || referenceBusy}
            id={`image-reference-${card.id}`}
            ref={referenceInput}
            onChange={(event) =>
              selectReference(event.currentTarget.files?.[0])
            }
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
                  reference.status === "rejected" ||
                  reference.status === "failed"
                    ? "text-destructive text-sm"
                    : "text-muted-foreground text-sm"
                }
              >
                {referenceBusy ? (
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
                onClick={clearReference}
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
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {operation
            ? t("cardSheet.imageStatus", {
                status: t(`platformDraft.lifecycle.${operation.lifecycle}`),
              })
            : t("cardSheet.imageStatusIdle")}
        </p>
        {operation?.lifecycle === "failed" && imageSourceReady ? (
          <p className="text-destructive text-sm">
            {t("cardSheet.imageFailed")}
          </p>
        ) : null}
        {final ? (
          <>
            <Image
              alt={t("cardSheet.imageAlt", {
                brand: card.brandName,
                headline: latest?.headline ?? card.originTitle,
              })}
              className="h-auto w-full border border-border"
              height={1350}
              sizes="(max-width: 639px) 100vw, 62vw"
              src={`/api/media/${final}`}
              unoptimized
              width={1080}
            />
            <a
              className="text-sm underline underline-offset-4"
              download
              href={`/api/media/${final}?download=1`}
            >
              {t("cardSheet.imageDownload")}
            </a>
            <p className="text-muted-foreground text-sm">
              {selectedFinalMediaAssetId === final
                ? t("cardSheet.imageAttached")
                : t("cardSheet.imageNotAttached")}
            </p>
            {selectedFinalMediaAssetId && editorDirty ? (
              <p className="text-muted-foreground text-xs">
                {t("cardSheet.imageRemoveBlocked")}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {selectedFinalMediaAssetId ? (
                <Button
                  disabled={revisionPending || editorDirty}
                  onClick={onRemove}
                  type="button"
                  variant="outline"
                >
                  {t("cardSheet.imageRemove")}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
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
    </details>
  );
}

function SelectableItem({
  contentLocale,
  label,
  meta,
  onSelect,
  preview,
  selected,
  time,
}: {
  contentLocale: ContentLocale;
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
      className="grid h-auto w-full justify-normal gap-1 whitespace-normal p-2 text-start data-selected:border-ring data-selected:ring-2 data-selected:ring-ring"
      data-selected={selected || undefined}
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
  onSelectCandidate,
  onSelectRevision,
  selectedCandidateId,
  selectedRevisionId,
}: {
  card: PlatformDraftCard;
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
    <aside className="grid content-start gap-4 sm:max-h-[calc(100dvh-8rem)] sm:overflow-y-auto sm:pe-2">
      <section aria-labelledby={`candidates-${card.id}`}>
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
    </aside>
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
          className="mt-2 grid gap-2 border border-border p-3"
          dir={content.contentLocale === "fa" ? "rtl" : "ltr"}
          lang={content.contentLocale}
        >
          <strong>{content.headline}</strong>
          <p className="whitespace-pre-wrap">{content.body}</p>
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
  form,
  resolveError,
}: {
  form: UseFormReturn<DraftEditorInput>;
  resolveError: (code: string | undefined) => string;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [draft, setDraft] = useState("");

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
          setDraft("");
          if (added.length > 0) change([...hashtags, ...added]);
        };

        return (
          <>
            <FieldCaption htmlFor={controlId}>
              {t("cardSheet.editor.hashtags")}
            </FieldCaption>
            <InputGroup className="max-w-64">
              <InputGroupInput
                {...controlProps}
                onBlur={field.onBlur}
                placeholder={t("cardSheet.editor.hashtagPlaceholder")}
                onChange={(event) => setDraft(event.currentTarget.value)}
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
                    className="h-6 gap-1 overflow-visible py-0 ps-2 pe-0.5 data-locked:pe-2"
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
  form,
  isSubmitting,
  latest,
  onSubmit,
  platform,
  resolveError,
  rootError,
  stale,
  updatePending,
}: {
  form: UseFormReturn<DraftEditorInput>;
  isSubmitting: boolean;
  latest: Revision | null;
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
    latest !== null && contentLocale !== latest.contentLocale;
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
      {latest ? (
        <form className="grid gap-3" onSubmit={onSubmit}>
          <FieldGroup className="gap-3">
            <FormInputField
              control={form.control}
              label={t("cardSheet.editor.headline")}
              name="headline"
              resolveError={resolveError}
            />
            <FormTextareaField
              control={form.control}
              label={t("cardSheet.editor.body")}
              name="body"
              resolveError={resolveError}
              rows={8}
            />
            <HashtagField form={form} resolveError={resolveError} />
            <FormSelectField
              control={form.control}
              label={t("cardSheet.editor.locale")}
              name="contentLocale"
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
                stale
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
  failedUnits,
  nonterminal,
  onRun,
  pending,
}: {
  card: PlatformDraftCard;
  failedUnits: number;
  nonterminal: boolean;
  onRun: (
    kind: "refresh_article" | "regenerate" | "retry_failed",
  ) => Promise<void>;
  pending: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <section
      aria-busy={pending}
      aria-labelledby={`copy-actions-${card.id}`}
      className="grid gap-2 border border-border border-dashed p-3"
    >
      <h3 className="ticket-label" id={`copy-actions-${card.id}`}>
        {t("cardSheet.copyActions")}
      </h3>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending || nonterminal || !card.generation}
          onClick={() => onRun("regenerate")}
          type="button"
          variant="outline"
        >
          {t("cardSheet.regenerate")}
        </Button>
        {card.sourceKind === "rss" ? (
          <Button
            disabled={pending || nonterminal || !card.generation}
            onClick={() => onRun("refresh_article")}
            type="button"
            variant="outline"
          >
            {t("cardSheet.refreshArticle")}
          </Button>
        ) : null}
        {failedUnits > 0 ? (
          <Button
            disabled={pending || nonterminal}
            onClick={() => onRun("retry_failed")}
            type="button"
            variant="outline"
          >
            {t("cardSheet.retryFailed", { n: failedUnits })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function revisionValues(
  revision:
    | PlatformDraftCard["revisions"][number]
    | {
        contentLocale: "en" | "fa";
        headline: string;
        body: string;
        hashtags: string[];
      }
    | undefined,
): DraftEditorInput | null {
  return revision
    ? {
        contentLocale: revision.contentLocale,
        headline: revision.headline,
        body: revision.body,
        hashtags: [...revision.hashtags],
      }
    : null;
}
