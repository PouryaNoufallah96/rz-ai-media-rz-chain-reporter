"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  effectiveNewsSourceIds,
  type Platform,
  type RunConfiguration,
  runConfigurationSchema,
  type SourceOrigin,
  TELEGRAM_ORDERING_MODES,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Checkbox } from "@rz-chain-reporter/ui/components/checkbox";
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@rz-chain-reporter/ui/components/field";
import { Input } from "@rz-chain-reporter/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@rz-chain-reporter/ui/components/input-group";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { type Control, useController, useForm } from "react-hook-form";
import { z } from "zod";

import {
  FieldCaption,
  FormCheckboxField,
  FormField,
  FormRootError,
  FormSelectField,
  FormTextareaField,
} from "@/components/form/form-field";
import type { SourceCatalogEntry } from "@/features/sources/schemas/catalog";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { startAnalysisRunAction } from "../actions/start-analysis-run";
import { EDITORIAL_NAMESPACE } from "../constants";
import { useEditorialErrorMessage } from "../hooks/use-editorial-error-message";
import type {
  RunOptions,
  startAnalysisRunInputSchema,
} from "../schemas/workspace";
import { workspaceSearchParsers } from "../schemas/workspace";
import { SHORT_ID_LENGTH } from "./run-selector";

const SOURCE_KINDS: readonly SourceOrigin[] = ["rss", "telegram_public"];

type RunSubmission = z.input<typeof startAnalysisRunInputSchema>;

type RunFormValues = Omit<Extract<RunSubmission, { kind: "news" }>, "kind"> & {
  kind: RunSubmission["kind"];
  promo: Extract<RunSubmission, { kind: "promo" }>["promo"];
};

type RunFormControl = Control<RunFormValues>;

type FieldProps = {
  control: RunFormControl;
  disabled: boolean;
  resolveError: (code: string | undefined, brand?: string) => string;
};

