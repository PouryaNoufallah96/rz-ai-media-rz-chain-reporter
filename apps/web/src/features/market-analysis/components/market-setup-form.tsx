"use client";

import {
  CONTENT_LOCALES,
  MARKET_OUTPUT_FORMATS,
} from "@rz-chain-reporter/contracts";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@rz-chain-reporter/ui/components/combobox";
import { FieldLegend } from "@rz-chain-reporter/ui/components/field";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { CryptocurrencyColorBnb } from "@rz-chain-reporter/ui/components/icons/cryptocurrency-color/bnb";
import { CryptocurrencyColorBtc } from "@rz-chain-reporter/ui/components/icons/cryptocurrency-color/btc";
import { CryptocurrencyColorEth } from "@rz-chain-reporter/ui/components/icons/cryptocurrency-color/eth";
import { CryptocurrencyColorXrp } from "@rz-chain-reporter/ui/components/icons/cryptocurrency-color/xrp";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { CheckIcon, InfoIcon, PaletteIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useState,
} from "react";
import { useFormContext, useWatch } from "react-hook-form";

import {
  FormField,
  FormRootError,
  FormToggleGroupField,
} from "@/components/form/form-field";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useMarketComparisonSearch } from "../hooks/use-market-comparison-search";
import {
  MARKET_ENTRY_COMPARISON_LIMIT,
  MARKET_ENTRY_PRIMARY_LIMIT,
  type MarketRequestSelectionInput,
} from "../schemas/create";
import type {
  MarketAnalysisOptionsProjection,
  MarketComparisonProjection,
} from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";

const MARKET_SETUP_FORM_ID = "market-setup-form";
const SETTING_FIELD_CLASS =
  "min-w-0 [&_[data-slot=toggle-group]]:w-full [&_[data-slot=toggle-group-item]]:flex-1";

type Instrument = MarketAnalysisOptionsProjection["instruments"][number];
type ResolveError = (code: string | undefined) => string;

const COMPARISON_ICONS: Record<
  string,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  BNB: CryptocurrencyColorBnb,
  BTC: CryptocurrencyColorBtc,
  ETH: CryptocurrencyColorEth,
  XRP: CryptocurrencyColorXrp,
};

