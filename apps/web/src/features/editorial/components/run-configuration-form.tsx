"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  effectiveNewsSourceIds,
  type Platform,
  type RunConfiguration,
  runConfigurationSchema,
  type runConfigurationTransportSchema,
  SOURCE_ORIGINS,
  TELEGRAM_ORDERING_MODES,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Checkbox } from "@rz-chain-reporter/ui/components/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@rz-chain-reporter/ui/components/combobox";
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
import { MetalButton } from "@rz-chain-reporter/ui/components/metal-button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import { type Control, useController, useForm } from "react-hook-form";
import { z } from "zod";
import { BrandMark } from "@/components/common/brand-mark";
import { ModelIcon } from "@/components/common/model-icon";
import { PlatformIcon } from "@/components/common/platform-icon";
import { SourceOriginIcon } from "@/components/common/source-origin-icon";
import {
  FieldCaption,
  FormField,
  type FormFieldRenderProps,
  FormNumberField,
  FormRootError,
  FormSelectField,
  FormSwitchField,
  FormTextareaField,
} from "@/components/form/form-field";
import { operationCreated } from "@/features/operations/lib/focus-operation";
import type { SourceCatalogEntry } from "@/features/sources/schemas/catalog";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { startAnalysisRunAction } from "../actions/commands";
import { EDITORIAL_NAMESPACE } from "../constants";
import { useEditorialErrorMessage } from "../hooks/use-editorial-error-message";
import type { BoardPresentation } from "../lib/board-presentation";
import type { RunOptions } from "../schemas/workspace";
import { workspaceSearchParsers } from "../schemas/workspace";

