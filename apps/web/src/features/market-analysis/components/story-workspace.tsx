"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { DIRECTION, UI_FONT } from "@rz-chain-reporter/i18n";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Input } from "@rz-chain-reporter/ui/components/input";
import { Textarea } from "@rz-chain-reporter/ui/components/textarea";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  ScalingIcon,
  SparklesIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

import type { Control, FieldPath, UseFormReturn } from "react-hook-form";
import { useForm, useFormState, useWatch } from "react-hook-form";
import type { z } from "zod";
import { FormField } from "@/components/form/form-field";
import { applyActionErrorToForm, useAction } from "@/hooks/use-action";
import { approveMarketStoryAction } from "../actions/commands";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { useAdvanceOnApproval } from "../hooks/use-advance-on-approval";
import { useMarketActionError } from "../hooks/use-market-action-error";
import { formatMarketChange } from "../lib/format";
import { descriptorOf } from "../lib/snapshot";
import {
  approveStoryInputSchema,
  MARKET_STORY_HEADLINE_MAX,
  MARKET_STORY_TEXT_MAX,
} from "../schemas/commands";
import type { MarketAnalysisProjection } from "../schemas/reads";
import { AnalysisFooter } from "./analysis-footer";

const STORY_FORM_ID = "story-copy-form";

type Values = z.input<typeof approveStoryInputSchema>;

export function useStoryForm(analysis: MarketAnalysisProjection) {
  const suggested = analysis.storySuggestions[0];
  const values: Values = {
    analysisId: analysis.id,
    expectedVersion: analysis.version,
    headline: analysis.storyHeadline ?? suggested?.headline ?? "",
    supportingText:
      analysis.storySupportingText ?? suggested?.supportingText ?? "",
  };
  const form = useForm<Values>({
    defaultValues: values,
    mode: "onChange",
    resetOptions: { keepDirtyValues: true },
    resolver: zodResolver(approveStoryInputSchema),
    values,
  });
  return { form, values };
}

