"use client";

import { OPERATION_IN_PROGRESS_LIFECYCLES } from "@rz-chain-reporter/contracts";
import { useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import {
  MARKET_SETUP_STATUS_MARKS,
  marketSetupStatus,
} from "../lib/market-request";
import type {
  MarketAnalysisCatalogProjection,
  MarketAnalysisOptionsProjection,
  MarketAnalysisProjection,
} from "../schemas/reads";
import {
  analysisStepSearchParsers,
  MARKET_ANALYSIS_STEPS,
} from "../schemas/search";
import {
  AnalysisWorkspaceFrame,
  type MarketAnalysisStep,
} from "./analysis-workspace-frame";
import { ChartSidebarPreview, ChartWorkspace } from "./chart-workspace";
import { CurrentProjectSidebar } from "./current-project-sidebar";
import {
  DesignSamplePreview,
  DesignSidebarRows,
  DesignWorkspace,
  useDesignForm,
} from "./design-workspace";
import { GenerateSidebarRows, GenerateWorkspace } from "./generate-workspace";
import { MarketAnalysisFreshness } from "./market-analysis-freshness";
import { MarketSnapshotDetail } from "./market-snapshot-detail";
import { MarketWorkspace } from "./market-workspace";
import { PublishSidebarChecklist } from "./publish-sidebar-checklist";
import { PublishSidebarPreview } from "./publish-sidebar-preview";
import { PublishWorkspace } from "./publish-workspace";
import {
  StorySidebarPreview,
  StoryWorkspace,
  useStoryForm,
} from "./story-workspace";

export function AnalysisWorkspace({
  analysis,
  catalog,
  options,
}: {
  analysis: MarketAnalysisProjection;
  catalog: MarketAnalysisCatalogProjection;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const story = useStoryForm(analysis);
  const design = useDesignForm(analysis, options);
  const [dirty, setDirty] = useState(false);
  const [pendingStep, setPendingStep] = useState<MarketAnalysisStep | null>(
    null,
  );
  const [values, setValues] = useQueryStates(analysisStepSearchParsers, {
    history: "push",
  });
  const [requestedStep] = useState(() => values.step);
  const reachable = reachableSteps(analysis);
  const completed = completedSteps(analysis);
  const fallback = reachable.at(-1) ?? "market";
  const selected =
    values.step && reachable.includes(values.step) ? values.step : fallback;

  useEffect(() => {
    if (values.step !== selected)
      void setValues({ step: selected }, { history: "replace" });
  }, [selected, setValues, values.step]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const activeIndex = MARKET_ANALYSIS_STEPS.indexOf(selected);
  const previousStep = MARKET_ANALYSIS_STEPS[activeIndex - 1];
  const selectStep = (step: MarketAnalysisStep) => {
    if (step === selected) return;
    if (dirty) {
      setPendingStep(step);
      return;
    }
    void setValues({ step });
  };
  const continueToNext = () => {
    const next = MARKET_ANALYSIS_STEPS[activeIndex + 1];
    if (next && reachable.includes(next)) void setValues({ step: next });
  };
  const status = marketSetupStatus(analysis);
  const loading = loadingStep(analysis, status === "fetching");
  const onBack = previousStep ? () => selectStep(previousStep) : undefined;

  return (
    <>
      <MarketAnalysisFreshness analysisId={analysis.id} />
      <AnalysisWorkspaceFrame
        completed={completed}
        description={t(`${selected}.description`)}
        historyHref={{
          pathname: "/market-analysis",
          query: { view: "history" },
        }}
        loading={loading}
        onStep={selectStep}
        reachable={reachable}
        selected={selected}
        sidebar={
          <AnalysisSidebar
            analysis={analysis}
            design={design}
            options={options}
            selected={selected}
            status={status}
            story={story}
          />
        }
        sidebarFooter={analysisSidebarFooter(analysis, selected)}
        title={t(`${selected}.title`)}
      >
        <AnalysisStep
          analysis={analysis}
          catalog={catalog}
          continueWhenVerified={requestedStep === "chart"}
          design={design}
          onBack={onBack}
          onContinue={continueToNext}
          onDirtyChange={setDirty}
          options={options}
          selected={selected}
          story={story}
        />
      </AnalysisWorkspaceFrame>
      <ConfirmDialog
        cancelLabel={t("dirty.stay")}
        confirmLabel={t("dirty.discard")}
        description={t("dirty.description")}
        fallbackError={t("dirty.error")}
        onConfirm={() => {
          if (pendingStep) void setValues({ step: pendingStep });
          story.form.reset(story.values, { keepDirtyValues: false });
          design.form.reset(design.values, { keepDirtyValues: false });
          setDirty(false);
          setPendingStep(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingStep(null);
        }}
        open={pendingStep !== null}
        pendingLabel={t("dirty.discarding")}
        title={t("dirty.title")}
      />
    </>
  );
}

function AnalysisSidebar({
  analysis,
  design,
  options,
  selected,
  status,
  story,
}: {
  analysis: MarketAnalysisProjection;
  design: ReturnType<typeof useDesignForm>;
  options: MarketAnalysisOptionsProjection;
  selected: MarketAnalysisStep;
  status: ReturnType<typeof marketSetupStatus>;
  story: ReturnType<typeof useStoryForm>;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const primarySeries = analysis.normalizedRequest.series.filter(
    (series) => series.role === "primary",
  );
  const visualOwner = options.instruments.find(
    (instrument) => instrument.id === analysis.visualOwnerInstrumentId,
  );
  return (
    <CurrentProjectSidebar
      comparisons={analysis.normalizedRequest.series.flatMap((series) =>
        series.role === "comparison" ? [series.displayName] : [],
      )}
      contentLocale={analysis.contentLocale}
      icon={visualOwner?.icon ?? null}
      outputFormat={analysis.outputFormat ?? options.outputFormat}
      owner={analysis.visualOwnerName}
      period={analysis.normalizedRequest.period}
      preview={analysisSidebarPreview(analysis, design, options, selected)}
      primaries={primarySeries.map((series) => series.displayName)}
      scale={analysis.normalizedRequest.scale}
      status={{
        label: t(`market.status.${status}`),
        state: MARKET_SETUP_STATUS_MARKS[status],
      }}
    >
      {analysisSidebarRows(analysis, design, options, selected, story)}
    </CurrentProjectSidebar>
  );
}

function analysisSidebarPreview(
  analysis: MarketAnalysisProjection,
  design: ReturnType<typeof useDesignForm>,
  options: MarketAnalysisOptionsProjection,
  selected: MarketAnalysisStep,
) {
  if (selected === "design") {
    return (
      <DesignSamplePreview
        control={design.form.control}
        options={options}
        outputFormat={analysis.outputFormat ?? options.outputFormat}
      />
    );
  }
  if (selected === "publish") {
    return <PublishSidebarPreview analysis={analysis} />;
  }
  return null;
}

function analysisSidebarRows(
  analysis: MarketAnalysisProjection,
  design: ReturnType<typeof useDesignForm>,
  options: MarketAnalysisOptionsProjection,
  selected: MarketAnalysisStep,
  story: ReturnType<typeof useStoryForm>,
) {
  switch (selected) {
    case "story":
      return (
        <StorySidebarPreview analysis={analysis} control={story.form.control} />
      );
    case "design":
      return (
        <DesignSidebarRows control={design.form.control} options={options} />
      );
    case "generate":
      return <GenerateSidebarRows analysis={analysis} options={options} />;
    case "publish":
      return <PublishSidebarChecklist analysis={analysis} />;
    default:
      return null;
  }
}

function analysisSidebarFooter(
  analysis: MarketAnalysisProjection,
  selected: MarketAnalysisStep,
) {
  if (selected === "market") {
    return <MarketSnapshotDetail analysis={analysis} />;
  }
  if (selected === "chart" || selected === "story") {
    return <ChartSidebarPreview analysis={analysis} />;
  }
  return undefined;
}

function AnalysisStep({
  analysis,
  catalog,
  continueWhenVerified,
  design,
  onBack,
  onContinue,
  onDirtyChange,
  options,
  selected,
  story,
}: {
  analysis: MarketAnalysisProjection;
  catalog: MarketAnalysisCatalogProjection;
  continueWhenVerified: boolean;
  design: ReturnType<typeof useDesignForm>;
  onBack?: () => void;
  onContinue: () => void;
  onDirtyChange: (dirty: boolean) => void;
  options: MarketAnalysisOptionsProjection;
  selected: MarketAnalysisStep;
  story: ReturnType<typeof useStoryForm>;
}) {
  switch (selected) {
    case "market":
      return (
        <MarketWorkspace
          analysis={analysis}
          catalog={catalog}
          continueWhenVerified={continueWhenVerified}
          onBack={onBack}
          onContinue={onContinue}
          options={options}
        />
      );
    case "chart":
      return (
        <ChartWorkspace
          analysis={analysis}
          onBack={onBack}
          onContinue={onContinue}
          onDirtyChange={onDirtyChange}
        />
      );
    case "story":
      return (
        <StoryWorkspace
          analysis={analysis}
          authoritativeValues={story.values}
          form={story.form}
          onBack={onBack}
          onContinue={onContinue}
          onDirtyChange={onDirtyChange}
        />
      );
    case "design":
      return (
        <DesignWorkspace
          analysis={analysis}
          form={design.form}
          onBack={onBack}
          onContinue={onContinue}
          onDirtyChange={onDirtyChange}
          options={options}
        />
      );
    case "generate":
      return (
        <GenerateWorkspace
          analysis={analysis}
          onBack={onBack}
          onContinue={onContinue}
          onDirtyChange={onDirtyChange}
          options={options}
        />
      );
    case "publish":
      return (
        <PublishWorkspace
          analysis={analysis}
          onBack={onBack}
          onDirtyChange={onDirtyChange}
          options={options}
        />
      );
  }
}

const GENERATION_ACTIVE_PHASES = new Set([
  "queued",
  "briefing",
  "generating",
  "finalizing",
]);

function loadingStep(
  analysis: MarketAnalysisProjection,
  fetching: boolean,
): MarketAnalysisStep | null {
  if (fetching) return "market";
  const chartLifecycle = analysis.chartRender?.lifecycle;
  if (
    chartLifecycle &&
    OPERATION_IN_PROGRESS_LIFECYCLES.some((item) => item === chartLifecycle)
  ) {
    return "chart";
  }
  if (
    analysis.generation &&
    GENERATION_ACTIVE_PHASES.has(analysis.generation.phase)
  ) {
    return "generate";
  }
  return null;
}

function completedSteps(analysis: MarketAnalysisProjection) {
  const completed = new Set<MarketAnalysisStep>();
  if (analysis.currentSnapshot) completed.add("market");
  if (analysis.approvals.chart.fingerprint && analysis.currentChartMediaAssetId)
    completed.add("chart");
  if (analysis.approvals.story.fingerprint) completed.add("story");
  if (analysis.approvals.design.fingerprint) completed.add("design");
  if (analysis.approvals.final.fingerprint) completed.add("generate");
  if (analysis.status === "completed") completed.add("publish");
  return completed;
}

function reachableSteps(
  analysis: MarketAnalysisProjection,
): MarketAnalysisStep[] {
  const last = analysis.approvals.final.fingerprint
    ? 5
    : analysis.approvals.design.fingerprint
      ? 4
      : analysis.approvals.story.fingerprint
        ? 3
        : analysis.approvals.chart.fingerprint &&
            analysis.currentChartMediaAssetId
          ? 2
          : analysis.currentSnapshot
            ? 1
            : 0;
  return MARKET_ANALYSIS_STEPS.slice(0, last + 1);
}
