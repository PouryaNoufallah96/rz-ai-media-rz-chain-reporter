"use client";

import {
  assembleCopy,
  INLINE_HASHTAG_TOKEN,
  PLATFORM_COPY_HARD_MAX,
  type Platform,
  platformCopyLength,
} from "@rz-chain-reporter/contracts";
import { DIRECTION } from "@rz-chain-reporter/i18n";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Field, FieldGroup } from "@rz-chain-reporter/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rz-chain-reporter/ui/components/input-group";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { CheckIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ComponentProps, type ReactNode, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { ModelIcon } from "@/components/common/model-icon";
import {
  FieldCaption,
  FormField,
  FormInputField,
  FormRootError,
  FormTextareaField,
  LabeledSelect,
} from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { updateDraftRevisionAction } from "../actions/commands";
import { refreshEditorialReadsAction } from "../actions/refresh-editorial-reads";
import { EDITORIAL_NAMESPACE } from "../constants";
import {
  canChangeSavedCard,
  canCreateRevision,
  candidateEditSource,
  type EditSource,
  type RevisionDraftCard,
  revisionEditSource,
  sameEditSource,
} from "../lib/revision-editor-state";
import type {
  DraftEditorInput,
  UpdateDraftRevisionInput,
} from "../schemas/drafts";
import type { RunOptions } from "../schemas/workspace";

type Revision = RevisionDraftCard["revisions"][number];

const CARD_SHEET_ERROR_KEYS = {
  MEDIA_CONTENT_MISMATCH: "cardSheet.error.mediaContentMismatch",
  MEDIA_INVALID: "cardSheet.error.mediaInvalid",
  MEDIA_LOCKED: "cardSheet.error.mediaLocked",
  VALIDATION_FAILED: "cardSheet.error.validation",
  VERSION_CONFLICT: "cardSheet.error.conflict",
} as const;

function isCardSheetErrorCode(
  value: string,
): value is keyof typeof CARD_SHEET_ERROR_KEYS {
  return value in CARD_SHEET_ERROR_KEYS;
}

export type CopyVariantEditorCommands = ReturnType<
  typeof useCopyVariantRevisionCommands
>;

export function useCopyVariantRevisionCommands({
  card,
  dirty,
  form,
  hashtagDraft,
  onAcceptCard,
  onPendingChange,
  onSelectSource,
  pending,
  source,
}: {
  card: RevisionDraftCard;
  dirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  onAcceptCard: (card: RevisionDraftCard, revisionId: string) => void;
  onPendingChange: (pending: boolean) => void;
  onSelectSource: (source: EditSource) => void;
  pending: boolean;
  source: EditSource | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const presentationLocale = useLocale();
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
      presentationLocale,
    });
    setSwitchingRevision(false);
    return selected;
  };
  const requestSelection = (next: EditSource) => {
    if (busy || sameEditSource(source, next)) return;
    if (dirty) setSelection(next);
    else void applySelection(next);
  };
  const removeImage = async () => {
    if (effectsBlocked) return;
    await executeRevision({
      commandKind: "remove_image",
      platformDraftId: card.id,
      expectedActive,
      expectedImageIntentVersion: active?.imageIntentVersion ?? 0,
      idempotencyKey: crypto.randomUUID(),
      presentationLocale,
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
      presentationLocale,
    });
  };
  const submit = form.handleSubmit(async (content) => {
    if (!source || waitingForRefresh || !canCreateRevision(source, dirty))
      return;
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
      presentationLocale,
      source:
        source.kind === "copy_variant"
          ? {
              kind: source.kind,
              id: source.id,
              contentLocale: source.content.contentLocale,
            }
          : { kind: source.kind, id: source.id },
    });
  });
  const confirmSelection = async () => {
    if (!selection) return;
    const selected = await applySelection(selection);
    return selected ? undefined : { error: t("cardSheet.error.unknown") };
  };

  return {
    active,
    adoptImage,
    busy,
    changeSelectionOpen: (open: boolean) => {
      if (!open) setSelection(null);
    },
    confirmSelection,
    effectsBlocked,
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

export function SelectableItemSkeleton({
  pace,
}: {
  pace?: ComponentProps<typeof Skeleton>["pace"];
}) {
  return (
    <div
      aria-hidden="true"
      className="grid min-h-20 gap-2 rounded-lg border border-border bg-background/70 p-2"
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-28" pace={pace} />
        <Skeleton className="h-3 w-20" pace={pace} />
      </div>
      <Skeleton className="h-3 w-full" pace={pace} />
      <Skeleton className="h-3 w-3/4" pace={pace} />
    </div>
  );
}

export function CopyVariantSelector({
  card,
  disabled,
  generating,
  models,
  onSelectCandidate,
  renderCandidateMeta,
  selectedSource,
}: {
  card: RevisionDraftCard;
  disabled: boolean;
  generating: boolean;
  models: RunOptions["models"];
  onSelectCandidate: (
    candidate: RevisionDraftCard["candidates"][number],
  ) => void;
  renderCandidateMeta?: (
    candidate: RevisionDraftCard["candidates"][number],
  ) => ReactNode;
  selectedSource: EditSource | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  return (
    <section
      aria-busy={generating || undefined}
      aria-labelledby={`candidates-${card.id}`}
      className="workspace:flex workspace:min-h-0 workspace:flex-1 workspace:flex-col workspace:overflow-hidden rounded-xl border border-primary/20 bg-linear-to-br from-accent/50 via-card to-card p-3"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-sm" id={`candidates-${card.id}`}>
          {t("cardSheet.candidates")}
        </h3>
      </header>
      {generating ? (
        <div
          aria-live="polite"
          className="mt-2 grid gap-2 overflow-hidden"
          role="status"
        >
          <span className="sr-only">{t("cardSheet.generatingStyles")}</span>
          {[0, 1, 2].map((row) => (
            <SelectableItemSkeleton key={row} pace="live" />
          ))}
        </div>
      ) : card.candidates.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          {t("cardSheet.candidatesEmpty")}
        </p>
      ) : (
        <ul className="scrollbar-none mt-2 grid max-h-72 gap-2 overflow-y-auto p-px">
          {card.candidates.map((candidate) => {
            const selected =
              selectedSource?.kind === "copy_variant" &&
              selectedSource.id === candidate.id &&
              sameEditSource(selectedSource, candidateEditSource(candidate));
            const candidateMeta = renderCandidateMeta?.(candidate);
            const model = models.find(
              (entry) => entry.key === candidate.modelOptionKey,
            );
            return (
              <li className="relative" key={candidate.id}>
                <Button
                  aria-pressed={selected}
                  className={
                    candidateMeta
                      ? "h-auto min-h-16 w-full justify-start pe-10"
                      : "h-auto min-h-16 w-full justify-start"
                  }
                  disabled={disabled}
                  onClick={() => onSelectCandidate(candidate)}
                  type="button"
                  variant="outline"
                >
                  {selected ? <CheckIcon aria-hidden="true" /> : null}
                  <span className="grid min-w-0 gap-1 text-start">
                    <span className="flex flex-wrap items-center gap-1">
                      <strong>
                        {t("cardSheet.variantLabel", {
                          key: candidate.variantKey,
                        })}
                      </strong>
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <ModelIcon
                          className="size-3.5 shrink-0"
                          vendor={model?.vendor ?? null}
                        />
                        {t("cardSheet.candidateMeta", {
                          locale: candidate.contentLocale,
                          model: model?.name ?? candidate.modelOptionKey,
                        })}
                      </span>
                    </span>
                    <Bdi
                      className="line-clamp-2 text-muted-foreground"
                      lang={candidate.contentLocale}
                    >
                      {candidate.headline}
                    </Bdi>
                  </span>
                </Button>
                {candidateMeta ? (
                  <span className="absolute inset-e-2 top-2">
                    {candidateMeta}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

function copyEditorBlocked({
  body,
  contentLocale,
  headline,
  limit,
  sourceLocale,
  used,
}: {
  body: string;
  contentLocale: string;
  headline: string;
  limit: number;
  sourceLocale: string | undefined;
  used: number;
}) {
  return (
    used > limit ||
    headline.match(INLINE_HASHTAG_TOKEN) !== null ||
    body.match(INLINE_HASHTAG_TOKEN) !== null ||
    contentLocale !== sourceLocale
  );
}

function createRevisionDisabled({
  blocked,
  commands,
  dirty,
  disabled,
  hashtagDraft,
  source,
}: {
  blocked: boolean;
  commands: CopyVariantEditorCommands;
  dirty: boolean;
  disabled: boolean;
  hashtagDraft: string;
  source: EditSource;
}) {
  return (
    disabled ||
    blocked ||
    commands.waitingForRefresh ||
    hashtagDraft.trim() !== "" ||
    !canCreateRevision(source, dirty)
  );
}

export function CopyVariantEditor({
  commands,
  disabled,
  dirty,
  form,
  hashtagDraft,
  nextRevisionNumber,
  onEditorChange,
  onHashtagDraftChange,
  platform,
  revisions,
  source,
  sourceLoading,
}: {
  commands: CopyVariantEditorCommands;
  disabled: boolean;
  dirty: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  nextRevisionNumber: number;
  onEditorChange: () => void;
  onHashtagDraftChange: (value: string) => void;
  platform: Platform;
  revisions: readonly Revision[];
  source: EditSource | null;
  sourceLoading: boolean;
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
  const blocked = copyEditorBlocked({
    body,
    contentLocale,
    headline,
    limit,
    sourceLocale: source?.content.contentLocale,
    used,
  });
  const rootError = form.formState.errors.root?.server?.message;

  if (sourceLoading && !source) {
    return (
      <div aria-live="polite" className="h-full" role="status">
        <span className="sr-only">{t("cardSheet.generatingStyles")}</span>
        <RevisionWorkspaceSkeleton pace="live" />
      </div>
    );
  }

  if (!source) {
    return (
      <Field className="rounded-xl border bg-card p-5">
        <p className="text-muted-foreground">
          {t("cardSheet.editor.noSource")}
        </p>
        <FormRootError
          message={rootError ? commands.resolveError(rootError) : undefined}
        />
      </Field>
    );
  }

  return (
    <form
      aria-busy={commands.busy}
      className="grid gap-4 rounded-xl border bg-card p-4"
      onChange={onEditorChange}
      onSubmit={
        commands.submit as NonNullable<ComponentProps<"form">["onSubmit"]>
      }
    >
      <CopyVariantEditorHeader
        commands={commands}
        dirty={dirty}
        disabled={disabled}
        revisions={revisions}
        source={source}
      />
      <CopyVariantEditorFields
        blocked={blocked}
        commands={commands}
        contentLocale={contentLocale}
        dirty={dirty}
        disabled={disabled}
        form={form}
        hashtagDraft={hashtagDraft}
        limit={limit}
        nextRevisionNumber={nextRevisionNumber}
        onHashtagDraftChange={onHashtagDraftChange}
        platform={platform}
        rootError={rootError}
        source={source}
        used={used}
      />
    </form>
  );
}

function CopyVariantEditorHeader({
  commands,
  dirty,
  disabled,
  revisions,
  source,
}: {
  commands: CopyVariantEditorCommands;
  dirty: boolean;
  disabled: boolean;
  revisions: readonly Revision[];
  source: EditSource;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="font-semibold text-base">
          {t("cardSheet.editor.workspace")}
        </h3>
        <p className="text-muted-foreground text-xs">
          {source.kind === "copy_variant"
            ? t("cardSheet.editor.fromVariation")
            : t("cardSheet.editor.fromRevision", {
                n: source.revisionNumber ?? 0,
              })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dirty ? (
          <Badge variant="secondary">{t("cardSheet.editor.edited")}</Badge>
        ) : null}
        {revisions.length > 0 ? (
          <LabeledSelect
            busy={commands.busy}
            disabled={disabled}
            label={<span className="sr-only">{t("cardSheet.revisions")}</span>}
            onValueChange={(id) => {
              const revision = revisions.find((entry) => entry.id === id);
              if (revision)
                commands.requestSelection(revisionEditSource(revision));
            }}
            options={revisions.map((revision) => ({
              label: t("cardSheet.revision", { n: revision.revisionNumber }),
              value: revision.id,
            }))}
            orientation="horizontal"
            placeholder={t("cardSheet.editor.generatedVariation")}
            value={source.kind === "draft_revision" ? source.id : null}
          />
        ) : null}
      </div>
    </header>
  );
}

function CopyVariantEditorFields({
  blocked,
  commands,
  contentLocale,
  dirty,
  disabled,
  form,
  hashtagDraft,
  limit,
  nextRevisionNumber,
  onHashtagDraftChange,
  platform,
  rootError,
  source,
  used,
}: {
  blocked: boolean;
  commands: CopyVariantEditorCommands;
  contentLocale: DraftEditorInput["contentLocale"];
  dirty: boolean;
  disabled: boolean;
  form: UseFormReturn<DraftEditorInput>;
  hashtagDraft: string;
  limit: number;
  nextRevisionNumber: number;
  onHashtagDraftChange: (value: string) => void;
  platform: Platform;
  rootError: string | undefined;
  source: EditSource;
  used: number;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const createDisabled = createRevisionDisabled({
    blocked,
    commands,
    dirty,
    disabled,
    hashtagDraft,
    source,
  });

  return (
    <fieldset disabled={disabled}>
      <FieldGroup>
        <FormInputField
          control={form.control}
          dir={DIRECTION[contentLocale]}
          lang={contentLocale}
          label={t("cardSheet.editor.headline")}
          name="headline"
          resolveError={commands.resolveError}
        />
        <FormTextareaField
          control={form.control}
          dir={DIRECTION[contentLocale]}
          lang={contentLocale}
          label={t("cardSheet.editor.body")}
          name="body"
          resolveError={commands.resolveError}
          rows={12}
        />
        <HashtagField
          draft={hashtagDraft}
          form={form}
          onDraftChange={onHashtagDraftChange}
          resolveError={commands.resolveError}
        />
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
        {commands.waitingForRefresh ? (
          <p className="text-muted-foreground text-xs">
            {t("cardSheet.stale.blocked")}
          </p>
        ) : null}
        <FormRootError
          message={rootError ? commands.resolveError(rootError) : undefined}
        />
        <Button disabled={createDisabled} type="submit">
          {commands.busy ? (
            <Spinner data-icon="inline-start" label={t("cardSheet.saving")} />
          ) : null}
          {t("cardSheet.createRevision", { n: nextRevisionNumber })}
        </Button>
      </FieldGroup>
    </fieldset>
  );
}

export function RevisionWorkspaceSkeleton({
  pace,
}: {
  pace?: ComponentProps<typeof Skeleton>["pace"];
}) {
  return (
    <div
      aria-hidden="true"
      className="grid workspace:h-full content-start gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-5 w-40" pace={pace} />
          <Skeleton className="h-3 w-56 max-w-full" pace={pace} />
        </div>
        <Skeleton className="h-6 w-24" pace={pace} />
      </div>
      <Skeleton className="h-16 w-full" pace={pace} />
      <Skeleton className="h-40 w-full" pace={pace} />
      <Skeleton className="h-16 w-full" pace={pace} />
      <Skeleton className="h-12 w-full" pace={pace} />
      <Skeleton className="h-4 w-36" pace={pace} />
      <Skeleton className="h-10 w-full" pace={pace} />
    </div>
  );
}