export function MarketSetupForm({
  catalogReady,
  children,
  comparisons,
  instruments,
  onBack,
  onRememberComparison,
  onSubmit,
  options,
  pending,
  resolveError,
}: {
  catalogReady: boolean;
  children?: ReactNode;
  comparisons: readonly MarketComparisonProjection[];
  instruments: readonly Instrument[];
  onBack?: () => void;
  onRememberComparison: (entry: MarketComparisonProjection) => void;
  onSubmit: ComponentProps<"form">["onSubmit"];
  options: MarketAnalysisOptionsProjection;
  pending: boolean;
  resolveError: ResolveError;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const {
    formState: { errors },
  } = useFormContext<MarketRequestSelectionInput>();
  return (
    <>
      <form
        aria-busy={pending}
        className="grid min-w-0 gap-4"
        id={MARKET_SETUP_FORM_ID}
        noValidate
        onSubmit={onSubmit}
      >
        {children}
        <PrimaryTokens
          comparisons={comparisons}
          disabled={pending}
          instruments={instruments}
          resolveError={resolveError}
        />
        <ComparisonPicker
          catalogReady={catalogReady}
          comparisons={comparisons}
          disabled={pending}
          instruments={instruments}
          onRememberComparison={onRememberComparison}
          options={options}
          resolveError={resolveError}
        />
        <WindowSettings
          options={options}
          pending={pending}
          resolveError={resolveError}
        />
        <FormRootError
          message={
            errors.root?.server
              ? resolveError(errors.root.server.message)
              : undefined
          }
        />
      </form>
      <AnalysisFooter
        form={MARKET_SETUP_FORM_ID}
        onBack={onBack}
        pending={pending}
        pendingLabel={t("create.fetching")}
        primaryLabel={t("market.fetchAndContinue")}
      />
    </>
  );
}

function PanelHeader({
  count,
  hint,
  max,
  title,
}: {
  count: number;
  hint: string;
  max: number;
  title: string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <h2 className="ticket-label min-w-0 text-muted-foreground">{title}</h2>
      <InfoHint label={hint} />
      <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums">
        {t("create.selectionCount", { count, max })}
      </span>
    </div>
  );
}

function InfoHint({ label }: { label: string }) {
  return (
    <Hint label={label}>
      <Button
        aria-label={label}
        className="text-muted-foreground"
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <InfoIcon aria-hidden="true" />
      </Button>
    </Hint>
  );
}

function PrimaryTokens({
  comparisons,
  disabled,
  instruments,
  resolveError,
}: {
  comparisons: readonly MarketComparisonProjection[];
  disabled: boolean;
  instruments: readonly Instrument[];
  resolveError: ResolveError;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { control, getValues, setValue } =
    useFormContext<MarketRequestSelectionInput>();
  const selectedIds = useWatch({ control, name: "primaryInstrumentIds" });
  const brandingInstrumentId = useWatch({
    control,
    name: "brandingInstrumentId",
  });
  const selectedIdSet = new Set(selectedIds);
  const multiple = selectedIds.length > 1;

  const toggleInstrument = (instrument: Instrument) => {
    const selected = selectedIdSet.has(instrument.id);
    if (selected && selectedIds.length === 1) return;
    if (!selected && selectedIds.length >= MARKET_ENTRY_PRIMARY_LIMIT) return;
    const next = selected
      ? selectedIds.filter((id) => id !== instrument.id)
      : [...selectedIds, instrument.id];
    setValue("primaryInstrumentIds", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (!next.some((id) => id === brandingInstrumentId)) {
      setValue("brandingInstrumentId", next[0] ?? "", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    const nextIds = new Set(next);
    const selectedSymbols = new Set(
      instruments.flatMap((candidate) =>
        nextIds.has(candidate.id) ? [candidate.symbol] : [],
      ),
    );
    const byIdentity = new Map(
      comparisons.map((entry) => [entry.canonicalIdentity, entry]),
    );
    setValue(
      "comparisonCatalogIdentities",
      getValues("comparisonCatalogIdentities").filter((identity) => {
        const entry = byIdentity.get(identity);
        return !entry || !selectedSymbols.has(entry.baseAsset);
      }),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  return (
    <section className="grid min-w-0 gap-3">
      <PanelHeader
        count={selectedIds.length}
        hint={t("create.primaryDescription")}
        max={MARKET_ENTRY_PRIMARY_LIMIT}
        title={t("create.primaryTitle")}
      />
      <FormField
        className="@container"
        control={control}
        disabled={disabled}
        name="primaryInstrumentIds"
        resolveError={resolveError}
      >
        {({ controlId, field }) => (
          <>
            <FieldLegend className="sr-only" id={controlId} variant="label">
              {t("create.primaryTitle")}
            </FieldLegend>
            <div className="grid min-w-0 @2xl:grid-cols-3 @sm:grid-cols-2 gap-2">
              {instruments.map((instrument, index) => {
                const selected = selectedIdSet.has(instrument.id);
                const locked =
                  !selected && selectedIds.length >= MARKET_ENTRY_PRIMARY_LIMIT;
                const owner = brandingInstrumentId === instrument.id;
                const branded = selected && multiple;
                return (
                  <div className="relative min-w-0" key={instrument.id}>
                    <Button
                      aria-pressed={selected}
                      className={cn(
                        "h-auto min-h-12 w-full justify-start px-2 py-1.5",
                        branded && "pe-24",
                      )}
                      disabled={disabled || locked}
                      onBlur={index === 0 ? field.onBlur : undefined}
                      onClick={() => toggleInstrument(instrument)}
                      ref={index === 0 ? field.ref : undefined}
                      type="button"
                      variant="outline"
                    >
                      <Image
                        alt=""
                        className="size-7 shrink-0 rounded-md object-contain"
                        height={instrument.icon.height}
                        src={instrument.icon.url}
                        unoptimized
                        width={instrument.icon.width}
                      />
                      <span className="grid min-w-0 gap-0.5">
                        <Bdi className="truncate font-medium">
                          {instrument.name}
                        </Bdi>
                        <Bdi className="truncate text-muted-foreground text-xs">
                          {instrument.symbol}
                        </Bdi>
                      </span>
                      {selected && !branded ? (
                        <CheckIcon
                          aria-hidden="true"
                          className="ms-auto size-4 shrink-0 text-primary"
                        />
                      ) : null}
                    </Button>
                    {branded && owner ? (
                      <Hint label={t("create.brandingDescription")}>
                        <Badge className="absolute inset-e-1.5 top-1/2 -translate-y-1/2">
                          <PaletteIcon aria-hidden="true" />
                          {t("create.brandingChip")}
                        </Badge>
                      </Hint>
                    ) : null}
                    {branded && !owner ? (
                      <Hint label={t("create.brandingDescription")}>
                        <Button
                          aria-label={t("create.brandingSelect", {
                            name: instrument.name,
                          })}
                          className="absolute inset-e-1.5 top-1/2 -translate-y-1/2"
                          disabled={disabled}
                          onClick={() =>
                            setValue("brandingInstrumentId", instrument.id, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                          size="xs"
                          type="button"
                          variant="outline"
                        >
                          <PaletteIcon
                            aria-hidden="true"
                            data-icon="inline-start"
                          />
                          {t("create.brandingUse")}
                        </Button>
                      </Hint>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </FormField>
      {multiple ? (
        <FormField
          className="empty:hidden"
          control={control}
          name="brandingInstrumentId"
          resolveError={resolveError}
        >
          {() => null}
        </FormField>
      ) : null}
    </section>
  );
}

function ComparisonPicker({
  catalogReady,
  comparisons,
  disabled,
  instruments,
  onRememberComparison,
  options,
  resolveError,
}: {
  catalogReady: boolean;
  comparisons: readonly MarketComparisonProjection[];
  disabled: boolean;
  instruments: readonly Instrument[];
  onRememberComparison: (entry: MarketComparisonProjection) => void;
  options: MarketAnalysisOptionsProjection;
  resolveError: ResolveError;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { control } = useFormContext<MarketRequestSelectionInput>();
  const primaryIds = useWatch({ control, name: "primaryInstrumentIds" });
  const [query, setQuery] = useState("");
  const search = useMarketComparisonSearch(query);
  const primaryIdSet = new Set(primaryIds);
  const primarySymbols = new Set(
    instruments.flatMap((instrument) =>
      primaryIdSet.has(instrument.id) ? [instrument.symbol] : [],
    ),
  );
  const available = new Map<string, MarketComparisonProjection>();
  for (const entry of comparisons) {
    if (!primarySymbols.has(entry.baseAsset)) {
      available.set(entry.baseAsset, entry);
    }
  }
  const featured = options.featuredComparisonSymbols.flatMap((symbol) => {
    const entry = available.get(symbol);
    return entry ? [entry] : [];
  });
  const featuredIdentities = new Set(
    featured.map((entry) => entry.canonicalIdentity),
  );

  return (
    <section className="grid min-w-0 gap-3">
      <FormField
        control={control}
        disabled={disabled}
        name="comparisonCatalogIdentities"
        resolveError={resolveError}
      >
        {({ controlId, controlProps, field }) => {
          const selected = new Set(field.value);
          const searched = comparisons.filter(
            (entry) =>
              selected.has(entry.canonicalIdentity) &&
              !featuredIdentities.has(entry.canonicalIdentity),
          );
          const limitReached = selected.size >= MARKET_ENTRY_COMPARISON_LIMIT;
          const toggle = (entry: MarketComparisonProjection) => {
            if (!selected.has(entry.canonicalIdentity) && limitReached) {
              return;
            }
            field.onChange(
              selected.has(entry.canonicalIdentity)
                ? field.value.filter(
                    (identity) => identity !== entry.canonicalIdentity,
                  )
                : [...field.value, entry.canonicalIdentity],
            );
          };
          const addSearchResult = (
            entry: MarketComparisonProjection | null,
          ) => {
            if (
              !entry ||
              selected.has(entry.canonicalIdentity) ||
              limitReached ||
              primarySymbols.has(entry.baseAsset)
            ) {
              return;
            }
            onRememberComparison(entry);
            field.onChange([...field.value, entry.canonicalIdentity]);
            setQuery("");
          };
          const results = search.entries.filter(
            (entry) =>
              !primarySymbols.has(entry.baseAsset) &&
              !selected.has(entry.canonicalIdentity),
          );
          return (
            <>
              <PanelHeader
                count={selected.size}
                hint={t("create.comparisonDescription")}
                max={MARKET_ENTRY_COMPARISON_LIMIT}
                title={t("create.comparisonTitle")}
              />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={controlId}>
                  {t("create.searchComparisons")}
                </label>
                <Combobox<MarketComparisonProjection>
                  autoComplete="list"
                  autoHighlight
                  disabled={disabled}
                  filter={null}
                  inputValue={query}
                  itemToStringLabel={(entry) => entry.displayName}
                  items={
                    search.active
                      ? results
                      : featured.filter(
                          (entry) => !selected.has(entry.canonicalIdentity),
                        )
                  }
                  onInputValueChange={(value, eventDetails) => {
                    if (eventDetails.reason !== "item-press") setQuery(value);
                  }}
                  onValueChange={addSearchResult}
                  value={null}
                >
                  <ComboboxInput
                    {...controlProps}
                    autoComplete="off"
                    className="w-auto min-w-56 flex-1"
                    id={controlId}
                    onBlur={field.onBlur}
                    placeholder={t("create.searchPlaceholder")}
                    ref={field.ref}
                    toggleLabel={t("create.searchToggle")}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>
                      {search.searching ? (
                        <span className="flex items-center gap-2">
                          <Spinner
                            className="size-3.5"
                            label={t("create.searchLoading")}
                          />
                          {t("create.searchLoading")}
                        </span>
                      ) : search.active && search.failed ? (
                        <span className="text-destructive">
                          {t("create.searchError")}
                        </span>
                      ) : (
                        t("create.noSearchResults")
                      )}
                    </ComboboxEmpty>
                    <ComboboxList>
                      {(entry: MarketComparisonProjection) => (
                        <ComboboxItem
                          disabled={limitReached}
                          key={entry.canonicalIdentity}
                          value={entry}
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <Bdi className="truncate font-medium">
                              {entry.displayName}
                            </Bdi>
                            <Bdi className="text-muted-foreground text-xs">
                              {entry.symbol}
                            </Bdi>
                          </span>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                {featured.map((entry) => {
                  const Icon = COMPARISON_ICONS[entry.baseAsset];
                  const active = selected.has(entry.canonicalIdentity);
                  return (
                    <Button
                      aria-pressed={active}
                      disabled={disabled || (limitReached && !active)}
                      key={entry.canonicalIdentity}
                      onClick={() => toggle(entry)}
                      type="button"
                      variant="outline"
                    >
                      {Icon ? (
                        <Icon aria-hidden="true" data-icon="inline-start" />
                      ) : null}
                      <Bdi>{entry.baseAsset}</Bdi>
                    </Button>
                  );
                })}
                {searched.map((entry) => (
                  <Button
                    aria-label={t("create.removeComparison", {
                      symbol: entry.baseAsset,
                    })}
                    disabled={disabled}
                    key={entry.canonicalIdentity}
                    onClick={() => toggle(entry)}
                    type="button"
                    variant="secondary"
                  >
                    <Bdi>{entry.displayName}</Bdi>
                    <XIcon aria-hidden="true" data-icon="inline-end" />
                  </Button>
                ))}
              </div>
              {catalogReady ? null : (
                <p className="text-caution text-xs">
                  {t("create.catalogUnavailable")}
                </p>
              )}
            </>
          );
        }}
      </FormField>
    </section>
  );
}

function WindowSettings({
  options,
  pending,
  resolveError,
}: {
  options: MarketAnalysisOptionsProjection;
  pending: boolean;
  resolveError: ResolveError;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { control } = useFormContext<MarketRequestSelectionInput>();
  return (
    <div className="grid min-w-0 @5xl:grid-cols-4 @lg:grid-cols-2 gap-4">
      <FormToggleGroupField
        className={SETTING_FIELD_CLASS}
        control={control}
        disabled={pending}
        label={t("create.period")}
        name="period"
        options={options.enabledPeriods.map((value) => ({
          label: t(`create.periodNames.${value}`),
          title: t(`create.periods.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormToggleGroupField
        className={SETTING_FIELD_CLASS}
        control={control}
        disabled={pending}
        hint={<InfoHint label={t("create.scaleDescription")} />}
        label={t("create.scale")}
        name="scale"
        options={options.enabledScales.map((value) => ({
          label: t(`create.scales.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormToggleGroupField
        className={SETTING_FIELD_CLASS}
        control={control}
        disabled={pending}
        label={t("create.outputFormat")}
        name="outputFormat"
        options={MARKET_OUTPUT_FORMATS.map((value) => ({
          label: t(`create.formatNames.${value}`),
          title: t(`create.formats.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormToggleGroupField
        className={SETTING_FIELD_CLASS}
        control={control}
        disabled={pending}
        label={t("create.contentLocale")}
        name="contentLocale"
        options={CONTENT_LOCALES.map((value) => ({
          label: t(`create.locales.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
    </div>
  );
}