export function RunConfigurationForm({
  options,
  sources,
}: {
  options: RunOptions;
  sources: readonly SourceCatalogEntry[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const resolveError = useEditorialErrorMessage();
  const titleId = useId();
  const [announcement, setAnnouncement] = useState("");
  const [fromRunId, setFromRunId] = useState<string | null>(null);
  const preserved = useRef<{ models: string[]; platforms: Platform[] } | null>(
    null,
  );

  const selectable = sources.filter((entry) => entry.lifecycle === "enabled");
  const telegramSourceIds = selectable.flatMap((entry) =>
    entry.origin === "telegram_public" ? [entry.id] : [],
  );
  const selectableSourceIdSet = new Set(selectable.map((entry) => entry.id));
  const telegramSourceIdSet = new Set(telegramSourceIds);
  const promoBrands = options.brands.filter((brand) => brand.promoEnabled);

  const action = useAction(startAnalysisRunAction);
  const { isPending: isNavigationPending, setValues } = useTransitionUrlState(
    workspaceSearchParsers,
  );
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    getValues,
    handleSubmit,
    reset,
    setError,
    setFocus,
    setValue,
  } = useForm<RunFormValues>({
    defaultValues: initialValues(options, selectable),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    resolver: zodResolver(
      z.custom<RunFormValues>().superRefine((values, ctx) => {
        const parsed = runConfigurationSchema(options.bounds, {
          telegramSourceIds,
        }).safeParse(toConfiguration(values, telegramSourceIds));
        if (parsed.success) return;

        for (const issue of parsed.error.issues) {
          ctx.addIssue({
            code: "custom",
            message: issue.message,
            path: issue.path,
          });
        }
      }),
    ),
  });

  const isPending = isSubmitting || action.isPending || isNavigationPending;
  const { field: kind } = useController({
    control,
    name: "kind",
  });

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(
      toConfiguration(values, telegramSourceIds),
    );

    if (result.status === "error") {
      applyActionErrorToForm(setError, result, setFocus);
      return;
    }

    await setValues({ run: null });
  });

  const loadPreviousRun = () => {
    const previous = options.previousRun;
    if (!previous) return;

    const previousValues = toFormValues(previous.configuration, getValues());
    reset(
      previousValues.kind === "news"
        ? {
            ...previousValues,
            sourceIds: previousValues.sourceIds.filter((sourceId) =>
              selectableSourceIdSet.has(sourceId),
            ),
            telegramOnly:
              previousValues.telegramOnly &&
              previousValues.sourceIds.some((sourceId) =>
                telegramSourceIdSet.has(sourceId),
              ),
          }
        : previousValues,
    );
    preserved.current = null;
    setFromRunId(previous.id);
    setAnnouncement(
      previous.dropped.length > 0
        ? t("run.usePrevious.partial", { n: previous.dropped.length })
        : t("run.usePrevious.loaded"),
    );
  };

  const toggleTelegramOnly = (
    checked: boolean,
    commit: (value: boolean) => void,
  ) => {
    if (checked) {
      preserved.current = {
        models: getValues("models"),
        platforms: getValues("platforms"),
      };
      setAnnouncement(t("run.telegramOnly.preserved"));
    } else if (preserved.current) {
      const liveModels = new Set(options.models.map((model) => model.key));
      const livePlatforms = new Set<string>(options.platforms);
      const models = preserved.current.models.filter((model) =>
        liveModels.has(model),
      );
      const platforms = preserved.current.platforms.filter((platform) =>
        livePlatforms.has(platform),
      );
      const dropped =
        preserved.current.models.length -
        models.length +
        (preserved.current.platforms.length - platforms.length);

      if (models.length > 0) setValue("models", models);
      if (platforms.length > 0) setValue("platforms", platforms);
      preserved.current = null;
      setAnnouncement(
        dropped > 0
          ? t("run.telegramOnly.restoredWithDrops", { n: dropped })
          : t("run.telegramOnly.restored"),
      );
    }

    commit(checked);
  };

  const reconcileTelegramOnly = (sourceIds: readonly string[]) => {
    if (!getValues("telegramOnly")) return;
    if (sourceIds.some((sourceId) => telegramSourceIdSet.has(sourceId))) {
      return;
    }

    toggleTelegramOnly(false, (checked) =>
      setValue("telegramOnly", checked, {
        shouldDirty: true,
        shouldValidate: true,
      }),
    );
  };

  return (
    <section aria-labelledby={titleId} className="border border-border p-4">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("run.title")}
      </h2>
      <form
        aria-busy={isPending}
        className="mt-3"
        noValidate
        onSubmit={onSubmit}
      >
        <FieldGroup>
          <KindField
            control={control}
            disabled={isPending}
            resolveError={resolveError}
          />
          {kind.value === "promo" ? (
            <PromoFields
              control={control}
              disabled={isPending}
              models={options.models}
              promoBrands={promoBrands}
              resolveError={resolveError}
            />
          ) : (
            <NewsFields
              announce={setAnnouncement}
              control={control}
              disabled={isPending}
              onSourceIdsChange={reconcileTelegramOnly}
              onToggleTelegramOnly={toggleTelegramOnly}
              options={options}
              resolveError={resolveError}
              selectable={selectable}
            />
          )}
          <FormRootError
            message={
              errors.root?.server
                ? resolveError(errors.root.server.message)
                : undefined
            }
          />
          <p className="sr-only" role="status">
            {announcement}
          </p>
          <div className="mt-1 flex flex-col gap-2 border-border border-t border-dashed pt-3 sm:flex-row sm:items-center sm:justify-between">
            <StartRunControl
              control={control}
              isPending={isPending}
              promoBrands={promoBrands}
            />
            <span className="flex flex-wrap items-center gap-2">
              <Button
                disabled={isPending || options.previousRun === null}
                onClick={loadPreviousRun}
                size="sm"
                type="button"
                variant="link"
              >
                {t("run.usePrevious.label")}
              </Button>
              {options.previousRun === null ? (
                <span className="text-muted-foreground text-xs">
                  {t("run.usePrevious.none")}
                </span>
              ) : null}
              {fromRunId ? (
                <span className="font-mono text-muted-foreground text-xs">
                  {t("run.usePrevious.from", {
                    id: fromRunId.slice(0, SHORT_ID_LENGTH),
                  })}
                </span>
              ) : null}
            </span>
          </div>
        </FieldGroup>
      </form>
    </section>
  );
}

