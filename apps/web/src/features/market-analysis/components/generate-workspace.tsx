"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MARKET_CHART_OUTPUT_DIMENSIONS } from "@rz-chain-reporter/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { BackgroundGradient } from "@rz-chain-reporter/ui/components/background-gradient";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import {
  AlertTriangleIcon,
  DownloadIcon,
  ImageIcon,
  InfoIcon,
  LayersIcon,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { type Control, useForm } from "react-hook-form";
import type { z } from "zod";
import { GenerationPlaceholder } from "@/components/common/generation-placeholder";
import { ModelIcon } from "@/components/common/model-icon";
import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import {
  FormSelectField,
  FormTextareaField,
} from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";

import {
  approveMarketFinalAction,
  generateMarketAnalysisAction,
  retryMarketGenerationFinalizationAction,
} from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useAdvanceOnApproval } from "../hooks/use-advance-on-approval";
import { useMarketActionError } from "../lib/action-error";
import { findComposition } from "../lib/compositions";
import { generateMarketAnalysisInputSchema } from "../schemas/commands";
import type {
  MarketAnalysisOptionsProjection,
  MarketAnalysisProjection,
} from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";
import { ProjectRow } from "./current-project-sidebar";

type Values = z.input<typeof generateMarketAnalysisInputSchema>;
type Phase = NonNullable<MarketAnalysisProjection["generation"]>["phase"];

