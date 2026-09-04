"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  MARKET_CHART_GRID_STRENGTHS,
  MARKET_CHART_LEGEND_FORMATS,
  MARKET_CHART_LEGEND_POSITIONS,
  MARKET_CHART_LINE_WIDTHS,
  MARKET_CHART_MARKERS,
  MARKET_CHART_MIN_COLOR_CONTRAST,
  MARKET_CHART_OUTPUT_DIMENSIONS,
  MARKET_CHART_PRESET_IDS,
  type MarketChartPresetId,
  type MarketChartRenderInput,
  OPERATION_IN_PROGRESS_LIFECYCLES,
} from "@rz-chain-reporter/contracts";
import {
  applyMarketChartPreset,
  createMarketChartScene,
  MARKET_CHART_PRESETS,
  MarketChartError,
  serializeMarketChartSvg,
} from "@rz-chain-reporter/market-chart";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { ColorPicker } from "@rz-chain-reporter/ui/components/color-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rz-chain-reporter/ui/components/popover";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import type { Control, FieldPath } from "react-hook-form";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  FieldCaption,
  FormField,
  FormSelectField,
  FormToggleGroupField,
  LabeledSelect,
  type SelectOption,
} from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";

import {
  approveMarketChartAction,
  retryMarketChartAction,
  saveMarketChartDefaultAction,
} from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useMarketActionError } from "../hooks/use-market-action-error";
import {
  type MarketChartChecks,
  marketChartChecks,
} from "../lib/chart-validation";
import { approveChartInputSchema } from "../schemas/commands";
import type { MarketAnalysisProjection } from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";

const CHART_FORM_ID = "chart-designer-form";
const DESIGNER_FIELD_CLASS =
  "w-auto min-w-0 flex-1 basis-40 @max-2xl:basis-full";

const STRIP_OWNED_CODES = new Set([
  "market_chart_series_color_duplicate",
  "market_chart_series_color_contrast",
]);

const SWATCHES = [
  ...new Set(
    Object.values(MARKET_CHART_PRESETS).flatMap((preset) => [
      preset.background,
      ...preset.colors,
    ]),
  ),
];

type Values = z.input<typeof approveChartInputSchema>;
type PresetOption = MarketChartPresetId | "custom";