function StartRunControl({
  control,
  isPending,
  promoBrands,
}: {
  control: RunFormControl;
  isPending: boolean;
  promoBrands: RunOptions["brands"];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { field } = useController({ control, name: "kind" });
  const noPromoBrand = field.value === "promo" && promoBrands.length === 0;

  return (
    <div className="grid w-full gap-2 sm:w-auto">
      {noPromoBrand ? (
        <p className="text-muted-foreground text-xs">
          {t("run.promo.noEligibleBrand")}
        </p>
      ) : null}
      <Button
        className="w-full sm:w-auto"
        disabled={isPending || noPromoBrand}
        type="submit"
      >
        {isPending ? <Spinner data-icon="inline-start" /> : null}
        {isPending ? t("run.starting") : t("run.start")}
      </Button>
    </div>
  );
}

function PromoFields({
  control,
  disabled,
  models,
  promoBrands,
  resolveError,
}: FieldProps & {
  models: RunOptions["models"];
  promoBrands: RunOptions["brands"];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { field: brands } = useController({
    control,
    name: "promo.brands",
  });
  const selected = new Set(brands.value);

  return (
    <>
      <CheckboxListField
        control={control}
        disabled={disabled}
        legend={t("run.brands")}
        name="promo.brands"
        options={promoBrands.map((brand) => ({
          label: brand.name,
          value: brand.key,
        }))}
        resolveError={resolveError}
      />
      <CheckboxListField
        control={control}
        disabled={disabled}
        legend={t("run.models")}
        name="models"
        options={models.map((model) => ({
          label: model.name,
          value: model.key,
        }))}
        resolveError={resolveError}
      />
      {promoBrands.map((brand) =>
        selected.has(brand.key) ? (
          <PromptField
            brand={brand}
            control={control}
            disabled={disabled}
            key={brand.key}
            resolveError={resolveError}
          />
        ) : null,
      )}
    </>
  );
}

function NewsFields({
  announce,
  control,
  disabled,
  onSourceIdsChange,
  onToggleTelegramOnly,
  options,
  resolveError,
  selectable,
}: FieldProps & {
  announce: (message: string) => void;
  onSourceIdsChange: (sourceIds: readonly string[]) => void;
  onToggleTelegramOnly: (
    checked: boolean,
    commit: (value: boolean) => void,
  ) => void;
  options: RunOptions;
  selectable: readonly SourceCatalogEntry[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { field: telegramOnly } = useController({
    control,
    name: "telegramOnly",
  });

  return (
    <>
      <CheckboxListField
        control={control}
        disabled={disabled}
        legend={t("run.brands")}
        name="brands"
        options={options.brands.map((brand) => ({
          label: brand.name,
          value: brand.key,
        }))}
        resolveError={resolveError}
      />
      {telegramOnly.value ? (
        <p className="text-muted-foreground text-xs">
          {t("run.telegramOnly.preserved")}
        </p>
      ) : (
        <>
          <CheckboxListField
            control={control}
            disabled={disabled}
            legend={t("run.models")}
            name="models"
            options={options.models.map((model) => ({
              label: model.name,
              value: model.key,
            }))}
            resolveError={resolveError}
          />
          <CheckboxListField
            control={control}
            disabled={disabled}
            legend={t("run.platforms")}
            name="platforms"
            options={options.platforms.map((platform) => ({
              label: t(`run.platform.${platform}`),
              value: platform,
            }))}
            resolveError={resolveError}
          />
        </>
      )}
      <SourceSubsetField
        control={control}
        disabled={disabled}
        onSourceIdsChange={onSourceIdsChange}
        onToggleTelegramOnly={onToggleTelegramOnly}
        resolveError={resolveError}
        selectable={selectable}
      />
      <RecencyField
        control={control}
        disabled={disabled}
        resolveError={resolveError}
        windowHours={options.windowHours}
      />
      <EnrichmentField
        control={control}
        disabled={disabled}
        resolveError={resolveError}
      />
      <TopicsField
        announce={announce}
        control={control}
        disabled={disabled}
        recentTopics={options.recentTopics}
        resolveError={resolveError}
      />
      <TopNField
        control={control}
        disabled={disabled}
        max={options.bounds.selectionCap}
        resolveError={resolveError}
      />
    </>
  );
}

function KindField({ control, disabled, resolveError }: FieldProps) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormField
      control={control}
      disabled={disabled}
      name="kind"
      resolveError={resolveError}
    >
      {({ field }) => (
        <>
          <FieldLegend className="ticket-label mb-0" variant="label">
            {t("run.kind.label")}
          </FieldLegend>
          <div className="flex flex-wrap gap-1">
            {(["news", "promo"] as const).map((value) => (
              <Button
                aria-pressed={field.value === value}
                className="border border-input bg-background aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary"
                disabled={disabled}
                key={value}
                onBlur={field.onBlur}
                onClick={() => field.onChange(value)}
                size="xs"
                type="button"
                variant="ghost"
              >
                {t(`run.kind.${value}`)}
              </Button>
            ))}
          </div>
        </>
      )}
    </FormField>
  );
}

function CheckboxListField({
  control,
  disabled,
  legend,
  name,
  options,
  resolveError,
}: FieldProps & {
  legend: string;
  name: "brands" | "models" | "platforms" | "promo.brands";
  options: readonly { label: string; value: string }[];
}) {
  return (
    <FormField
      control={control}
      disabled={disabled}
      name={name}
      resolveError={resolveError}
    >
      {({ controlId, field }) => {
        const selected = new Set(field.value);

        return (
          <>
            <FieldLegend
              className="ticket-label mb-0"
              id={controlId}
              variant="label"
            >
              {legend}
            </FieldLegend>
            <ul className="grid gap-0.5 sm:grid-cols-2">
              {options.map((option) => (
                <li className="flex items-center gap-2" key={option.value}>
                  <Checkbox
                    checked={selected.has(option.value)}
                    disabled={disabled}
                    id={`${controlId}-${option.value}`}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected);
                      if (checked === true) next.add(option.value);
                      else next.delete(option.value);
                      field.onChange([...next]);
                    }}
                  />
                  <FieldLabel
                    className="min-w-0 truncate font-normal"
                    htmlFor={`${controlId}-${option.value}`}
                  >
                    <Bdi>{option.label}</Bdi>
                  </FieldLabel>
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </FormField>
  );
}

function SourceSubsetField({
  control,
  disabled,
  onSourceIdsChange,
  onToggleTelegramOnly,
  resolveError,
  selectable,
}: FieldProps & {
  onSourceIdsChange: (sourceIds: readonly string[]) => void;
  onToggleTelegramOnly: (
    checked: boolean,
    commit: (value: boolean) => void,
  ) => void;
  selectable: readonly SourceCatalogEntry[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { field: sourceIds } = useController({
    control,
    name: "sourceIds",
  });
  const includesTelegram = selectable.some(
    (entry) =>
      entry.origin === "telegram_public" && sourceIds.value.includes(entry.id),
  );

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
                className="ticket-label mb-0"
                id={controlId}
                variant="label"
              >
                {t("run.sources.label")}
              </FieldLegend>
              {SOURCE_KINDS.map((origin) => {
                const entries = selectable.filter(
                  (entry) => entry.origin === origin,
                );
                if (entries.length === 0) return null;

                const kindIds = entries.map((entry) => entry.id);
                const selectedCount = kindIds.filter((id) =>
                  selected.has(id),
                ).length;
                const allSelected = selectedCount === kindIds.length;
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
                          {t(`run.sources.kind.${origin}`)}
                        </span>
                        <span className="font-mono text-muted-foreground text-xs tabular-nums">
                          {t("run.sources.selected", {
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
                          const nextIds = [...next];
                          field.onChange(nextIds);
                          onSourceIdsChange(nextIds);
                        }}
                        size="xs"
                        type="button"
                        variant="ghost"
                      >
                        {t(
                          allSelected
                            ? "run.sources.selectNone"
                            : "run.sources.selectAll",
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
                              const nextIds = [...next];
                              field.onChange(nextIds);
                              onSourceIdsChange(nextIds);
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
                  </section>
                );
              })}
            </>
          );
        }}
      </FormField>
      {includesTelegram ? (
        <>
          <OrderingField
            control={control}
            disabled={disabled}
            resolveError={resolveError}
          />
          <TelegramOnlyField
            control={control}
            disabled={disabled}
            onToggle={onToggleTelegramOnly}
            resolveError={resolveError}
          />
        </>
      ) : null}
    </>
  );
}

function RecencyField({
  control,
  disabled,
  resolveError,
  windowHours,
}: FieldProps & { windowHours: RunOptions["windowHours"] }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormField
      control={control}
      disabled={disabled}
      name="windowHours"
      resolveError={resolveError}
    >
      {({ field }) => (
        <>
          <FieldLegend className="ticket-label mb-0" variant="label">
            {t("run.recency.label")}
          </FieldLegend>
          <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
            {windowHours.map((hours) => (
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
                {t(`run.recency.${hours}`)}
              </Button>
            ))}
          </div>
        </>
      )}
    </FormField>
  );
}

function EnrichmentField({ control, disabled, resolveError }: FieldProps) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormCheckboxField
      control={control}
      disabled={disabled}
      label={t("run.enrichment")}
      name="enrichmentEnabled"
      resolveError={resolveError}
    />
  );
}

function TelegramOnlyField({
  control,
  disabled,
  onToggle,
  resolveError,
}: FieldProps & {
  onToggle: (checked: boolean, commit: (value: boolean) => void) => void;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormField
      control={control}
      disabled={disabled}
      name="telegramOnly"
      orientation="horizontal"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, field }) => (
        <>
          <Checkbox
            {...controlProps}
            checked={field.value === true}
            name={field.name}
            onBlur={field.onBlur}
            onCheckedChange={(checked) =>
              onToggle(checked === true, field.onChange)
            }
            ref={field.ref}
          />
          <FieldCaption htmlFor={controlId}>
            {t("run.telegram.only")}
          </FieldCaption>
        </>
      )}
    </FormField>
  );
}

