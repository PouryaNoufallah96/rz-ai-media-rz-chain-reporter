"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  SOURCE_ORIGINS,
  type SourceOrigin,
  TELEGRAM_ORDERING_MODES,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card } from "@rz-chain-reporter/ui/components/card";
import { Checkbox } from "@rz-chain-reporter/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rz-chain-reporter/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rz-chain-reporter/ui/components/input-group";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type Control,
  useController,
  useForm,
  useWatch,
} from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  FieldCaption,
  FormField,
  FormNumberField,
  FormRootError,
  FormSelectField,
  FormSwitchField,
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
    const telegramSelected = selectedHasOrigin(
      selectable,
      values.sourceIds,
      "telegram_public",
    );
    const submitted = telegramSelected
      ? {
          ...values,
          topics: values.orderingMode === "keywords" ? values.topics : [],
        }
      : {
          ...values,
          orderingMode: imports.defaults.orderingMode,
          topN: imports.defaults.topN,
          topics: [],
        };
    const result = await action.execute(submitted);

    if (result.status === "error") {
      applyActionErrorToForm(setError, result, setFocus);
      return;
    }

    toast.success(t("import.started"));
  });

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <Card className="gap-0 border p-4 ring-0 sm:p-5">
        <h2 className="border-b pb-3 font-medium text-sm" id={titleId}>
          {t("import.title")}
        </h2>
        <form
          aria-busy={isPending}
          className="mt-4"
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
      </Card>
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
    <div className="flex flex-wrap items-center gap-3 border-t pt-4">
      <Button
        aria-describedby={startHintId}
        disabled={isPending || !hasSelection}
        type="submit"
      >
        {isPending ? <Spinner data-icon="inline-start" /> : null}
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
            <>
              <FieldLegend
                className="ticket-label"
                id={controlId}
                variant="label"
              >
                {t("import.sources")}
              </FieldLegend>
              {selectable.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("catalog.empty")}
                </p>
              ) : (
                SOURCE_ORIGINS.map((origin) => {
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
                      className="min-w-0"
                      key={origin}
                    >
                      <Collapsible
                        defaultOpen
                        className="rounded-lg border bg-muted/20"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2">
                          <h3 className="min-w-0" id={headingId}>
                            <CollapsibleTrigger
                              render={
                                <Button
                                  className="group h-auto flex-wrap justify-start"
                                  size="xs"
                                  variant="ghost"
                                />
                              }
                            >
                              <ChevronDownIcon className="transition-transform group-data-panel-open:rotate-180" />
                              <span className="ticket-label">
                                {t(`catalog.kind.${origin}`)}
                              </span>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {t("import.sourcesHint", {
                                  m: kindIds.length,
                                  n: selectedCount,
                                })}
                              </span>
                            </CollapsibleTrigger>
                          </h3>
                          <Button
                            aria-pressed={allSelected}
                            className="shrink-0"
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
                            variant={allSelected ? "secondary" : "outline"}
                          >
                            {t(
                              allSelected
                                ? "import.selectNone"
                                : "import.selectAll",
                            )}
                          </Button>
                        </div>
                        <CollapsibleContent
                          keepMounted
                          className="data-closed:hidden"
                        >
                          <ul className="max-h-44 overflow-y-auto border-t px-3 py-2">
                            {entries.map((entry) => (
                              <li
                                className="flex min-h-9 items-center gap-2 py-1"
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
                                <FieldLabel
                                  className="min-w-0 truncate font-normal"
                                  htmlFor={`${controlId}-${entry.id}`}
                                >
                                  <Bdi>{entry.name}</Bdi>
                                </FieldLabel>
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    </section>
                  );
                })
              )}
            </>
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
          <FormNumberField
            control={control}
            description={t("import.topNHint")}
            disabled={disabled}
            label={t("import.topN")}
            max={MAX_TOP_N}
            name="topN"
            resolveError={resolveError}
          />
        </>
      ) : null}
      {includesRss ? (
        <FormSwitchField
          className="rounded-lg border bg-muted/20 p-3"
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
        <>
          <FieldLegend className="ticket-label" variant="label">
            {t("import.recency.label")}
          </FieldLegend>
          <div className="flex flex-wrap gap-1">
            {IMPORT_WINDOW_HOURS.map((hours) => (
              <Button
                aria-pressed={field.value === hours}
                className="tabular-nums"
                disabled={disabled}
                key={hours}
                onBlur={field.onBlur}
                onClick={() => field.onChange(hours)}
                size="xs"
                type="button"
                variant={field.value === hours ? "secondary" : "outline"}
              >
                {t(`import.recency.${hours}`)}
              </Button>
            ))}
          </div>
        </>
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
  const orderingMode = useWatch({ control, name: "orderingMode" });

  return (
    <>
      <FormSelectField
        control={control}
        disabled={disabled}
        label={t("import.ordering.label")}
        name="orderingMode"
        options={TELEGRAM_ORDERING_MODES.map((mode) => ({
          label: t(`import.ordering.${mode}`),
          value: mode,
        }))}
        resolveError={resolveError}
      />
      {orderingMode === "keywords" ? (
        <TopicsField
          control={control}
          disabled={disabled}
          recentTopics={recentTopics}
          resolveError={resolveError}
        />
      ) : null}
    </>
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
      {({ controlId, controlProps, descriptionNode, field }) => {
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
            <FieldCaption htmlFor={controlId}>
              {t("import.topics")}
            </FieldCaption>
            {topics.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("import.topicsNone")}
              </p>
            ) : (
              <ul className="flex flex-wrap items-center gap-1">
                {topics.map((topic) => (
                  <li
                    className="flex max-w-full items-center gap-1 rounded-md border bg-muted ps-2 text-xs"
                    key={topic}
                  >
                    <Bdi className="wrap-anywhere">{topic}</Bdi>
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
              <InputGroup className="max-w-64 flex-1">
                <InputGroupInput
                  {...controlProps}
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
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    disabled={disabled || atCap || draft.trim() === ""}
                    onClick={commitDraft}
                  >
                    {t("import.topicsAdd")}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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
            {descriptionNode}
            {recentTopics.length > 0 ? (
              <FieldSet className="mt-1 grid gap-1">
                <FieldLegend className="ticket-label" variant="label">
                  {t("import.recentTopics")}
                </FieldLegend>
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
                      <Bdi className="wrap-anywhere">{topic}</Bdi>
                    </Button>
                  ))}
                </div>
                <FieldDescription>
                  {t("import.recentTopicsHint")}
                </FieldDescription>
              </FieldSet>
            ) : null}
          </>
        );
      }}
    </FormField>
  );
}

function useImportErrorMessage() {
  const t = useTranslations(SOURCES_NAMESPACE);
  const tOperations = useTranslations(OPERATIONS_NAMESPACE);
  const fallback = useFallbackErrorMessage();

  return (code: string | undefined) => {
    if (code === "NO_SOURCES") return t("import.noSources");
    return code !== undefined && isOperationErrorCode(code)
      ? tOperations(OPERATION_ERROR_KEYS[code])
      : fallback();
  };
}

function isOperationErrorCode(
  value: string,
): value is keyof typeof OPERATION_ERROR_KEYS {
  return value in OPERATION_ERROR_KEYS;
}