type RunSubmission = z.input<typeof runConfigurationTransportSchema>;

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
  initialConfiguration,
  onPresentationChange,
  options,
  runInProgress,
  sources,
}: {
  initialConfiguration: RunConfiguration | null;
  onPresentationChange: (presentation: BoardPresentation) => void;
  options: RunOptions;
  runInProgress: boolean;
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
  const hasExcludableSource = selectable.length > telegramSourceIds.length;
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
    subscribe,
  } = useForm<RunFormValues>({
    defaultValues: initialValues(options, selectable, initialConfiguration),
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
            path: issue.path.length > 0 ? issue.path : ["root", "server"],
          });
        }
      }),
    ),
  });

  const isPending = isSubmitting || action.isPending || isNavigationPending;
  const isBusy = isPending || runInProgress;
  const { field: kind } = useController({
    control,
    name: "kind",
  });
  const publish = useEffectEvent((values: RunFormValues) =>
    onPresentationChange({
      brandKeys: values.kind === "promo" ? values.promo.brands : values.brands,
      kind: values.kind,
      modelKeys: values.models,
      platforms: values.platforms,
      telegramOnly: values.kind === "news" && values.telegramOnly,
    }),
  );

  useEffect(
    () =>
      subscribe({
        callback: ({ values }) => publish(values),
        formState: { values: true },
        name: [
          "kind",
          "brands",
          "promo.brands",
          "models",
          "platforms",
          "telegramOnly",
        ],
      }),
    [subscribe],
  );

  const onSubmit = handleSubmit(async (values) => {
    clearErrors("root");
    action.reset();
    const result = await action.execute(
      toConfiguration(values, telegramSourceIds),
    );

    if (result.status !== "success" || !result.data) {
      applyActionErrorToForm(setError, result, setFocus);
      return;
    }

    operationCreated(result.data.operationId);
    await setValues(
      { draft: null, run: result.data.analysisRunId },
      { history: "push" },
    );
  });

  const loadPreviousRun = () => {
    const previous = options.previousRun;
    if (!previous) return;

    const previousValues = toFormValues(
      previous.configuration,
      getValues(),
      options.platforms,
    );
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
      setAnnouncement(
        t(
          hasExcludableSource
            ? "run.telegramOnly.preservedWithSources"
            : "run.telegramOnly.preserved",
        ),
      );
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
    <section aria-labelledby={titleId} className="min-w-0">
      <h2 className="sr-only" id={titleId}>
        {t("run.title")}
      </h2>
      <form
        aria-busy={isBusy}
        className="max-sm:**:data-[slot=input-group-control]:min-h-11 max-sm:**:data-[slot=input-group]:min-h-11 max-sm:**:data-[slot=input]:min-h-11 max-sm:**:data-[slot=select-trigger]:min-h-11 max-sm:**:data-[slot=checkbox]:after:-inset-3.75 max-sm:[&_button]:min-h-11 max-sm:[&_button]:min-w-11 max-sm:[&_li]:min-h-11 max-sm:[&_summary]:min-h-11"
        noValidate
        onSubmit={onSubmit}
      >
        <FieldGroup>
          <KindField
            control={control}
            disabled={isBusy}
            resolveError={resolveError}
          />
          {kind.value === "promo" ? (
            <PromoFields
              control={control}
              disabled={isBusy}
              models={options.models}
              platforms={options.platforms}
              promoBrands={promoBrands}
              resolveError={resolveError}
            />
          ) : (
            <NewsFields
              announce={setAnnouncement}
              control={control}
              disabled={isBusy}
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
          <RunFooter
            control={control}
            fromPreviousRun={Boolean(fromRunId)}
            hasPreviousRun={options.previousRun !== null}
            isPending={isPending}
            onUsePreviousRun={loadPreviousRun}
            promoBrands={promoBrands}
            runInProgress={runInProgress}
          />
        </FieldGroup>
      </form>
    </section>
  );
}

function RunFooter({
  control,
  fromPreviousRun,
  hasPreviousRun,
  isPending,
  onUsePreviousRun,
  promoBrands,
  runInProgress,
}: {
  control: RunFormControl;
  fromPreviousRun: boolean;
  hasPreviousRun: boolean;
  isPending: boolean;
  onUsePreviousRun: () => void;
  promoBrands: RunOptions["brands"];
  runInProgress: boolean;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const { field } = useController({ control, name: "kind" });
  const noPromoBrand = field.value === "promo" && promoBrands.length === 0;
  const runButtonPending = isPending || runInProgress;

  return (
    <div className="mt-1 grid gap-2 border-border border-t pt-3">
      <div className="grid gap-2">
        <MetalButton
          className="h-auto min-h-10 w-full whitespace-normal py-2"
          disabled={runButtonPending || noPromoBrand}
          paused={runButtonPending}
          type="submit"
        >
          {runButtonPending ? <Spinner data-icon="inline-start" /> : null}
          {runInProgress
            ? t("run.inProgress")
            : isPending
              ? t("run.starting")
              : t("run.start")}
        </MetalButton>
        <Button
          className="h-auto min-h-8 w-full whitespace-normal py-1.5"
          disabled={runButtonPending || !hasPreviousRun}
          onClick={onUsePreviousRun}
          type="button"
          variant="link"
        >
          {t("run.usePrevious.label")}
        </Button>
      </div>
      {noPromoBrand ? (
        <p className="text-muted-foreground text-xs">
          {t("run.promo.noEligibleBrand")}
        </p>
      ) : null}
      {!hasPreviousRun ? (
        <p className="text-muted-foreground text-xs">
          {t("run.usePrevious.none")}
        </p>
      ) : null}
      {fromPreviousRun ? (
        <p className="text-muted-foreground text-xs">
          {t("run.usePrevious.from")}
        </p>
      ) : null}
    </div>
  );
}

function PromoFields({
  control,
  disabled,
  models,
  platforms,
  promoBrands,
  resolveError,
}: FieldProps & {
  models: RunOptions["models"];
  platforms: RunOptions["platforms"];
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
          icon: (
            <BrandMark className="size-4" logo={brand.logo} name={brand.name} />
          ),
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
          icon: <ModelIcon className="size-4 shrink-0" vendor={model.vendor} />,
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
        options={platforms.map((platform) => ({
          icon: (
            <PlatformIcon className="size-4 shrink-0" platform={platform} />
          ),
          label: t(`run.platform.${platform}`),
          value: platform,
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
          icon: (
            <BrandMark className="size-4" logo={brand.logo} name={brand.name} />
          ),
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
              icon: (
                <ModelIcon className="size-4 shrink-0" vendor={model.vendor} />
              ),
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
              icon: (
                <PlatformIcon className="size-4 shrink-0" platform={platform} />
              ),
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
        telegramOnly={telegramOnly.value}
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
      <FormNumberField
        control={control}
        description={t("run.topNHint", { max: options.bounds.selectionCap })}
        disabled={disabled}
        label={t("run.topN")}
        max={options.bounds.selectionCap}
        name="topN"
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
          <FieldLegend className="ticket-label" variant="label">
            {t("run.kind.label")}
          </FieldLegend>
          <div className="flex flex-wrap gap-1">
            {(["news", "promo"] as const).map((value) => (
              <Button
                aria-pressed={field.value === value}
                className="flex-1"
                disabled={disabled}
                key={value}
                onBlur={field.onBlur}
                onClick={() => field.onChange(value)}
                size="xs"
                type="button"
                variant="outline"
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
  options: readonly { icon?: ReactNode; label: string; value: string }[];
}) {
  const searchable = name === "models" && options.length > 5;

  return (
    <FormField
      control={control}
      disabled={disabled}
      name={name}
      resolveError={resolveError}
    >
      {({ controlId, controlProps, field }) => {
        const selected = new Set(field.value);

        return (
          <>
            {searchable ? (
              <FieldCaption htmlFor={controlId}>{legend}</FieldCaption>
            ) : (
              <FieldLegend
                className="ticket-label"
                id={controlId}
                variant="label"
              >
                {legend}
              </FieldLegend>
            )}
            {searchable ? (
              <SearchableOptions
                controlProps={controlProps}
                inputRef={field.ref}
                label={legend}
                onBlur={field.onBlur}
                onValueChange={field.onChange}
                options={options}
                value={field.value}
              />
            ) : (
              <ul
                aria-describedby={controlProps["aria-describedby"]}
                className="grid gap-0.5 min-[1100px]:grid-cols-2"
              >
                {options.map((option, index) => (
                  <li
                    className="flex min-w-0 items-center gap-2 rounded-md py-1"
                    key={option.value}
                  >
                    <Checkbox
                      checked={selected.has(option.value)}
                      disabled={disabled}
                      id={`${controlId}-${option.value}`}
                      onBlur={index === 0 ? field.onBlur : undefined}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked === true) next.add(option.value);
                        else next.delete(option.value);
                        field.onChange([...next]);
                      }}
                      ref={index === 0 ? field.ref : undefined}
                    />
                    <FieldLabel
                      className="wrap-anywhere min-w-0 font-normal"
                      htmlFor={`${controlId}-${option.value}`}
                    >
                      {option.icon}
                      <Bdi>{option.label}</Bdi>
                    </FieldLabel>
                  </li>
                ))}
              </ul>
            )}
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
  telegramOnly,
}: FieldProps & {
  onSourceIdsChange: (sourceIds: readonly string[]) => void;
  onToggleTelegramOnly: (
    checked: boolean,
    commit: (value: boolean) => void,
  ) => void;
  selectable: readonly SourceCatalogEntry[];
  telegramOnly: boolean;
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
        {({ controlId, controlProps, field }) => {
          const selected = new Set(field.value);
          const refOrigin = SOURCE_ORIGINS.find((origin) =>
            selectable.some((entry) => entry.origin === origin),
          );

          return (
            <>
              <FieldLegend
                className="ticket-label"
                id={controlId}
                variant="label"
              >
                {t("run.sources.label")}
              </FieldLegend>
              {SOURCE_ORIGINS.map((origin) => {
                const entries = selectable.filter(
                  (entry) => entry.origin === origin,
                );
                if (entries.length === 0) return null;

                const kindIds = entries.map((entry) => entry.id);
                const selectedCount = kindIds.filter((id) =>
                  selected.has(id),
                ).length;
                const allSelected = selectedCount === kindIds.length;
                const excluded = telegramOnly && origin !== "telegram_public";
                return (
                  <Collapsible
                    className={
                      excluded
                        ? "group rounded-lg border border-border border-dashed bg-muted/40 p-3 text-muted-foreground"
                        : "group rounded-lg border border-border bg-card p-3"
                    }
                    defaultOpen={origin === "rss"}
                    key={origin}
                  >
                    <div className="flex items-center gap-2">
                      <CollapsibleTrigger
                        className="group/source-trigger h-auto min-w-0 flex-1 flex-wrap justify-start gap-x-2 gap-y-0.5 px-0"
                        ref={origin === refOrigin ? field.ref : undefined}
                        render={<Button variant="ghost" />}
                      >
                        <span className="ticket-label inline-flex items-center gap-1.5">
                          <SourceOriginIcon
                            className="size-3.5"
                            origin={origin}
                          />
                          {t(`run.sources.kind.${origin}`)}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {t(
                            excluded
                              ? "run.sources.excluded"
                              : "run.sources.selected",
                            { m: kindIds.length, n: selectedCount },
                          )}
                        </span>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className="ms-auto transition-transform group-data-panel-open/source-trigger:rotate-180 motion-reduce:transition-none"
                        />
                      </CollapsibleTrigger>

                      <Button
                        className="shrink-0"
                        disabled={disabled || excluded}
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
                    {excluded ? (
                      <p className="mt-1 text-xs">
                        {t("run.sources.excludedReason")}
                      </p>
                    ) : null}
                    <CollapsibleContent
                      className="data-closed:hidden"
                      keepMounted
                    >
                      <ul
                        aria-describedby={controlProps["aria-describedby"]}
                        aria-labelledby={controlId}
                        className="flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto pt-2"
                      >
                        {entries.map((entry) => {
                          const isSelected = selected.has(entry.id);

                          return (
                            <li className="max-w-full" key={entry.id}>
                              <Button
                                aria-describedby={
                                  controlProps["aria-describedby"]
                                }
                                aria-invalid={controlProps["aria-invalid"]}
                                aria-pressed={isSelected}
                                className="h-auto min-w-0 max-w-full whitespace-normal py-1 text-start"
                                disabled={disabled || excluded}
                                onBlur={field.onBlur}
                                onClick={() => {
                                  const next = new Set(selected);
                                  if (isSelected) next.delete(entry.id);
                                  else next.add(entry.id);
                                  const nextIds = [...next];
                                  field.onChange(nextIds);
                                  onSourceIdsChange(nextIds);
                                }}
                                size="xs"
                                type="button"
                                variant="outline"
                              >
                                <Bdi
                                  className="wrap-anywhere min-w-0"
                                  translate="no"
                                >
                                  {entry.name}
                                </Bdi>
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
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

function SearchableOptions({
  showSummary = true,
  controlProps,
  inputRef,
  label,
  onBlur,
  onValueChange,
  options,
  value,
}: {
  showSummary?: boolean;
  controlProps: FormFieldRenderProps<
    RunFormValues,
    "sourceIds"
  >["controlProps"];
  inputRef: Ref<HTMLInputElement>;
  label: string;
  onBlur: () => void;
  onValueChange: (values: string[]) => void;
  options: readonly { label: string; value: string }[];
  value: string[];
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const labelFor = (key: string) =>
    options.find((option) => option.value === key)?.label ?? key;
  return (
    <div className="mt-2 grid gap-2">
      <Combobox
        disabled={controlProps.disabled}
        items={options.map((option) => option.value)}
        itemToStringLabel={labelFor}
        multiple
        onValueChange={onValueChange}
        value={value}
      >
        <ComboboxInput
          {...controlProps}
          aria-label={label}
          onBlur={onBlur}
          placeholder={t("run.search.placeholder")}
          ref={inputRef}
          toggleLabel={t("run.search.toggle")}
        />
        <ComboboxContent>
          <ComboboxEmpty>{t("run.search.empty")}</ComboboxEmpty>
          <ComboboxList>
            {(option: string) => (
              <ComboboxItem key={option} value={option}>
                <Bdi>{labelFor(option)}</Bdi>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {showSummary ? (
        <p className="text-muted-foreground text-xs">
          {t("run.sources.selected", { m: options.length, n: value.length })}
        </p>
      ) : null}
    </div>
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
          <FieldLegend className="ticket-label" variant="label">
            {t("run.recency.label")}
          </FieldLegend>
          <div className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
            {windowHours.map((hours) => (
              <Button
                aria-pressed={field.value === hours}
                className="tabular-nums"
                disabled={disabled}
                key={hours}
                onBlur={field.onBlur}
                onClick={() => field.onChange(hours)}
                size="xs"
                type="button"
                variant="outline"
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
    <FormSwitchField
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
    <FormSwitchField
      control={control}
      disabled={disabled}
      label={t("run.telegram.only")}
      name="telegramOnly"
      onCheckedChange={onToggle}
      resolveError={resolveError}
    />
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
      resolveError={resolveError}
    >
      {({ controlId, controlProps, descriptionNode, field }) => {
        const topics = field.value;
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
                {topics.map((topic) => (
                  <li key={topic}>
                    <span className="flex items-center gap-1 rounded-md border border-input bg-accent ps-2 text-accent-foreground text-xs">
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
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-1">
              <InputGroup className="w-full">
                <InputGroupInput
                  {...controlProps}
                  autoComplete="off"
                  name={field.name}
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
                  className="w-fit px-0"
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
            {descriptionNode}
            {recentTopics.length > 0 ? (
              <FieldSet className="mt-1 grid gap-1">
                <FieldLegend className="ticket-label" variant="label">
                  {t("run.topics.recent")}
                </FieldLegend>
                <div className="flex flex-wrap gap-1">
                  {recentTopics.map((topic) => (
                    <Button
                      className="max-w-full"
                      disabled={disabled || topics.includes(topic)}
                      key={topic}
                      onClick={() => add(topic)}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <Bdi className="block max-w-full truncate">{topic}</Bdi>
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
  initialConfiguration: RunConfiguration | null,
): RunFormValues {
  const defaults: RunFormValues = {
    kind: "news",
    brands: [...options.defaults.brands],
    models: [...options.defaults.models],
    platforms: [...options.defaults.platforms],
    sourceIds: [],
    windowHours: options.defaults.windowHours,
    enrichmentEnabled: options.defaults.enrichment,
    telegramOnly: false,
    orderingMode: options.defaults.orderingMode,
    topN: options.defaults.topN,
    topics: [],
    promo: { brands: [], prompts: {} },
  };

  if (initialConfiguration === null) return defaults;

  const configured = toFormValues(
    initialConfiguration,
    defaults,
    options.platforms,
  );
  if (configured.kind === "promo") return configured;

  const selectableIds = new Set(selectable.map((entry) => entry.id));
  return {
    ...configured,
    sourceIds: configured.sourceIds.filter((sourceId) =>
      selectableIds.has(sourceId),
    ),
  };
}

function toConfiguration(
  values: RunFormValues,
  telegramSourceIds: readonly string[],
): RunSubmission {
  if (values.kind === "promo") {
    return {
      kind: "promo",
      models: values.models,
      platforms: values.platforms,
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
  legacyPromoPlatforms: readonly Platform[],
): RunFormValues {
  if (configuration.kind === "promo") {
    return {
      ...current,
      kind: "promo",
      models: configuration.models,
      platforms: configuration.platforms ?? [...legacyPromoPlatforms],
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