function OrderingField({ control, disabled, resolveError }: FieldProps) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormSelectField
      control={control}
      disabled={disabled}
      label={t("run.telegram.ordering.label")}
      name="orderingMode"
      options={TELEGRAM_ORDERING_MODES.map((mode) => ({
        label: t(`run.telegram.ordering.${mode}`),
        value: mode,
      }))}
      resolveError={resolveError}
    />
  );
}

function TopNField({
  control,
  disabled,
  max,
  resolveError,
}: FieldProps & { max: number }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormField
      control={control}
      description={t("run.topNHint", { max })}
      disabled={disabled}
      name="topN"
      resolveError={resolveError}
    >
      {({ controlId, controlProps, descriptionId, field }) => (
        <>
          <FieldCaption htmlFor={controlId}>{t("run.topN")}</FieldCaption>
          <Input
            {...controlProps}
            className="w-24"
            inputMode="numeric"
            max={max}
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
          <FieldDescription id={descriptionId}>
            {t("run.topNHint", { max })}
          </FieldDescription>
        </>
      )}
    </FormField>
  );
}

function PromptField({
  brand,
  control,
  disabled,
  resolveError,
}: FieldProps & { brand: { key: string; name: string } }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);

  return (
    <FormTextareaField
      control={control}
      disabled={disabled}
      label={t("run.promo.prompt", { brand: brand.name })}
      name={`promo.prompts.${brand.key}`}
      resolveError={(code) => resolveError(code, brand.name)}
      rows={3}
    />
  );
}

