"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type SourceOrigin,
  TELEGRAM_ORDERING_MODES,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Checkbox } from "@rz-chain-reporter/ui/components/checkbox";
import { FieldGroup } from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { type Control, useController, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  FormCheckboxField,
  FormField,
  FormRootError,
} from "@/components/form/form-field";
import { useFallbackErrorMessage } from "@/components/form/use-error-message";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { OPERATION_ERROR_KEYS } from "@/features/operations/lib/panel-state";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";

import { startSourceImportAction } from "../actions/start-source-import";
import {
  IMPORT_WINDOW_HOURS,
  MAX_TOP_N,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS,
  SOURCES_NAMESPACE,
} from "../constants";
import type { SourceCatalog, SourceCatalogEntry } from "../schemas/catalog";
import {
  type SourceImportsView,
  startSourceImportInputSchema,
} from "../schemas/imports";

const SOURCE_KINDS: readonly SourceOrigin[] = ["rss", "telegram_public"];

type ImportFormValues = z.input<typeof startSourceImportInputSchema>;

type ImportFormControl = Control<ImportFormValues>;

type FieldProps = {
  control: ImportFormControl;
  disabled: boolean;
  resolveError: (code: string | undefined) => string;
};

export function SourceImportForm({
  catalog,
  imports,
}: {
  catalog: SourceCatalog;
  imports: SourceImportsView;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const resolveError = useImportErrorMessage();
  const titleId = useId();
  const startHintId = useId();

  const selectable: SourceCatalogEntry[] = [];
  for (const entry of catalog.entries) {
    if (entry.lifecycle === "enabled") selectable.push(entry);
  }

  const action = useAction(startSourceImportAction);
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
    setFocus,
  } = useForm<ImportFormValues>({
    defaultValues: {
      sourceIds: selectable.map((entry) => entry.id),
      windowHours: imports.defaults.windowHours,
      orderingMode: imports.defaults.orderingMode,
      topN: imports.defaults.topN,
      topics: [],
      enrichmentEnabled: imports.defaults.enrichmentEnabled,
    },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    resolver: zodResolver(startSourceImportInputSchema),
  });

  const isPending = isSubmitting || action.isPending;

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(
      selectedHasOrigin(selectable, values.sourceIds, "telegram_public")
        ? values
        : {
            ...values,
            orderingMode: imports.defaults.orderingMode,
            topN: imports.defaults.topN,
            topics: [],
          },
    );

    if (result.status === "error") {
      applyActionErrorToForm(setError, result, setFocus);
      return;
    }

    toast.success(t("import.started"));
  });

  return (
    <section aria-labelledby={titleId} className="border border-border p-4">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("import.title")}
      </h2>
      <form
        aria-busy={isPending}
        className="mt-3"
        noValidate
        onSubmit={onSubmit}
      >
        <FieldGroup>
          <SourceSelection
            control={control}
            disabled={isPending}
            enrichmentEnabled={imports.defaults.enrichmentEnabled}
            recentTopics={imports.recentTopics}
            resolveError={resolveError}
            selectable={selectable}
          />
          <RecencyField
            control={control}
            disabled={isPending}
            resolveError={resolveError}
          />
          <FormRootError
            message={
              errors.root?.server
                ? resolveError(errors.root.server.message)
                : undefined
            }
          />
          <StartImportControl
            control={control}
            isPending={isPending}
            startHintId={startHintId}
          />
        </FieldGroup>
      </form>
    </section>
  );
}

function selectedHasOrigin(
  selectable: readonly SourceCatalogEntry[],
  sourceIds: readonly string[],
  origin: SourceOrigin,
) {
  const selected = new Set(sourceIds);
  return selectable.some(
    (entry) => entry.origin === origin && selected.has(entry.id),
  );
}

function StartImportControl({
  control,
  isPending,
  startHintId,
}: {
  control: ImportFormControl;
  isPending: boolean;
  startHintId: string;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const { field } = useController({ control, name: "sourceIds" });
  const hasSelection = field.value.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        aria-describedby={startHintId}
        disabled={isPending || !hasSelection}
        type="submit"
      >
        {isPending ? (
          <Spinner aria-hidden="true" data-icon="inline-start" />
        ) : null}
        {isPending ? t("import.pending") : t("import.start")}
      </Button>
      <span className="text-muted-foreground text-xs" id={startHintId}>
        {t(hasSelection ? "import.startHint" : "import.startDisabled")}
      </span>
    </div>
  );
}