export function GenerateWorkspace({
  analysis,
  onBack,
  onContinue,
  onDirtyChange,
  options,
}: {
  analysis: MarketAnalysisProjection;
  onBack?: () => void;
  onContinue: () => void;
  onDirtyChange: (dirty: boolean) => void;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const generate = useAction(generateMarketAnalysisAction);
  const retry = useAction(retryMarketGenerationFinalizationAction);
  const approve = useAction(approveMarketFinalAction);
  const view = generationWorkspaceView(
    analysis,
    options,
    {
      code: generate.code,
      pending: generate.isPending,
      status: generate.status,
    },
    {
      code: retry.code,
      pending: retry.isPending,
      status: retry.status,
    },
    {
      code: approve.code,
      pending: approve.isPending,
      status: approve.status,
    },
  );
  const awaitApproval = useAdvanceOnApproval(view.finalApproval, onContinue);
  const form = useForm<Values>({
    defaultValues: generationFormValues(analysis, options),
    mode: "onSubmit",
    resolver: zodResolver(generateMarketAnalysisInputSchema, undefined, {
      raw: true,
    }),
  });
  const submitGeneration = form.handleSubmit(async (values) => {
    generate.reset();
    approve.reset();
    retry.reset();
    const result = await generate.execute({
      analysisId: analysis.id,
      expectedVersion: analysis.version,
      idempotencyKey: crypto.randomUUID(),
      imageOptionKey: values.imageOptionKey,
      operatorDirection: values.operatorDirection,
    });
    if (result.status === "error") {
      applyActionErrorToForm(form.setError, result, form.setFocus);
      return;
    }
    form.reset({ ...values, idempotencyKey: crypto.randomUUID() });
    onDirtyChange(false);
  });

  const approveImage = async () => {
    approve.reset();
    generate.reset();
    retry.reset();
    if (view.finalApproval) {
      onContinue();
      return;
    }
    const result = await approve.execute({
      analysisId: analysis.id,
      expectedVersion: analysis.version,
    });
    if (result.status === "error") return;
    awaitApproval();
  };

  return (
    <>
      <div className="grid min-w-0 @3xl:grid-cols-2 gap-4">
        <GenerationSetup
          actionError={view.actionError}
          chartUrl={view.chartUrl}
          control={form.control}
          dimensions={view.dimensions}
          generating={view.generating}
          generationRequired={view.generationRequired}
          hasGeneration={view.hasGeneration}
          imageOptions={options.imageOptions}
          onChange={() => onDirtyChange(true)}
          onSubmit={submitGeneration}
          resolveError={resolveError}
          sampleHeight={view.sampleHeight}
          sampleSrc={view.sampleSrc}
          sampleWidth={view.sampleWidth}
          working={view.working}
        />
        <GenerationPreview
          dimensions={view.dimensions}
          generation={view.generation}
          mediaUrl={view.mediaUrl}
          onRetry={() => {
            if (!view.generation?.canRetryFinalization) return;
            void retry.execute({
              operationId: view.generation.operationId,
              expectedEpoch: view.generation.finalizationRetryEpoch,
              receipt: crypto.randomUUID(),
            });
          }}
          pending={view.pending}
          phase={view.phase}
          retrying={retry.isPending}
          status={view.status}
        />
      </div>
      <AnalysisFooter
        disabled={view.footerDisabled}
        onBack={onBack}
        onPrimary={() => void approveImage()}
        pending={approve.isPending}
        pendingLabel={t("actions.approveFinal")}
        primaryLabel={t(view.primaryLabelKey)}
      />
    </>
  );
}

type OutputDimensions =
  (typeof MARKET_CHART_OUTPUT_DIMENSIONS)[keyof typeof MARKET_CHART_OUTPUT_DIMENSIONS];

type GenerationActionState = {
  code: string | undefined;
  pending: boolean;
  status: string;
};

function generationWorkspaceView(
  analysis: MarketAnalysisProjection,
  options: MarketAnalysisOptionsProjection,
  generate: GenerationActionState,
  retry: GenerationActionState,
  approve: GenerationActionState,
) {
  const generation = analysis.generation;
  const phase = generation?.phase;
  const status = imageStatus(analysis);
  const mediaUrl = generation?.finalMediaAssetId
    ? `/api/media/${generation.finalMediaAssetId}`
    : null;
  const dimensions =
    MARKET_CHART_OUTPUT_DIMENSIONS[analysis.outputFormat ?? "portrait"];
  const chartUrl = analysis.currentChartMediaAssetId
    ? `/api/media/${analysis.currentChartMediaAssetId}`
    : null;
  const { variant } = findComposition(
    options,
    analysis.designFamilyKey,
    analysis.designVariantKey,
  );
  const finalApproval = analysis.approvals.final.fingerprint;
  const pending = generate.pending || retry.pending || approve.pending;
  return {
    actionError: generationActionError(generate, retry, approve),
    chartUrl,
    dimensions,
    finalApproval,
    footerDisabled: pending || (!finalApproval && !mediaUrl),
    generating: generate.pending || status === "generating",
    generation,
    generationRequired: !finalApproval && !mediaUrl && status !== "generating",
    hasGeneration: Boolean(generation),
    mediaUrl,
    pending,
    phase,
    primaryLabelKey: finalApproval
      ? ("shell.continue" as const)
      : ("actions.approveFinal" as const),
    sampleHeight: variant?.sample.height ?? dimensions.height,
    sampleSrc: variant?.sample.url ?? null,
    sampleWidth: variant?.sample.width ?? dimensions.width,
    status,
    working: status === "generating" || pending,
  };
}

function generationActionError(
  generate: GenerationActionState,
  retry: GenerationActionState,
  approve: GenerationActionState,
) {
  if (generate.status === "error") return generate.code;
  if (retry.status === "error") return retry.code;
  if (approve.status === "error") return approve.code;
  return undefined;
}

function generationFormValues(
  analysis: MarketAnalysisProjection,
  options: MarketAnalysisOptionsProjection,
): Values {
  return {
    analysisId: analysis.id,
    expectedVersion: analysis.version,
    idempotencyKey: crypto.randomUUID(),
    imageOptionKey: analysis.imageOptionKey ?? options.defaultImageOptionKey,
    operatorDirection: analysis.operatorDirection ?? "",
  };
}

function GenerationSetup({
  actionError,
  chartUrl,
  control,
  dimensions,
  generating,
  generationRequired,
  hasGeneration,
  imageOptions,
  onChange,
  onSubmit,
  resolveError,
  sampleHeight,
  sampleSrc,
  sampleWidth,
  working,
}: {
  actionError?: string;
  chartUrl: string | null;
  control: Control<Values>;
  dimensions: OutputDimensions;
  generating: boolean;
  generationRequired: boolean;
  hasGeneration: boolean;
  imageOptions: MarketAnalysisOptionsProjection["imageOptions"];
  onChange: () => void;
  onSubmit: ComponentProps<"form">["onSubmit"];
  resolveError: (code: string | undefined) => string;
  sampleHeight: number;
  sampleSrc: string | null;
  sampleWidth: number;
  working: boolean;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <BackgroundGradient className="h-full" containerClassName="min-w-0">
      <section className="flex h-full min-w-0 flex-col gap-4 p-4">
        <h2 className="ticket-label text-muted-foreground">
          {t("generate.setupTitle")}
        </h2>
        <form
          className="grid min-w-0 gap-4"
          noValidate
          onChange={onChange}
          onSubmit={onSubmit}
        >
          {actionError ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("generate.actionFailed")}</AlertTitle>
              <AlertDescription>
                {resolveError(actionError)} {t("generate.errors.recovery")}
              </AlertDescription>
            </Alert>
          ) : null}
          <FormSelectField
            control={control}
            disabled={working}
            label={t("generate.model")}
            name="imageOptionKey"
            options={imageOptions.map((model) => ({
              label: (
                <span className="flex items-center gap-2">
                  <ModelIcon
                    className="size-4 shrink-0"
                    vendor={model.vendor}
                  />
                  {model.name}
                </span>
              ),
              value: model.key,
            }))}
            resolveError={resolveError}
          />
          <FormTextareaField
            autoComplete="off"
            className="min-h-24"
            control={control}
            dir="auto"
            description={t("generate.directionHint")}
            disabled={working}
            label={t("generate.direction")}
            name="operatorDirection"
            placeholder={t("generate.directionPlaceholder")}
            resolveError={resolveError}
            rows={4}
          />
          <section className="grid min-w-0 gap-2">
            <h3 className="font-medium text-sm">{t("generate.references")}</h3>
            <ReferenceRow
              alt={t("generate.reference1Alt")}
              caption={t("generate.reference1Caption")}
              height={sampleHeight}
              src={sampleSrc}
              title={t("generate.reference1")}
              width={sampleWidth}
            />
            <ReferenceRow
              alt={t("generate.reference2Alt")}
              caption={t("generate.reference2Caption")}
              height={dimensions.height}
              src={chartUrl}
              title={t("generate.reference2")}
              width={dimensions.width}
            />
            <p className="flex min-w-0 items-start gap-2 text-muted-foreground">
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t("generate.referenceNote")}
            </p>
          </section>
          <Button
            className={cn(
              "justify-self-start",
              generationRequired && !working && imageOptions.length > 0
                ? "ready-ring"
                : undefined,
            )}
            disabled={working || imageOptions.length === 0}
            type="submit"
          >
            {generating ? (
              <Spinner
                data-icon="inline-start"
                label={t("generate.starting")}
              />
            ) : null}
            {t(hasGeneration ? "generate.regenerate" : "generate.start")}
          </Button>
        </form>
      </section>
    </BackgroundGradient>
  );
}

