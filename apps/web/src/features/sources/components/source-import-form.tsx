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
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
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

const importFormSchema = startSourceImportInputSchema.omit({ topics: true });

type ImportFormValues = z.input<typeof importFormSchema>;

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
  const [topicsText, setTopicsText] = useState("");

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
      enrichmentEnabled: imports.defaults.enrichmentEnabled,
    },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    resolver: zodResolver(importFormSchema),
  });

  const orderingMode = useWatch({ control, name: "orderingMode" });
  const sourceIds = useWatch({ control, name: "sourceIds" });
  const hasSelection = sourceIds.length > 0;
  const selectedIds = new Set(sourceIds);
  const includesRss = selectable.some(
    (entry) => entry.origin === "rss" && selectedIds.has(entry.id),
  );
  const includesTelegram = selectable.some(
    (entry) => entry.origin === "telegram_public" && selectedIds.has(entry.id),
  );
  const isPending = isSubmitting || action.isPending;

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(
      includesTelegram
        ? { ...values, topics: parseTopics(topicsText) }
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
            resolveError={resolveError}
            selectable={selectable}
          />
          <RecencyField
            control={control}
            disabled={isPending}
            resolveError={resolveError}
          />
          {includesTelegram ? (
            <>
              <OrderingField
                control={control}
                disabled={isPending}
                resolveError={resolveError}
              />
              <TopNField
                control={control}
                disabled={isPending}
                resolveError={resolveError}
              />
              {orderingMode === "keywords" ? (
                <TopicsField
                  disabled={isPending}
                  onChange={setTopicsText}
                  recentTopics={imports.recentTopics}
                  value={topicsText}
                />
              ) : null}
            </>
          ) : null}
          {includesRss ? (
            <FormCheckboxField
              control={control}
              description={t("import.enrichmentHint", {
                state: t(
                  imports.defaults.enrichmentEnabled
                    ? "import.enrichmentOn"
                    : "import.enrichmentOff",
                ),
              })}
              disabled={isPending}
              label={t("import.enrichment")}
              name="enrichmentEnabled"
              resolveError={resolveError}
            />
          ) : null}
          <FormRootError
            message={
              errors.root?.server
                ? resolveError(errors.root.server.message)
                : undefined
            }
          />
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
        </FieldGroup>
      </form>
    </section>
  );
}

function SourceSelection({
  control,
  disabled,
  resolveError,
  selectable,
}: FieldProps & { selectable: SourceCatalogEntry[] }) {
  const t = useTranslations(SOURCES_NAMESPACE);

  return (
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
                        className="shrink-0 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
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
                        variant="outline"
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
              <label
                className="cursor-pointer border border-input px-2 py-1 font-mono text-xs tabular-nums has-[input:checked]:bg-accent has-[input:checked]:text-accent-foreground has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-ring"
                key={hours}
              >
                <input
                  checked={field.value === hours}
                  className="sr-only"
                  disabled={disabled}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={() => field.onChange(hours)}
                  type="radio"
                  value={hours}
                />
                {t(`import.recency.${hours}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </FormField>
  );
}

function OrderingField({ control, disabled, resolveError }: FieldProps) {
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
  disabled,
  onChange,
  recentTopics,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  recentTopics: readonly string[];
  value: string;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const fieldId = useId();

  return (
    <div className="grid gap-1">
      <label className="ticket-label" htmlFor={fieldId}>
        {t("import.topics")}
      </label>
      <Input
        aria-describedby={`${fieldId}-hint`}
        disabled={disabled}
        id={fieldId}
        maxLength={MAX_TOPICS * (MAX_TOPIC_LENGTH + 2)}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
      <span className="text-muted-foreground text-xs" id={`${fieldId}-hint`}>
        {t("import.topicsHint")}
      </span>
      {recentTopics.length > 0 ? (
        <fieldset className="mt-1 grid gap-1">
          <legend className="ticket-label">{t("import.recentTopics")}</legend>
          <div className="flex flex-wrap gap-1">
            {recentTopics.map((topic) => (
              <Button
                disabled={disabled}
                key={topic}
                onClick={() =>
                  onChange(value.trim() === "" ? topic : `${value}, ${topic}`)
                }
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
    </div>
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

function parseTopics(text: string) {
  const topics = new Set<string>();

  for (const raw of text.split(",")) {
    const topic = raw.trim().slice(0, MAX_TOPIC_LENGTH);
    if (topic !== "" && topics.size < MAX_TOPICS) topics.add(topic);
  }

  return [...topics];
}