export function StoryWorkspace({
  analysis,
  authoritativeValues,
  form,
  onBack,
  onContinue,
  onDirtyChange,
}: {
  analysis: MarketAnalysisProjection;
  authoritativeValues: Values;
  form: UseFormReturn<Values>;
  onBack?: () => void;
  onContinue: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const resolveError = useMarketActionError();
  const approve = useAction(approveMarketStoryAction);
  const { errors, isDirty } = useFormState({ control: form.control });
  const headline = useWatch({ control: form.control, name: "headline" });
  const supportingText = useWatch({
    control: form.control,
    name: "supportingText",
  });
  const pending = approve.isPending;
  const contentDirection = DIRECTION[analysis.contentLocale];
  const contentStyle = { fontFamily: UI_FONT[analysis.contentLocale] };
  const suggestions = analysis.storySuggestions;
  const verifiedSeries =
    analysis.currentSnapshot?.series.filter(
      (series) => series.outcome === "succeeded",
    ).length ?? 0;
  const suggestionsId = useId();
  const storyApproval = analysis.approvals.story.fingerprint;
  const awaitApproval = useAdvanceOnApproval(storyApproval, onContinue);

  const applySuggestion = (suggestion: (typeof suggestions)[number]) => {
    form.setValue("headline", suggestion.headline, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue("supportingText", suggestion.supportingText, {
      shouldDirty: true,
      shouldValidate: true,
    });
    onDirtyChange(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await approve.execute(values);
    if (result.status === "error") {
      applyActionErrorToForm(form.setError, result, form.setFocus);
      return;
    }
    form.reset({
      ...values,
      expectedVersion: result.data?.version ?? values.expectedVersion,
    });
    onDirtyChange(false);
    if (storyApproval) {
      onContinue();
      return;
    }
    awaitApproval();
  });

  return (
    <>
      <form
        className="grid min-w-0 gap-4"
        id={STORY_FORM_ID}
        noValidate
        onChange={() => onDirtyChange(true)}
        onSubmit={onSubmit}
      >
        {errors.root?.server ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("story.saveFailed")}</AlertTitle>
            <AlertDescription>
              {resolveError(errors.root.server.message)}
            </AlertDescription>
          </Alert>
        ) : null}
        <CopyField
          contentLocale={analysis.contentLocale}
          control={form.control}
          label={t("story.headline")}
          max={MARKET_STORY_HEADLINE_MAX}
          name="headline"
          resolveError={resolveError}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {suggestions.length > 0 ? (
            <>
              <span
                className="ticket-label text-muted-foreground"
                id={suggestionsId}
              >
                {t("story.suggestions")}
              </span>
              <ul
                aria-labelledby={suggestionsId}
                className="flex min-w-0 flex-wrap items-center gap-2"
              >
                {suggestions.map((suggestion, index) => {
                  const active =
                    headline === suggestion.headline &&
                    supportingText === suggestion.supportingText;
                  const recommended = index === 0;
                  return (
                    <li key={suggestion.kind}>
                      <Button
                        aria-pressed={active}
                        disabled={pending}
                        onClick={() => applySuggestion(suggestion)}
                        size="sm"
                        title={suggestion.headline}
                        type="button"
                        variant="outline"
                      >
                        {active ? (
                          <CheckIcon
                            aria-hidden="true"
                            data-icon="inline-start"
                          />
                        ) : recommended ? (
                          <SparklesIcon
                            aria-hidden="true"
                            className="text-primary"
                            data-icon="inline-start"
                          />
                        ) : null}
                        {t(`story.angles.${suggestion.kind}`)}
                        {recommended ? (
                          <span className="sr-only">
                            {t("story.suggested")}
                          </span>
                        ) : null}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <Button
            className="ms-auto"
            disabled={pending || !isDirty}
            onClick={() => {
              form.reset(authoritativeValues, { keepDirtyValues: false });
              onDirtyChange(false);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("story.resetCopy")}
          </Button>
        </div>
        <CopyField
          contentLocale={analysis.contentLocale}
          control={form.control}
          label={t("story.chartText")}
          max={MARKET_STORY_TEXT_MAX}
          multiline
          name="supportingText"
          resolveError={resolveError}
        />
        <VerifiedFacts analysis={analysis} />
        <section className="grid min-w-0 gap-2">
          <h2 className="ticket-label text-muted-foreground">
            {t("story.hierarchy")}
          </h2>
          <div
            className="grid min-w-0 gap-2 rounded-lg border p-4"
            dir={contentDirection}
            lang={analysis.contentLocale}
            style={contentStyle}
          >
            <span className="ticket-label text-muted-foreground">
              {t("story.eyebrow", {
                count: verifiedSeries,
                period: t(
                  `create.periods.${analysis.normalizedRequest.period}`,
                ),
              })}
            </span>
            <p className="text-balance font-semibold text-3xl leading-tight">
              {headline || t("story.headlinePlaceholder")}
            </p>
            <p className="max-w-prose text-base text-muted-foreground leading-7">
              {supportingText || t("story.supportingPlaceholder")}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("story.source", { brand: analysis.mediaBrandName })}
            </p>
          </div>
        </section>
      </form>
      <AnalysisFooter
        form={STORY_FORM_ID}
        onBack={onBack}
        pending={pending}
        pendingLabel={t("story.saving")}
        primaryLabel={t("actions.approveStory")}
      />
    </>
  );
}

function CopyField({
  contentLocale,
  control,
  label,
  max,
  multiline = false,
  name,
  resolveError,
}: {
  contentLocale: ContentLocale;
  control: Control<Values>;
  label: string;
  max: number;
  multiline?: boolean;
  name: FieldPath<Values>;
  resolveError: (code: string | undefined) => string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <FormField control={control} name={name} resolveError={resolveError}>
      {({ controlId, controlProps, field }) => {
        const value = String(field.value ?? "");
        const full = value.length >= max;
        const shared = {
          ...controlProps,
          autoComplete: "off" as const,
          dir: DIRECTION[contentLocale],
          lang: contentLocale,
          maxLength: max,
          name: field.name,
          onBlur: field.onBlur,
          onChange: field.onChange,
          style: { fontFamily: UI_FONT[contentLocale] },
          value,
        };
        return (
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="ticket-label" htmlFor={controlId}>
                {label}
              </label>
              <Bdi
                className={cn(
                  "text-xs tabular-nums",
                  full ? "text-caution" : "text-muted-foreground",
                )}
              >
                {t("story.counter", { count: value.length, max })}
              </Bdi>
            </div>
            {multiline ? (
              <Textarea
                {...shared}
                className="min-h-28"
                ref={field.ref}
                rows={4}
              />
            ) : (
              <Input {...shared} ref={field.ref} />
            )}
            <span aria-live="polite" className="sr-only">
              {full ? t("story.counterFull") : null}
            </span>
          </div>
        );
      }}
    </FormField>
  );
}

function VerifiedFacts({ analysis }: { analysis: MarketAnalysisProjection }) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const locale = useLocale();
  const colors = analysis.currentChartSpec?.seriesColors ?? {};
  return (
    <section className="grid min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="ticket-label text-muted-foreground">
          {t("story.facts")}
        </h2>
        <LockIcon
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        <p className="text-muted-foreground text-xs">
          {t("story.factsLocked")}
        </p>
      </div>
      <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3 rounded-lg border p-4">
        {analysis.currentSnapshot?.series.flatMap((series) => {
          if (series.outcome !== "succeeded") return [];
          const descriptor = descriptorOf(analysis, series.descriptorIdentity);
          return [
            <Fact
              icon={
                <span
                  aria-hidden="true"
                  className="block size-3 rounded-full border"
                  style={{ backgroundColor: colors[series.descriptorIdentity] }}
                />
              }
              key={series.descriptorIdentity}
              label={descriptor?.symbol ?? series.descriptorIdentity}
              value={formatMarketChange(series.changePercent, locale)}
              valueClassName="tabular-nums"
            />,
          ];
        })}
        <Fact
          icon={<ClockIcon aria-hidden="true" className="size-4" />}
          label={t("shell.period")}
          value={t(`create.periods.${analysis.normalizedRequest.period}`)}
        />
        <Fact
          icon={<ScalingIcon aria-hidden="true" className="size-4" />}
          label={t("shell.scale")}
          value={t(`create.scales.${analysis.normalizedRequest.scale}`)}
        />
      </dl>
    </section>
  );
}

function Fact({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="grid min-w-0 gap-0.5">
        <dt className="ticket-label text-muted-foreground">
          <Bdi>{label}</Bdi>
        </dt>
        <dd className={cn("font-medium text-sm", valueClassName)}>
          <Bdi>{value}</Bdi>
        </dd>
      </div>
    </div>
  );
}

export function StorySidebarPreview({
  analysis,
  control,
}: {
  analysis: MarketAnalysisProjection;
  control: Control<Values>;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const headline = useWatch({ control, name: "headline" });
  const supportingText = useWatch({ control, name: "supportingText" });
  const approved = Boolean(analysis.approvals.story.fingerprint);
  return (
    <div className="grid min-w-0 gap-2 border-t pt-4 text-xs">
      <div className="grid min-w-0 gap-0.5">
        <span className="ticket-label text-muted-foreground">
          {t("story.headlinePreview")}
        </span>
        <Bdi
          className="font-medium"
          dir={DIRECTION[analysis.contentLocale]}
          lang={analysis.contentLocale}
        >
          {headline || t("story.notWritten")}
        </Bdi>
      </div>
      <div className="grid min-w-0 gap-0.5">
        <span className="ticket-label text-muted-foreground">
          {t("story.textPreview")}
        </span>
        <Bdi
          className="text-muted-foreground"
          dir={DIRECTION[analysis.contentLocale]}
          lang={analysis.contentLocale}
        >
          {supportingText || t("story.notWritten")}
        </Bdi>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-muted-foreground">{t("story.status")}</span>
        <span className="font-medium">
          {t(approved ? "story.statusApproved" : "story.statusAwaiting")}
        </span>
      </div>
    </div>
  );
}