function TopicsField({
  announce,
  control,
  disabled,
  recentTopics,
  resolveError,
}: FieldProps & {
  announce: (message: string) => void;
  recentTopics: readonly string[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const [draft, setDraft] = useState("");

  return (
    <FormField
      control={control}
      description={t("run.topics.hint")}
      disabled={disabled}
      name="topics"
      resolveError={(code) => (code === undefined ? "" : resolveError(code))}
    >
      {({ controlId, controlProps, descriptionId, field, fieldState }) => {
        const topics = field.value;
        // A per-topic issue lands at `topics.<i>`, which the shared field error
        // region cannot reach; the offending chip carries it instead.
        const topicErrors = Array.isArray(fieldState.error)
          ? fieldState.error
          : undefined;
        const add = (topic: string) => {
          const value = topic.trim();
          if (value === "" || topics.includes(value)) return;
          field.onChange([...topics, value]);
        };
        const commitDraft = () => {
          add(draft);
          setDraft("");
        };

        return (
          <>
            <FieldCaption htmlFor={controlId}>
              {t("run.topics.label")}
            </FieldCaption>
            {topics.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("run.topics.none")}
              </p>
            ) : (
              <ul className="flex flex-wrap items-start gap-1">
                {topics.map((topic, index) => (
                  <li className="grid gap-0.5" key={topic}>
                    <span className="flex items-center gap-1 border border-input bg-accent ps-2 text-accent-foreground text-xs">
                      <Bdi className="max-w-48 truncate">{topic}</Bdi>
                      <Button
                        aria-label={t("run.topics.remove", { topic })}
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
                    </span>
                    {topicErrors?.[index] ? (
                      <span className="text-destructive text-xs">
                        {resolveError(topicErrors[index]?.message)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="max-w-64 flex-1">
                <InputGroupInput
                  {...controlProps}
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
                    disabled={disabled || draft.trim() === ""}
                    onClick={commitDraft}
                  >
                    {t("run.topics.add")}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {topics.length > 0 ? (
                <Button
                  disabled={disabled}
                  onClick={() => {
                    field.onChange([]);
                    announce(t("run.topics.cleared"));
                  }}
                  size="sm"
                  type="button"
                  variant="link"
                >
                  {t("run.topics.clear")}
                </Button>
              ) : null}
            </div>
            <FieldDescription id={descriptionId}>
              {t("run.topics.hint")}
            </FieldDescription>
            {recentTopics.length > 0 ? (
              <FieldSet className="mt-1 grid gap-1">
                <FieldLegend className="ticket-label mb-0" variant="label">
                  {t("run.topics.recent")}
                </FieldLegend>
                <div className="flex flex-wrap gap-1">
                  {recentTopics.map((topic) => (
                    <Button
                      disabled={disabled || topics.includes(topic)}
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
                <FieldDescription>
                  {t("run.topics.recentHint")}
                </FieldDescription>
              </FieldSet>
            ) : null}
          </>
        );
      }}
    </FormField>
  );
}

function initialValues(
  options: RunOptions,
  selectable: readonly SourceCatalogEntry[],
): RunFormValues {
  const sourceKeys = options.defaults.sourceKeys;
  const defaultKeys = sourceKeys ? new Set<string>(sourceKeys) : null;
  const defaultSources = defaultKeys
    ? selectable.filter((entry) => defaultKeys.has(entry.key))
    : selectable;

  return {
    kind: "news",
    brands: [...options.defaults.brands],
    models: [...options.defaults.models],
    platforms: [...options.defaults.platforms],
    sourceIds: defaultSources.map((entry) => entry.id),
    windowHours: options.defaults.windowHours,
    enrichmentEnabled: options.defaults.enrichment,
    telegramOnly: false,
    orderingMode: options.defaults.orderingMode,
    topN: options.defaults.topN,
    topics: [],
    promo: { brands: [], prompts: {} },
  };
}

// The one owner of the branch projection: the resolver and the submitted
// payload are the same strict object.
function toConfiguration(
  values: RunFormValues,
  telegramSourceIds: readonly string[],
): RunSubmission {
  if (values.kind === "promo") {
    return {
      kind: "promo",
      models: values.models,
      promo: {
        brands: values.promo.brands,
        prompts: promptsOf(values.promo),
      },
    };
  }

  const { promo, ...news } = values;

  return {
    ...news,
    kind: "news",
    sourceIds: effectiveNewsSourceIds(
      { ...news, kind: "news" },
      telegramSourceIds,
    ),
  };
}

function toFormValues(
  configuration: RunConfiguration,
  current: RunFormValues,
): RunFormValues {
  if (configuration.kind === "promo") {
    return {
      ...current,
      kind: "promo",
      models: configuration.models,
      promo: {
        brands: configuration.promo.brands,
        prompts: promptsOf(configuration.promo),
      },
    };
  }

  return { ...current, ...configuration };
}

// A prompt the operator never touched is absent from form state, and a brand
// they deselected leaves a stale one behind; neither boundary should see either.
function promptsOf(promo: {
  brands: readonly string[];
  prompts: Readonly<Record<string, string | undefined>>;
}): Record<string, string> {
  const prompts: Record<string, string> = {};

  for (const brand of promo.brands) {
    prompts[brand] = promo.prompts[brand] ?? "";
  }

  return prompts;
}
