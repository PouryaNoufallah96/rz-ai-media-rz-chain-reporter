"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  MARKET_CHART_OUTPUT_DIMENSIONS,
  type MarketOutputFormat,
} from "@rz-chain-reporter/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ImageIcon,
  LaptopIcon,
  LayersIcon,
  LayoutGridIcon,
  ScaleIcon,
  SmartphoneIcon,
  TrendingUpIcon,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ComponentType, ReactNode, SVGProps } from "react";
import type { Control, UseFormReturn } from "react-hook-form";
import { useForm, useFormState, useWatch } from "react-hook-form";
import type { z } from "zod";

import { FormToggleGroupField } from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";

import { approveMarketDesignAction } from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useAdvanceOnApproval } from "../hooks/use-advance-on-approval";
import { useMarketActionError } from "../hooks/use-market-action-error";
import { findComposition } from "../lib/compositions";
import { approveDesignInputSchema } from "../schemas/commands";
import type {
  MarketAnalysisOptionsProjection,
  MarketAnalysisProjection,
} from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";
import { ProjectRow } from "./current-project-sidebar";

const DESIGN_FORM_ID = "design-family-form";
const SELECT_OPTIONS = { shouldDirty: true, shouldValidate: true };

type Values = z.input<typeof approveDesignInputSchema>;
type Family = MarketAnalysisOptionsProjection["compositions"][number];
type Variant = Family["variants"][number];
type Translate = ReturnType<
  typeof useTranslations<typeof MARKET_ANALYSIS_NAMESPACE>
>;

const FAMILY_ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  combined: LayersIcon,
  contrast: ScaleIcon,
  growth: TrendingUpIcon,
  laptop: LaptopIcon,
  phone: SmartphoneIcon,
  separated: LayoutGridIcon,
};

export function useDesignForm(
  analysis: MarketAnalysisProjection,
  options: MarketAnalysisOptionsProjection,
) {
  const found = findComposition(
    options,
    analysis.designFamilyKey,
    analysis.designVariantKey,
  );
  const family = found.family ?? options.compositions[0];
  const variant = found.variant ?? family?.variants[0];
  const values: Values = {
    analysisId: analysis.id,
    expectedVersion: analysis.version,
    familyKey: family?.key ?? "",
    variantKey: variant?.key ?? "",
  };
  const form = useForm<Values>({
    defaultValues: values,
    mode: "onChange",
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(approveDesignInputSchema, undefined, { raw: true }),
    values,
  });
  return { form, values };
}

export function DesignWorkspace({
  analysis,
  form,
  onBack,
  onContinue,
  onDirtyChange,
  options,
}: {
  analysis: MarketAnalysisProjection;
  form: UseFormReturn<Values>;
  onBack?: () => void;
  onContinue: () => void;
  onDirtyChange: (dirty: boolean) => void;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const outputFormat = analysis.outputFormat ?? options.outputFormat;
  const resolveError = useMarketActionError();
  const approve = useAction(approveMarketDesignAction);
  const { errors } = useFormState({ control: form.control });
  const {
    family: selectedFamily,
    variant: selectedVariant,
    variantKey,
  } = useSelection(form.control, options);
  const pending = approve.isPending;
  const designApproval = analysis.approvals.design.fingerprint;
  const awaitApproval = useAdvanceOnApproval(designApproval, onContinue);
  const families = options.compositions.filter(
    (family) => family.variants.length > 0,
  );

  const selectVariant = (variantKey: string) => {
    form.setValue("variantKey", variantKey, SELECT_OPTIONS);
    onDirtyChange(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await approve.execute({
      analysisId: values.analysisId,
      expectedVersion: analysis.version,
      familyKey: values.familyKey,
      variantKey: values.variantKey,
    });
    if (result.status === "error") {
      applyActionErrorToForm(form.setError, result, form.setFocus);
      return;
    }
    form.reset({
      ...values,
      expectedVersion: result.data?.version ?? values.expectedVersion,
    });
    onDirtyChange(false);
    if (designApproval) {
      onContinue();
      return;
    }
    awaitApproval();
  });

  if (!selectedFamily || !selectedVariant) {
    return (
      <>
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("design.notReadyTitle")}</AlertTitle>
          <AlertDescription>{t("design.notReadyBody")}</AlertDescription>
        </Alert>
        <AnalysisFooter
          disabled
          onBack={onBack}
          pending={false}
          pendingLabel={t("design.saving")}
          primaryLabel={t("actions.approveDesign")}
        />
      </>
    );
  }

  const blockingReasons = incompatibilityReasons(selectedVariant, analysis, t);

  return (
    <>
      <form
        className="grid min-w-0 gap-4"
        id={DESIGN_FORM_ID}
        noValidate
        onSubmit={onSubmit}
      >
        {errors.root?.server ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("design.saveFailed")}</AlertTitle>
            <AlertDescription>
              {resolveError(errors.root.server.message)}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormToggleGroupField
          control={form.control}
          groupClassName="grid @md:grid-cols-2 @3xl:grid-cols-3 gap-1"
          label={t("design.family")}
          name="familyKey"
          onValueChange={(value) => {
            const first = families.find((item) => item.key === value)
              ?.variants[0];
            if (first) selectVariant(first.key);
          }}
          options={families.map((family) => {
            const FamilyIcon = FAMILY_ICONS[family.key] ?? ImageIcon;
            return {
              label: (
                <span className="flex w-full min-w-0 items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <FamilyIcon aria-hidden="true" className="size-4" />
                    <Bdi>{family.displayName}</Bdi>
                  </div>
                  <span className="text-muted-foreground">
                    {t("design.versionCount", {
                      count: family.variants.length,
                    })}
                  </span>
                </span>
              ),
              value: family.key,
            };
          })}
          resolveError={resolveError}
        />
        <fieldset className="grid min-w-0 gap-2">
          <legend className="min-w-0 font-medium text-sm">
            <Bdi>{selectedFamily.displayName}</Bdi>
          </legend>
          <div className="grid min-w-0 @lg:grid-cols-3 gap-2">
            {selectedFamily.variants.map((variant, index) => {
              const reasons = incompatibilityReasons(variant, analysis, t);
              const unusable = reasons.length > 0;
              const selected = variant.key === variantKey;
              return (
                <Button
                  aria-pressed={selected}
                  className="h-auto min-w-0 flex-col items-stretch gap-2 whitespace-normal p-2"
                  disabled={unusable}
                  key={variant.key}
                  onClick={() => selectVariant(variant.key)}
                  type="button"
                  variant="outline"
                >
                  <SampleFrame outputFormat={outputFormat}>
                    <Image
                      alt=""
                      className="size-full object-contain"
                      draggable={false}
                      height={variant.sample.height}
                      loading={selected ? "eager" : "lazy"}
                      src={variant.sample.url}
                      unoptimized
                      width={variant.sample.width}
                    />
                    {selected ? (
                      <span className="absolute inset-e-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <CheckIcon aria-hidden="true" className="size-3.5" />
                      </span>
                    ) : null}
                  </SampleFrame>
                  <Bdi className="min-h-10 min-w-0 text-sm">
                    {t("design.versionLabel", {
                      index: index + 1,
                      name: variant.displayName,
                    })}
                  </Bdi>
                  {unusable ? (
                    <span className="text-caution">{reasons[0]}</span>
                  ) : null}
                </Button>
              );
            })}
          </div>
          {blockingReasons.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("design.incompatibleTitle")}</AlertTitle>
              <AlertDescription>{blockingReasons.join(" ")}</AlertDescription>
            </Alert>
          ) : null}
        </fieldset>
      </form>
      <AnalysisFooter
        disabled={blockingReasons.length > 0}
        form={DESIGN_FORM_ID}
        onBack={onBack}
        pending={pending}
        pendingLabel={t("design.saving")}
        primaryLabel={t("actions.approveDesign")}
      />
    </>
  );
}