function SourceSelection({
  control,
  disabled,
  enrichmentEnabled,
  recentTopics,
  resolveError,
  selectable,
}: FieldProps & {
  enrichmentEnabled: boolean;
  recentTopics: SourceImportsView["recentTopics"];
  selectable: SourceCatalogEntry[];
}) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const { field: sourceIds } = useController({
    control,
    disabled,
    name: "sourceIds",
  });
  const includesTelegram = selectedHasOrigin(
    selectable,
    sourceIds.value,
    "telegram_public",
  );
  const includesRss = selectedHasOrigin(selectable, sourceIds.value, "rss");

  return (
    <>
      <FormField
        control={control}
        disabled={disabled}
        name="sourceIds"
        resolveError={resolveError}
      >
        {({ controlId, field }) => {
          const selected = new Set(field.value);

          return (
            <fieldset className="grid gap-3">
              <legend className="ticket-label" id={controlId}>
                {t("import.sources")}
              </legend>
              {selectable.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("catalog.empty")}
                </p>
              ) : (
                SOURCE_KINDS.map((origin) => {
                  const entries = selectable.filter(
                    (entry) => entry.origin === origin,
                  );
                  if (entries.length === 0) return null;

                  const kindIds = entries.map((entry) => entry.id);
                  const selectedCount = kindIds.filter((id) =>
                    selected.has(id),
                  ).length;
                  const allSelected =
                    kindIds.length > 0 && selectedCount === kindIds.length;
                  const headingId = `${controlId}-${origin}`;

                  return (
                    <section
                      aria-labelledby={headingId}
                      className="grid gap-1"
                      key={origin}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3
                          className="flex min-w-0 items-baseline gap-2"
                          id={headingId}
                        >
                          <span className="ticket-label">
                            {t(`catalog.kind.${origin}`)}
                          </span>
                          <span className="font-mono text-muted-foreground text-xs tabular-nums">
                            {t("import.sourcesHint", {
                              m: kindIds.length,
                              n: selectedCount,
                            })}
                          </span>
                        </h3>
                        <Button
                          aria-pressed={allSelected}
                          className="shrink-0 border border-input bg-background aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary"
                          disabled={disabled}
                          onClick={() => {
                            const next = new Set(selected);
                            for (const id of kindIds) {
                              if (allSelected) next.delete(id);
                              else next.add(id);
                            }
                            field.onChange([...next]);
                          }}
                          size="xs"
                          type="button"
                          variant="ghost"
                        >
                          {t(
                            allSelected
                              ? "import.selectNone"
                              : "import.selectAll",
                          )}
                        </Button>
                      </div>
                      <ul className="max-h-40 overflow-y-auto border border-border border-dashed px-2 py-1">
                        {entries.map((entry) => (
                          <li
                            className="flex items-center gap-2 py-0.5"
                            key={entry.id}
                          >
                            <Checkbox
                              checked={selected.has(entry.id)}
                              disabled={disabled}
                              id={`${controlId}-${entry.id}`}
                              onCheckedChange={(checked) => {
                                const next = new Set(selected);
                                if (checked === true) next.add(entry.id);
                                else next.delete(entry.id);
                                field.onChange([...next]);
                              }}
                            />
                            <label
                              className="min-w-0 truncate text-xs"
                              htmlFor={`${controlId}-${entry.id}`}
                            >
                              <Bdi>{entry.name}</Bdi>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })
              )}
            </fieldset>
          );
        }}
      </FormField>
      {includesTelegram ? (
        <>
          <OrderingField
            control={control}
            disabled={disabled}
            recentTopics={recentTopics}
            resolveError={resolveError}
          />
          <TopNField
            control={control}
            disabled={disabled}
            resolveError={resolveError}
          />
        </>
      ) : null}
      {includesRss ? (
        <FormCheckboxField
          control={control}
          description={t("import.enrichmentHint", {
            state: t(
              enrichmentEnabled
                ? "import.enrichmentOn"
                : "import.enrichmentOff",
            ),
          })}
          disabled={disabled}
          label={t("import.enrichment")}
          name="enrichmentEnabled"
          resolveError={resolveError}
        />
      ) : null}
    </>
  );
}

function RecencyField({ control, disabled, resolveError }: FieldProps) {
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
    <FormField
      control={control}
      disabled={disabled}
      name="windowHours"
      resolveError={resolveError}
    >
      {({ field }) => (
        <fieldset className="grid gap-1">
          <legend className="ticket-label">{t("import.recency.label")}</legend>
          <div className="flex flex-wrap gap-1">
            {IMPORT_WINDOW_HOURS.map((hours) => (
              <Button
                aria-pressed={field.value === hours}
                className="border border-input bg-background font-mono tabular-nums aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary"
                disabled={disabled}
                key={hours}
                onBlur={field.onBlur}
                onClick={() => field.onChange(hours)}
                size="xs"
                type="button"
                variant="ghost"
              >
                {t(`import.recency.${hours}`)}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
    </FormField>
  );
}

function OrderingField({
  control,
  disabled,
  recentTopics,
  resolveError,
}: FieldProps & { recentTopics: readonly string[] }) {
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
    <FormField
      control={control}
      disabled={disabled}
      name="orderingMode"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, field }) => (
        <>
          <label className="ticket-label" htmlFor={controlId}>
            {t("import.ordering.label")}
          </label>
          <select
            {...controlProps}
            className="h-8 rounded-none border border-input bg-background px-2 text-xs"
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) => {
              const selected = TELEGRAM_ORDERING_MODES.find(
                (mode) => mode === event.target.value,
              );
              if (selected) field.onChange(selected);
            }}
            ref={field.ref}
            value={field.value}
          >
            {TELEGRAM_ORDERING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`import.ordering.${mode}`)}
              </option>
            ))}
          </select>
          {field.value === "keywords" ? (
            <TopicsField
              control={control}
              disabled={disabled}
              recentTopics={recentTopics}
              resolveError={resolveError}
            />
          ) : null}
        </>
      )}
    </FormField>
  );
}