function GenerationPreview({
  dimensions,
  generation,
  mediaUrl,
  onRetry,
  pending,
  phase,
  retrying,
  status,
}: {
  dimensions: OutputDimensions;
  generation: MarketAnalysisProjection["generation"];
  mediaUrl: string | null;
  onRetry: () => void;
  pending: boolean;
  phase: Phase | undefined;
  retrying: boolean;
  status: ReturnType<typeof imageStatus>;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <h2 className="ticket-label text-muted-foreground">
          {t("generate.previewTitle")}
        </h2>
        <CardAction className="flex items-center gap-1.5 text-sm">
          <StateMark state={STATUS_MARKS[status]} />
          {t(`generate.statuses.${status}`)}
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 grow flex-col gap-4">
        {generation?.fallbackCode ? (
          <Alert>
            <InfoIcon />
            <AlertTitle>{t("generate.fallbackTitle")}</AlertTitle>
            <AlertDescription>
              {t(`generate.fallback.${generation.fallbackCode}`)}
            </AlertDescription>
          </Alert>
        ) : null}
        {phase && status === "generating" ? (
          <GenerationPlaceholder
            className="min-h-0 grow"
            height={dimensions.height}
            label={t(`generate.phaseBody.${phase}`)}
            width={dimensions.width}
          />
        ) : mediaUrl ? (
          <Image
            alt={t("generate.finalAlt")}
            className="min-h-0 w-full grow rounded-lg border bg-muted object-contain"
            height={dimensions.height}
            loading="eager"
            src={mediaUrl}
            unoptimized
            width={dimensions.width}
          />
        ) : (
          <Empty className="min-h-48 grow border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ImageIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("generate.previewEmpty")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2">
        <Button
          className="data-disabled:pointer-events-none data-disabled:opacity-50"
          disabled={!mediaUrl}
          nativeButton={false}
          render={
            <a
              aria-label={t("generate.download")}
              href={mediaUrl ? `${mediaUrl}?download=1` : undefined}
            />
          }
          variant="outline"
        >
          <DownloadIcon aria-hidden="true" data-icon="inline-start" />
          {t("generate.download")}
        </Button>
        {generation?.canRetryFinalization ? (
          <Button
            disabled={pending}
            onClick={onRetry}
            type="button"
            variant="outline"
          >
            {retrying ? (
              <Spinner
                data-icon="inline-start"
                label={t("generate.retryFinalization")}
              />
            ) : null}
            {t("generate.retryFinalization")}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function ReferenceRow({
  alt,
  caption,
  height,
  src,
  title,
  width,
}: {
  alt: string;
  caption: string;
  height: number;
  src: string | null;
  title: string;
  width: number;
}) {
  return (
    <figure className="grid min-h-24 min-w-0 grid-cols-[6rem_minmax(0,1fr)] overflow-hidden rounded-lg border">
      {src ? (
        <Image
          alt={alt}
          className="size-full border-e bg-muted object-cover"
          height={height}
          loading="eager"
          src={src}
          unoptimized
          width={width}
        />
      ) : (
        <span className="border-e border-dashed bg-muted" />
      )}
      <div className="grid min-w-0 content-center gap-1 p-3">
        <figcaption className="font-medium text-sm">{title}</figcaption>
        <p className="text-muted-foreground text-sm">{caption}</p>
      </div>
    </figure>
  );
}

export function GenerateSidebarRows({
  analysis,
  options,
}: {
  analysis: MarketAnalysisProjection;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { family, variant } = findComposition(
    options,
    analysis.designFamilyKey,
    analysis.designVariantKey,
  );
  return (
    <div className="grid min-w-0 gap-2 border-t pt-2">
      <dl className="grid min-w-0 gap-2">
        <ProjectRow
          icon={<LayersIcon aria-hidden="true" className="size-4" />}
          label={t("design.family")}
          value={family?.displayName ?? t("design.noSelection")}
        />
        <ProjectRow
          icon={<ImageIcon aria-hidden="true" className="size-4" />}
          label={t("design.variant")}
          value={variant?.displayName ?? t("design.noSelection")}
        />
      </dl>
      <p className="text-muted-foreground text-xs">
        {t("generate.sidebarNote")}
      </p>
    </div>
  );
}

const STATUS_MARKS = {
  approved: "succeeded",
  failed: "failed",
  generating: "running",
  idle: "queued",
  review: "waiting",
  stopped: "cancelled",
  unknown: "unknown",
} as const satisfies Record<string, StateMarkState>;

function imageStatus(analysis: MarketAnalysisProjection) {
  if (analysis.approvals.final.fingerprint) return "approved" as const;
  const phase: Phase | undefined = analysis.generation?.phase;
  if (!phase) return "idle" as const;
  if (
    phase === "queued" ||
    phase === "briefing" ||
    phase === "generating" ||
    phase === "finalizing"
  ) {
    return "generating" as const;
  }
  if (phase === "ready") return "review" as const;
  if (phase === "failed") return "failed" as const;
  if (phase === "unknown") return "unknown" as const;
  return "stopped" as const;
}