function useSelection(
  control: Control<Values>,
  options: MarketAnalysisOptionsProjection,
) {
  const familyKey = useWatch({ control, name: "familyKey" });
  const variantKey = useWatch({ control, name: "variantKey" });
  return { ...findComposition(options, familyKey, variantKey), variantKey };
}

function SampleFrame({
  children,
  className,
  outputFormat,
}: {
  children: ReactNode;
  className?: string;
  outputFormat: MarketOutputFormat;
}) {
  const dimensions = MARKET_CHART_OUTPUT_DIMENSIONS[outputFormat];
  return (
    <span
      className={cn(
        "relative block min-w-0 overflow-hidden rounded-lg bg-muted",
        className,
      )}
      style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
    >
      {children}
    </span>
  );
}

export function DesignSamplePreview({
  control,
  options,
  outputFormat,
}: {
  control: Control<Values>;
  options: MarketAnalysisOptionsProjection;
  outputFormat: MarketOutputFormat;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { variant } = useSelection(control, options);
  return (
    <div className="grid min-w-0 gap-2">
      <span className="ticket-label text-muted-foreground">
        {t("design.reference")}
      </span>
      {variant ? (
        <SampleFrame className="border" outputFormat={outputFormat}>
          <Image
            alt={t("design.referenceAlt", { variant: variant.displayName })}
            className="size-full object-contain"
            height={variant.sample.height}
            loading="eager"
            src={variant.sample.url}
            unoptimized
            width={variant.sample.width}
          />
        </SampleFrame>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("design.noSelection")}
        </p>
      )}
    </div>
  );
}

export function DesignSidebarRows({
  control,
  options,
}: {
  control: Control<Values>;
  options: MarketAnalysisOptionsProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const { family, variant } = useSelection(control, options);
  return (
    <dl className="grid min-w-0 gap-2 border-t pt-2">
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
  );
}

function incompatibilityReasons(
  variant: Variant,
  analysis: MarketAnalysisProjection,
  t: Translate,
) {
  const reasons: string[] = [];
  const outputFormat: MarketOutputFormat | null = analysis.outputFormat;
  if (!outputFormat || !variant.formats.includes(outputFormat)) {
    reasons.push(t("design.reasonFormat"));
  }
  const count = analysis.normalizedRequest.series.length;
  if (count < variant.minSeries || count > variant.maxSeries) {
    reasons.push(
      t("design.reasonSeries", {
        min: variant.minSeries,
        max: variant.maxSeries,
      }),
    );
  }
  if (!variant.allowedScales.includes(analysis.normalizedRequest.scale)) {
    reasons.push(t("design.reasonScale"));
  }
  return reasons;
}