export function ChartWorkspace({
  analysis,
  onBack,
  onContinue,
  onDirtyChange,
}: {
  analysis: MarketAnalysisProjection;
  onBack?: () => void;
  onContinue: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveActionError = useMarketActionError();
  const approve = useAction(approveMarketChartAction);
  const retryRender = useAction(retryMarketChartAction);
  const saveDefault = useAction(saveMarketChartDefaultAction);
  const analysisId = analysis.id;
  const authoritativeSpec = analysis.currentChartSpec;
  const renderInput = analysis.chartRenderInput;
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const values: Values | undefined = authoritativeSpec
    ? {
        analysisId: analysis.id,
        expectedVersion: analysis.version,
        idempotencyKey,
        chartSpec: authoritativeSpec,
      }
    : undefined;
  const form = useForm<Values>({
    defaultValues: values,
    mode: "onChange",
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(approveChartInputSchema),
    values,
  });
  const spec = useWatch({ control: form.control, name: "chartSpec" });
  const deferredSpec = useDeferredValue(spec);
  const previewPending = spec !== deferredSpec;
  const seriesIdentities = chartSeriesIdentities(renderInput);
  const { isDirty } = form.formState;
  const preview = createChartPreview(renderInput, deferredSpec);
  const [announcement, setAnnouncement] = useState("");
  const chartApproval = analysis.approvals.chart.fingerprint;
  const pending = chartActionsPending(approve.isPending, saveDefault.isPending);

  const markCustom = () => {
    onDirtyChange(true);
    if (form.getValues("chartSpec.presetId") === "custom") return;
    form.setValue("chartSpec.presetId", "custom", {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const selectPreset = (presetId: MarketChartPresetId) => {
    const current = form.getValues("chartSpec");
    if (!current) return;
    form.setValue(
      "chartSpec",
      applyMarketChartPreset(current, presetId, seriesIdentities),
      { shouldDirty: true, shouldValidate: true },
    );
    onDirtyChange(true);
  };

  const approveSubmit = form.handleSubmit(async (submitted) => {
    const result = await approve.execute({
      ...submitted,
      expectedVersion: analysis.version,
      idempotencyKey: crypto.randomUUID(),
    });
    if (result.status === "error") {
      applyActionErrorToForm(form.setError, result, form.setFocus);
      return;
    }
    form.reset(submitted, { keepDirtyValues: false });
    onDirtyChange(false);
  });

  if (!authoritativeSpec || !renderInput) {
    return (
      <>
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>{t("chart.notReadyTitle")}</AlertTitle>
          <AlertDescription>{t("chart.notReadyBody")}</AlertDescription>
        </Alert>
        <AnalysisFooter
          disabled
          onBack={onBack}
          primaryLabel={t("shell.continue")}
        />
      </>
    );
  }

  const checks = marketChartChecks(
    deferredSpec ?? authoritativeSpec,
    renderInput.snapshot,
    analysis.normalizedRequest.period,
  );
  const blocked = chartApprovalBlocked(checks, preview);
  const approvalRequired = chartApprovalRequired(chartApproval, isDirty);
  const rendered = analysis.currentChartMediaAssetId !== null;
  const resolveFieldError = (code: string | undefined) =>
    resolveChartFieldError(code, resolveActionError);

  return (
    <>
      <form
        className="grid min-w-0 gap-4"
        id={CHART_FORM_ID}
        noValidate
        onChange={() => onDirtyChange(true)}
        onSubmit={approveSubmit}
      >
        <ChartSaveError
          code={chartSaveError(
            approve.status,
            approve.code,
            saveDefault.status,
            saveDefault.code,
          )}
          resolveError={resolveActionError}
        />
        <ChartDesigner
          activePresetId={spec?.presetId}
          control={form.control}
          disabled={pending}
          isDirty={isDirty}
          onManualChange={markCustom}
          onReset={() => {
            form.reset(values, { keepDirtyValues: false });
            onDirtyChange(false);
          }}
          onSaveDefault={async () => {
            if (!spec) return;
            const result = await saveDefault.execute({
              marketInstrumentId: analysis.visualOwnerInstrumentId,
              chartSpec: spec,
              expectedVersion: analysis.chartDefaultVersion,
            });
            if (result.status === "success") {
              toast.success(t("chart.defaultSaved"));
            }
          }}
          onSelectPreset={selectPreset}
          resolveError={resolveFieldError}
          series={renderInput.snapshot.series}
        />
        <div className="grid min-w-0 gap-3">
          <ChartPreview
            announcement={announcement}
            onAnnouncement={setAnnouncement}
            pending={previewPending}
            preview={preview}
          />
          <ValidationStrip
            analysis={analysis}
            approvalRequired={approvalRequired}
            approveDisabled={blocked || pending}
            approving={approve.isPending}
            checks={checks}
          />
          {!approvalRequired && !rendered ? (
            <RenderStatus
              analysis={analysis}
              onRetry={() =>
                void retryRender.execute({
                  analysisId,
                  expectedVersion: analysis.version,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
              resolveError={resolveActionError}
              retry={retryRender}
            />
          ) : null}
        </div>
      </form>
      <AnalysisFooter
        disabled={approvalRequired || !rendered}
        onBack={onBack}
        onPrimary={onContinue}
        primaryLabel={t("shell.continue")}
      />
    </>
  );
}

function createChartPreview(
  renderInput: MarketChartRenderInput | null | undefined,
  spec: MarketChartRenderInput["spec"] | undefined,
) {
  if (!renderInput || !spec) return null;
  try {
    const scene = createMarketChartScene(
      {
        ...renderInput,
        spec,
      },
      { enforceColorPolicy: false },
    );
    return {
      scene,
      imageUrl: chartSvgDataUrl(serializeMarketChartSvg(scene)),
      error: null,
    };
  } catch (error) {
    return {
      scene: null,
      imageUrl: null,
      error: error instanceof MarketChartError ? error.code : "PREVIEW_INVALID",
    };
  }
}

function chartSeriesIdentities(
  renderInput: MarketChartRenderInput | null | undefined,
) {
  return renderInput?.snapshot.series.map((series) => series.id) ?? [];
}

function chartActionsPending(approving: boolean, savingDefault: boolean) {
  return approving || savingDefault;
}

function chartApprovalBlocked(
  checks: MarketChartChecks,
  preview: ReturnType<typeof createChartPreview>,
) {
  return (
    !checks.uniqueColors ||
    !checks.colorContrast ||
    !checks.timeline ||
    Boolean(preview?.error)
  );
}

function chartApprovalRequired(
  fingerprint: string | null | undefined,
  isDirty: boolean,
) {
  return !fingerprint || isDirty;
}

function resolveChartFieldError(
  code: string | undefined,
  resolveError: (code: string | undefined) => string,
) {
  return code && STRIP_OWNED_CODES.has(code) ? "" : resolveError(code);
}

function chartSaveError(
  approveStatus: string,
  approveCode: string | undefined,
  saveStatus: string,
  saveCode: string | undefined,
) {
  if (approveStatus === "error") return approveCode;
  if (saveStatus === "error") return saveCode;
  return undefined;
}

function chartSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ChartPreview({
  announcement,
  onAnnouncement,
  pending,
  preview,
}: {
  announcement: string;
  onAnnouncement: (announcement: string) => void;
  pending: boolean;
  preview: ReturnType<typeof createChartPreview>;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  if (preview?.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("chart.invalidPreview")}</AlertTitle>
        <AlertDescription>{t("chart.previewErrors.generic")}</AlertDescription>
      </Alert>
    );
  }
  if (!preview?.scene || !preview.imageUrl) return null;
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{
        aspectRatio: `${preview.scene.width} / ${preview.scene.height}`,
      }}
    >
      {pending ? (
        <div className="absolute inset-e-3 top-3 z-10 flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-muted-foreground text-xs">
          <Spinner label={t("chart.previewUpdating")} />
          {t("chart.previewUpdating")}
        </div>
      ) : null}
      <Image
        aria-hidden="true"
        alt=""
        className="size-full"
        height={preview.scene.height}
        src={preview.imageUrl}
        unoptimized
        width={preview.scene.width}
      />
      {preview.scene.series.flatMap((series) =>
        series.interaction.map((point) => (
          <button
            aria-label={point.announcement}
            className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
            key={`${series.id}-${point.timestamp}`}
            onFocus={() => onAnnouncement(point.announcement)}
            style={{
              left: `${(point.x / preview.scene.width) * 100}%`,
              top: `${(point.y / preview.scene.height) * 100}%`,
            }}
            type="button"
          />
        )),
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function RenderStatus({
  analysis,
  onRetry,
  resolveError,
  retry,
}: {
  analysis: MarketAnalysisProjection;
  onRetry: () => void;
  resolveError: (code: string | undefined) => string;
  retry: { code?: string; isPending: boolean; status: string };
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const lifecycle = analysis.chartRender?.lifecycle;
  if (
    retry.isPending ||
    (lifecycle &&
      OPERATION_IN_PROGRESS_LIFECYCLES.some((item) => item === lifecycle))
  ) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner label={t("chart.renderPending")} />
        {t("chart.renderPending")}
      </p>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{t("chart.renderFailedTitle")}</AlertTitle>
      <AlertDescription>
        {retry.status === "error"
          ? resolveError(retry.code)
          : t("chart.renderFailedBody")}
      </AlertDescription>
      <Button
        className="mt-2 justify-self-start"
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("chart.retryRender")}
      </Button>
    </Alert>
  );
}

function ChartSaveError({
  code,
  resolveError,
}: {
  code: string | undefined;
  resolveError: (code: string | undefined) => string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  if (!code) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{t("chart.saveFailed")}</AlertTitle>
      <AlertDescription>{resolveError(code)}</AlertDescription>
    </Alert>
  );
}

function ValidationStrip({
  analysis,
  approvalRequired,
  approveDisabled,
  approving,
  checks,
}: {
  analysis: MarketAnalysisProjection;
  approvalRequired: boolean;
  approveDisabled: boolean;
  approving: boolean;
  checks: MarketChartChecks;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const exportable = analysis.currentChartMediaAssetId;
  const period = t(`create.periodNames.${analysis.normalizedRequest.period}`);
  const rows = [
    {
      hint: t("chart.validation.uniqueColorsHint"),
      label: t("chart.validation.uniqueColors"),
      ok: checks.uniqueColors,
    },
    {
      hint: t("chart.validation.colorContrastHint", {
        ratio: MARKET_CHART_MIN_COLOR_CONTRAST,
      }),
      label: t("chart.validation.colorContrast", {
        ratio: MARKET_CHART_MIN_COLOR_CONTRAST,
      }),
      ok: checks.colorContrast,
    },
    {
      hint: t("chart.validation.timelineHint", { period }),
      label: t("chart.validation.timeline", { period }),
      ok: checks.timeline,
    },
  ];
  const failures = rows.filter((row) => !row.ok);
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ul
          aria-label={t("chart.validation.title")}
          className="flex min-w-0 flex-wrap items-center gap-2"
        >
          {rows.map((row) => (
            <li key={row.label}>
              <Badge variant={row.ok ? "outline" : "destructive"}>
                {row.ok ? (
                  <CheckIcon aria-hidden="true" data-icon="inline-start" />
                ) : (
                  <XIcon aria-hidden="true" data-icon="inline-start" />
                )}
                {row.label}
              </Badge>
            </li>
          ))}
        </ul>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button
            aria-busy={approving}
            className={
              approvalRequired && !approveDisabled ? "ready-ring" : undefined
            }
            disabled={approveDisabled}
            form={CHART_FORM_ID}
            type="submit"
          >
            {approving ? (
              <Spinner data-icon="inline-start" label={t("chart.saving")} />
            ) : (
              <CheckIcon aria-hidden="true" data-icon="inline-start" />
            )}
            {approving ? t("chart.saving") : t("actions.approveChart")}
          </Button>
          <Button
            className="data-disabled:pointer-events-none data-disabled:opacity-50"
            disabled={!exportable}
            nativeButton={false}
            render={
              <a
                aria-label={t("chart.exportPng")}
                href={
                  exportable ? `/api/media/${exportable}?download=1` : undefined
                }
              />
            }
            variant="outline"
          >
            <DownloadIcon aria-hidden="true" data-icon="inline-start" />
            {t("chart.exportPng")}
          </Button>
        </div>
      </div>
      {failures.length > 0 ? (
        <ul className="grid gap-1 text-destructive text-xs">
          {failures.map((row) => (
            <li key={row.label}>{row.hint}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ChartDesigner({
  activePresetId,
  control,
  disabled,
  isDirty,
  onManualChange,
  onReset,
  onSaveDefault,
  onSelectPreset,
  resolveError,
  series,
}: {
  activePresetId?: string;
  control: Control<Values>;
  disabled: boolean;
  isDirty: boolean;
  onManualChange: () => void;
  onReset: () => void;
  onSaveDefault: () => void;
  onSelectPreset: (presetId: MarketChartPresetId) => void;
  resolveError: (code: string | undefined) => string;
  series: MarketChartRenderInput["snapshot"]["series"];
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const presetOptions: SelectOption<PresetOption>[] = [
    ...MARKET_CHART_PRESET_IDS.map((presetId) => ({
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <PresetStrip presetId={presetId} />
          <span className="truncate">
            {t(`chart.presetOptions.${presetId}`)}
          </span>
        </span>
      ),
      value: presetId,
    })),
    {
      disabled: true,
      label: t("chart.presetOptions.custom"),
      value: "custom",
    },
  ];
  const activePreset =
    MARKET_CHART_PRESET_IDS.find((presetId) => presetId === activePresetId) ??
    "custom";
  return (
    <div className="@container flex min-w-0 flex-wrap items-end gap-4">
      <LabeledSelect
        className={DESIGNER_FIELD_CLASS}
        disabled={disabled}
        label={t("chart.presets")}
        onValueChange={(next) => {
          if (next && next !== "custom") onSelectPreset(next);
        }}
        options={presetOptions}
        triggerClassName="w-full"
        value={activePreset}
      />
      <ColorField
        control={control}
        disabled={disabled}
        label={t("chart.background")}
        name="chartSpec.background"
        onManualChange={onManualChange}
        resolveError={resolveError}
      />
      {series.map((item) => (
        <ColorField
          control={control}
          disabled={disabled}
          key={item.id}
          label={item.label}
          name={`chartSpec.seriesColors.${item.id}`}
          onManualChange={onManualChange}
          resolveError={resolveError}
        />
      ))}
      <FormSelectField
        className={DESIGNER_FIELD_CLASS}
        control={control}
        disabled={disabled}
        label={t("chart.legendPosition")}
        name="chartSpec.legendPosition"
        onValueChange={onManualChange}
        options={MARKET_CHART_LEGEND_POSITIONS.map((value) => ({
          label: t(`chart.legendPositions.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormSelectField
        className={DESIGNER_FIELD_CLASS}
        control={control}
        disabled={disabled}
        label={t("chart.legendFormat")}
        name="chartSpec.legendFormat"
        onValueChange={onManualChange}
        options={MARKET_CHART_LEGEND_FORMATS.map((value) => ({
          label: t(`chart.legendFormats.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormSelectField
        className={DESIGNER_FIELD_CLASS}
        control={control}
        disabled={disabled}
        label={t("chart.markers")}
        name="chartSpec.markers"
        onValueChange={onManualChange}
        options={MARKET_CHART_MARKERS.map((value) => ({
          label: t(`chart.markerOptions.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormSelectField
        className={DESIGNER_FIELD_CLASS}
        control={control}
        disabled={disabled}
        label={t("chart.gridStrength")}
        name="chartSpec.gridStrength"
        onValueChange={onManualChange}
        options={MARKET_CHART_GRID_STRENGTHS.map((value) => ({
          label: t(`chart.gridStrengths.${value}`),
          value,
        }))}
        resolveError={resolveError}
      />
      <FormToggleGroupField
        className="w-auto"
        control={control}
        disabled={disabled}
        label={t("chart.lineWidth")}
        name="chartSpec.lineWidth"
        onValueChange={onManualChange}
        options={MARKET_CHART_LINE_WIDTHS.map((value) => ({
          label: t("chart.lineWidthValue", { value }),
          value,
        }))}
        resolveError={resolveError}
      />
      <div className="ms-auto flex gap-2">
        <Button
          disabled={disabled || !isDirty}
          onClick={onReset}
          type="button"
          variant="ghost"
        >
          {t("chart.reset")}
        </Button>
        <Button
          disabled={disabled}
          onClick={onSaveDefault}
          type="button"
          variant="outline"
        >
          {t("actions.saveDefault")}
        </Button>
      </div>
    </div>
  );
}

function PresetStrip({ presetId }: { presetId: MarketChartPresetId }) {
  const preset = MARKET_CHART_PRESETS[presetId];
  return (
    <span
      aria-hidden="true"
      className="flex h-2.5 w-10 shrink-0 overflow-hidden rounded-sm border"
      style={{ backgroundColor: preset.background }}
    >
      {preset.colors.slice(0, 4).map((color) => (
        <span
          className="h-full flex-1"
          key={color}
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

function ColorField({
  control,
  disabled,
  label,
  name,
  onManualChange,
  resolveError,
}: {
  control: Control<Values>;
  disabled: boolean;
  label: string;
  name: FieldPath<Values>;
  onManualChange: () => void;
  resolveError: (code: string | undefined) => string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <FormField
      className={cn(DESIGNER_FIELD_CLASS, "basis-32")}
      control={control}
      disabled={disabled}
      name={name}
      resolveError={resolveError}
    >
      {({ controlId, controlProps, field }) => {
        const value = String(field.value);
        return (
          <>
            <FieldCaption htmlFor={controlId}>{label}</FieldCaption>
            <Popover>
              <PopoverTrigger
                {...controlProps}
                className="w-full justify-start font-mono uppercase"
                onBlur={field.onBlur}
                ref={field.ref}
                render={<Button variant="outline" />}
              >
                <span
                  aria-hidden="true"
                  className="size-4 shrink-0 rounded-sm border"
                  style={{ backgroundColor: value }}
                />
                <span className="min-w-0 truncate" dir="ltr">
                  {value}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className="ms-auto text-muted-foreground"
                />
              </PopoverTrigger>
              <PopoverContent className="p-3">
                <ColorPicker
                  disabled={controlProps.disabled}
                  labels={{
                    hex: t("chart.picker.hex"),
                    hue: t("chart.picker.hue"),
                    plane: t("chart.picker.plane"),
                    swatch: (color) => t("chart.picker.swatch", { color }),
                  }}
                  onChange={(next) => {
                    field.onChange(next);
                    onManualChange();
                  }}
                  swatches={SWATCHES}
                  value={value}
                />
              </PopoverContent>
            </Popover>
          </>
        );
      }}
    </FormField>
  );
}

export function ChartSidebarPreview({
  analysis,
}: {
  analysis: MarketAnalysisProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const renderInput = analysis.chartRenderInput;
  const dimensions =
    renderInput?.dimensions ?? MARKET_CHART_OUTPUT_DIMENSIONS.landscape;
  const lifecycle = analysis.chartRender?.lifecycle;
  const state = analysis.currentChartMediaAssetId
    ? "ready"
    : (lifecycle ?? "unapproved");
  const svg = (() => {
    if (analysis.currentChartMediaAssetId || !renderInput) return null;
    try {
      return serializeMarketChartSvg(createMarketChartScene(renderInput));
    } catch {
      return null;
    }
  })();
  return (
    <div className="grid min-w-0 flex-1 gap-2">
      <span className="ticket-label text-muted-foreground">
        {t("chart.preview")}
      </span>
      {analysis.currentChartMediaAssetId ? (
        <Image
          alt={t("chart.canonicalAlt")}
          className="h-auto w-full rounded-lg border"
          height={dimensions.height}
          loading="eager"
          src={`/api/media/${analysis.currentChartMediaAssetId}`}
          unoptimized
          width={dimensions.width}
        />
      ) : svg ? (
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-lg border [&>svg]:h-auto [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{t("chart.canonical")}</span>
        <span className="font-medium">{t(`chart.renderState.${state}`)}</span>
      </div>
    </div>
  );
}