function TopNField({ control, disabled, resolveError }: FieldProps) {
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
    <FormField
      control={control}
      description={t("import.topNHint")}
      disabled={disabled}
      name="topN"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, descriptionId, field }) => (
        <>
          <label className="ticket-label" htmlFor={controlId}>
            {t("import.topN")}
          </label>
          <Input
            {...controlProps}
            className="w-24"
            inputMode="numeric"
            max={MAX_TOP_N}
            min={1}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(event) =>
              field.onChange(event.currentTarget.valueAsNumber)
            }
            ref={field.ref}
            type="number"
            value={Number.isNaN(field.value) ? "" : field.value}
          />
          <span className="text-muted-foreground text-xs" id={descriptionId}>
            {t("import.topNHint")}
          </span>
        </>
      )}
    </FormField>
  );
}

function TopicsField({
  control,
  disabled,
  recentTopics,
  resolveError,
}: FieldProps & { recentTopics: readonly string[] }) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const [draft, setDraft] = useState("");

  return (
    <FormField
      control={control}
      description={t("import.topicsHint")}
      disabled={disabled}
      name="topics"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, descriptionId, field }) => {
        const topics = field.value;
        const atCap = topics.length >= MAX_TOPICS;
        const add = (topic: string) => {
          const value = topic.trim().slice(0, MAX_TOPIC_LENGTH);
          if (value === "" || atCap || topics.includes(value)) return;
          field.onChange([...topics, value]);
        };
        const commitDraft = () => {
          add(draft);
          setDraft("");
        };

        return (
          <>
            <label className="ticket-label" htmlFor={controlId}>
              {t("import.topics")}
            </label>
            {topics.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("import.topicsNone")}
              </p>
            ) : (
              <ul className="flex flex-wrap items-center gap-1">
                {topics.map((topic) => (
                  <li
                    className="flex items-center gap-1 border border-input bg-accent ps-2 text-accent-foreground text-xs"
                    key={topic}
                  >
                    <Bdi>{topic}</Bdi>
                    <Button
                      aria-label={t("import.topicsRemove", { topic })}
                      disabled={disabled}
                      onClick={() =>
                        field.onChange(
                          topics.filter((entry) => entry !== topic),
                        )
                      }
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                {...controlProps}
                className="max-w-64 flex-1"
                maxLength={MAX_TOPIC_LENGTH}
                onBlur={field.onBlur}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  commitDraft();
                }}
                ref={field.ref}
                value={draft}
              />
              <Button
                disabled={disabled || atCap || draft.trim() === ""}
                onClick={commitDraft}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("import.topicsAdd")}
              </Button>
              {topics.length > 0 ? (
                <Button
                  disabled={disabled}
                  onClick={() => field.onChange([])}
                  size="sm"
                  type="button"
                  variant="link"
                >
                  {t("import.topicsClear")}
                </Button>
              ) : null}
            </div>
            <span className="text-muted-foreground text-xs" id={descriptionId}>
              {t("import.topicsHint")}
            </span>
            {recentTopics.length > 0 ? (
              <fieldset className="mt-1 grid gap-1">
                <legend className="ticket-label">
                  {t("import.recentTopics")}
                </legend>
                <div className="flex flex-wrap gap-1">
                  {recentTopics.map((topic) => (
                    <Button
                      disabled={disabled || atCap || topics.includes(topic)}
                      key={topic}
                      onClick={() => add(topic)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <Bdi>{topic}</Bdi>
                    </Button>
                  ))}
                </div>
                <span className="text-muted-foreground text-xs">
                  {t("import.recentTopicsHint")}
                </span>
              </fieldset>
            ) : null}
          </>
        );
      }}
    </FormField>
  );
}

function useImportErrorMessage() {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const fallback = useFallbackErrorMessage();

  return (code: string | undefined) =>
    code !== undefined && isOperationErrorCode(code)
      ? t(OPERATION_ERROR_KEYS[code])
      : fallback();
}

function isOperationErrorCode(
  value: string,
): value is keyof typeof OPERATION_ERROR_KEYS {
  return value in OPERATION_ERROR_KEYS;
}
