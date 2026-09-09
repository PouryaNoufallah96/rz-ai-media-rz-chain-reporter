"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rz-chain-reporter/ui/components/card";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";
import { postAssistantApproval } from "../lib/approval-request";
import {
  initialMarketValues,
  mergeMarketValues,
  nextMarketQuestion,
  resolveMarketToolIntent,
} from "../lib/market-intent";
import {
  type AssistantMarketLoadResponse,
  type AssistantMarketQuestion,
  type AssistantMarketResult,
  type AssistantMarketToolInput,
  type AssistantMarketValues,
  type AssistantPendingMarket,
  assistantApproveMarketResponseSchema,
  assistantMarketLoadResponseSchema,
  assistantMarketToolInputSchema,
  assistantPrepareMarketResponseSchema,
  type SignedMarketApprovalEnvelope,
} from "../schemas/approval";
import type { MarketActionToolInvocation } from "../schemas/ui-message";
import { AssistantQuestion } from "./assistant-ask-user";

type LoadedMarket = Extract<AssistantMarketLoadResponse, { status: "loaded" }>;

type MarketToolRendererProps = {
  active: boolean;
  envelope: SignedMarketApprovalEnvelope | null;
  invocation: MarketActionToolInvocation;
  onCancel: () => void;
  onEdit: () => void;
  onIntent: (pendingMarket: AssistantPendingMarket) => void;
  onPrepared: (envelope: SignedMarketApprovalEnvelope) => void;
  onResult: (result: AssistantMarketResult) => void;
  result: AssistantMarketResult | null;
  pendingMarket: AssistantPendingMarket | null;
  retainedMarket: AssistantPendingMarket | null;
};

export function MarketToolRenderer(props: MarketToolRendererProps) {
  const {
    active,
    envelope,
    invocation,
    onIntent,
    result,
    pendingMarket,
    retainedMarket,
  } = props;
  const locale = useLocale() === "fa" ? "fa" : "en";
  const parsedToolInput = assistantMarketToolInputSchema.safeParse(
    invocation.input,
  );
  const toolInput = parsedToolInput.success ? parsedToolInput.data : null;
  const mergedIntent = toolInput
    ? resolveMarketToolIntent({ pendingMarket, retainedMarket, toolInput })
    : null;
  const toolCallId = invocation.toolCallId;
  const { loaded, values, setValues, error } = useMarketForm({
    active: active && !result,
    editable: active && !envelope && !result,
    enabled: invocation.state === "approval-requested",
    intent: mergedIntent,
    locale,
    onIntent,
    pendingValues: retainedMarket?.values ?? pendingMarket?.values ?? {},
    toolCallId,
  });
  return (
    <MarketToolContent
      props={props}
      error={error}
      loaded={loaded}
      locale={locale}
      onValuesChange={(next) => {
        if (!mergedIntent) return;
        setValues(next);
        onIntent({
          intent: mergedIntent,
          question: nextMarketQuestion(next),
          values: next,
        });
      }}
      toolInput={toolInput}
      values={values}
    />
  );
}

function MarketToolContent({
  props,
  error,
  loaded,
  locale,
  onValuesChange,
  toolInput,
  values,
}: {
  props: MarketToolRendererProps;
  error: string | null;
  loaded: LoadedMarket | null;
  locale: "en" | "fa";
  onValuesChange: (values: AssistantMarketValues) => void;
  toolInput: AssistantMarketToolInput | null;
  values: AssistantMarketValues;
}) {
  const {
    active,
    envelope,
    invocation,
    onCancel,
    onEdit,
    onPrepared,
    onResult,
    result,
  } = props;
  const t = useTranslations(ASSISTANT_NAMESPACE);

  if (invocation.state !== "approval-requested") return null;
  const approval = invocation.approval;
  if (!toolInput || !approval?.signature) {
    return <MarketError>{t("market.invalid")}</MarketError>;
  }
  if (result) return <MarketResultCard result={result} />;
  if (envelope) {
    return (
      <MarketProposal
        active={active}
        envelope={envelope}
        loaded={loaded}
        locale={locale}
        onCancel={onCancel}
        onEdit={onEdit}
        onResult={onResult}
      />
    );
  }
  if (!active) return null;
  if (!loaded) {
    return error ? (
      <MarketError>{error}</MarketError>
    ) : (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Spinner />
        {t("market.loading")}
      </p>
    );
  }

  return (
    <MarketSelection
      loaded={loaded}
      locale={locale}
      onCancel={onCancel}
      onPrepared={onPrepared}
      onValuesChange={onValuesChange}
      sdkApproval={{
        approvalId: approval.id,
        signature: approval.signature,
        toolCallId: invocation.toolCallId,
      }}
      toolInput={toolInput}
      values={values}
    />
  );
}

function MarketSelection({
  loaded,
  locale,
  onCancel,
  onPrepared,
  onValuesChange,
  sdkApproval,
  toolInput,
  values,
}: {
  loaded: LoadedMarket;
  locale: "en" | "fa";
  onCancel: () => void;
  onPrepared: (envelope: SignedMarketApprovalEnvelope) => void;
  onValuesChange: (values: AssistantMarketValues) => void;
  sdkApproval: SignedMarketApprovalEnvelope["payload"]["sdkApproval"];
  toolInput: AssistantMarketToolInput;
  values: AssistantMarketValues;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = nextMarketQuestion(values);
  const review = () => {
    if (question || pending) return;
    setPending(true);
    setError(null);
    void postAssistantApproval({
      action: "prepare-market",
      locale,
      sdkApproval,
      toolInput,
      values,
    })
      .then((value) => {
        const parsed = assistantPrepareMarketResponseSchema.safeParse(value);
        if (!parsed.success) {
          setError(t("market.invalid"));
          return;
        }
        if (parsed.data.status !== "prepared") {
          setError(t(marketErrorKey(parsed.data.status)));
          return;
        }
        onPrepared(parsed.data.envelope);
      })
      .catch(() => setError(t("market.error.rejected")))
      .finally(() => setPending(false));
  };

  return (
    <Card data-assistant-market-controls size="sm">
      <CardHeader>
        <CardTitle>{t("market.action.create")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {question ? (
          <MarketQuestion
            loaded={loaded}
            onAnswer={(answer) =>
              onValuesChange(mergeMarketValues(values, answer))
            }
            question={question}
          />
        ) : (
          <MarketSelectionSummary loaded={loaded} values={values} />
        )}
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
      {question ? null : (
        <CardFooter className="justify-end gap-1.5">
          <Button onClick={onCancel} size="sm" variant="ghost">
            {t("proposal.cancel")}
          </Button>
          <Button disabled={pending} onClick={review} size="sm">
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("market.review")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function marketFormQueryKey(toolCallId: string) {
  return ["assistant", "market-form", toolCallId];
}

function useMarketForm({
  active,
  editable,
  enabled,
  intent,
  locale,
  onIntent,
  pendingValues,
  toolCallId,
}: {
  active: boolean;
  editable: boolean;
  enabled: boolean;
  intent: AssistantMarketToolInput | null;
  locale: "en" | "fa";
  onIntent: (pending: AssistantPendingMarket) => void;
  pendingValues: AssistantMarketValues;
  toolCallId: string;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const queryClient = useQueryClient();
  const marketQuery = useQuery({
    enabled: active && enabled && intent !== null,
    gcTime: 0,
    queryFn: async ({ signal }) =>
      assistantMarketLoadResponseSchema.parse(
        await postAssistantApproval(
          { action: "load-market", locale, toolInput: intent },
          signal,
        ),
      ),
    queryKey: marketFormQueryKey(toolCallId),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const loaded =
    marketQuery.data?.status === "loaded" ? marketQuery.data : null;
  const initialized = useRef<LoadedMarket | null>(null);
  const [values, setValues] = useState<AssistantMarketValues>({});
  const error =
    marketQuery.data?.status === "disabled"
      ? t("market.error.disabled")
      : marketQuery.isError
        ? t("market.loadError")
        : null;
  const onMarketLoaded = useEffectEvent((nextLoaded: LoadedMarket) => {
    if (!editable || !intent || initialized.current === nextLoaded) return;
    initialized.current = nextLoaded;
    const initial = initialMarketValues(
      nextLoaded.resolvedToolInput,
      pendingValues,
      nextLoaded.question,
    );
    setValues(initial);
    onIntent({
      intent,
      question: nextMarketQuestion(initial),
      values: initial,
    });
  });
  useEffect(() => {
    if (!editable) return;
    const cache = queryClient.getQueryCache();
    const query = cache.find<AssistantMarketLoadResponse>({
      queryKey: marketFormQueryKey(toolCallId),
      exact: true,
    });
    const notify = () => {
      if (query?.state.data?.status === "loaded")
        onMarketLoaded(query.state.data);
    };
    const unsubscribe = cache.subscribe((event) => {
      if (
        event.query === query &&
        event.type === "updated" &&
        event.action.type === "success"
      )
        notify();
    });
    notify();
    return unsubscribe;
  }, [editable, queryClient, toolCallId]);
  return { loaded, values, setValues, error };
}

function MarketQuestion({
  loaded,
  onAnswer,
  question,
}: {
  loaded: LoadedMarket;
  onAnswer: (patch: Partial<AssistantMarketValues>) => void;
  question: AssistantMarketQuestion;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const choices =
    question === "primaryInstrumentIds"
      ? loaded.options.instruments.map((instrument) => ({
          id: instrument.id,
          label: `${instrument.symbol} · ${instrument.name}`,
        }))
      : question === "comparisonCatalogIdentities"
        ? [
            { id: "none", label: t("market.noneComparisons") },
            ...loaded.options.catalog.map((entry) => ({
              id: entry.canonicalIdentity,
              label: entry.displayName,
            })),
          ]
        : question === "period"
          ? loaded.options.enabledPeriods.map((value) => ({
              id: value,
              label: t(`market.period.${value}`),
            }))
          : question === "scale"
            ? loaded.options.enabledScales.map((value) => ({
                id: value,
                label: t(`market.scale.${value}`),
              }))
            : question === "outputFormat"
              ? (["portrait", "square", "story", "landscape"] as const).map(
                  (value) => ({
                    id: value,
                    label: t(`market.format.${value}`),
                  }),
                )
              : (["en", "fa"] as const).map((value) => ({
                  id: value,
                  label: t(`market.locale.${value}`),
                }));
  return (
    <AssistantQuestion
      onAnswer={(answer) => {
        if (question === "primaryInstrumentIds") {
          onAnswer({
            primaryInstrumentIds: [answer],
            brandingInstrumentId: answer,
          });
        } else if (question === "comparisonCatalogIdentities") {
          onAnswer({
            comparisonCatalogIdentities: answer === "none" ? [] : [answer],
          });
        } else {
          onAnswer({ [question]: answer });
        }
      }}
      question={{
        choices,
        error: t("market.question.error"),
        name: question,
        submitLabel: t("askUser.submit"),
        title: t(`market.question.${question}`),
      }}
    />
  );
}

function MarketSelectionSummary({
  loaded,
  values,
}: {
  loaded: LoadedMarket | null;
  values: AssistantMarketValues;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const primaries = (values.primaryInstrumentIds ?? []).map((id) =>
    instrumentLabel(id, loaded),
  );
  const branding = values.brandingInstrumentId
    ? instrumentLabel(values.brandingInstrumentId, loaded)
    : "—";
  const comparisons = (values.comparisonCatalogIdentities ?? []).map(
    (identity) =>
      loaded?.options.catalog.find(
        (entry) => entry.canonicalIdentity === identity,
      )?.displayName ?? identity,
  );
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">{t("market.field.primaries")}</dt>
      <dd>
        <Bdi>{primaries.join(", ")}</Bdi>
      </dd>
      <dt className="text-muted-foreground">{t("market.field.branding")}</dt>
      <dd>
        <Bdi>{branding}</Bdi>
      </dd>
      <dt className="text-muted-foreground">{t("market.field.comparisons")}</dt>
      <dd>
        <Bdi>{comparisons.join(", ") || t("proposal.none")}</Bdi>
      </dd>
      <dt className="text-muted-foreground">{t("market.field.period")}</dt>
      <dd>{values.period ? t(`market.period.${values.period}`) : "—"}</dd>
      <dt className="text-muted-foreground">{t("market.field.scale")}</dt>
      <dd>{values.scale ? t(`market.scale.${values.scale}`) : "—"}</dd>
      <dt className="text-muted-foreground">{t("market.field.format")}</dt>
      <dd>
        {values.outputFormat ? t(`market.format.${values.outputFormat}`) : "—"}
      </dd>
      <dt className="text-muted-foreground">{t("market.field.locale")}</dt>
      <dd>
        {values.contentLocale
          ? t(`market.locale.${values.contentLocale}`)
          : "—"}
      </dd>
    </dl>
  );
}

function instrumentLabel(id: string, loaded: LoadedMarket | null) {
  const instrument = loaded?.options.instruments.find(
    (candidate) => candidate.id === id,
  );
  return instrument ? `${instrument.symbol} · ${instrument.name}` : id;
}

function MarketProposal({
  active,
  envelope,
  loaded,
  locale,
  onCancel,
  onEdit,
  onResult,
}: {
  active: boolean;
  envelope: SignedMarketApprovalEnvelope;
  loaded: LoadedMarket | null;
  locale: "en" | "fa";
  onCancel: () => void;
  onEdit: () => void;
  onResult: (result: AssistantMarketResult) => void;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = () => {
    setPending(true);
    setError(null);
    void postAssistantApproval({ action: "approve-market", envelope, locale })
      .then((value) => {
        const parsed = assistantApproveMarketResponseSchema.safeParse(value);
        if (!parsed.success) {
          setError(t("market.invalid"));
          return;
        }
        if (!("action" in parsed.data)) {
          setError(t(marketErrorKey(parsed.data.status)));
          return;
        }
        onResult(parsed.data);
        router.push(parsed.data.href);
      })
      .catch(() => setError(t("market.error.rejected")))
      .finally(() => setPending(false));
  };
  return (
    <Card data-assistant-market-proposal size="sm">
      <CardHeader>
        <CardTitle>{t("market.preview.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <MarketSelectionSummary
          loaded={loaded}
          values={envelope.payload.command.input}
        />
        <p className="text-muted-foreground text-xs">
          {t("market.consequence.create")}
        </p>
        {error ? <MarketError>{error}</MarketError> : null}
        {!active ? (
          <p className="text-muted-foreground text-xs">
            {t("proposal.superseded")}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-1.5">
        <Button
          disabled={pending || !active}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          {t("proposal.cancel")}
        </Button>
        <Button
          disabled={pending || !active}
          onClick={onEdit}
          size="sm"
          variant="outline"
        >
          {t("proposal.edit")}
        </Button>
        <Button disabled={pending || !active} onClick={approve} size="sm">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? t("proposal.approving") : t("proposal.approve")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MarketResultCard({ result }: { result: AssistantMarketResult }) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  return (
    <Card data-assistant-market-result size="sm">
      <CardHeader>
        <CardTitle>{t(`market.result.${result.status}`)}</CardTitle>
      </CardHeader>
      <CardContent>{t("market.result.description.create")}</CardContent>
      <CardFooter>
        <Button
          nativeButton={false}
          render={<Link href={result.href} />}
          size="sm"
          variant="outline"
        >
          {t("market.result.open")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function MarketError({ children }: { children: string }) {
  return (
    <p className="text-destructive text-xs" role="alert">
      {children}
    </p>
  );
}

function marketErrorKey(
  status:
    | "disabled"
    | "expired"
    | "invalid"
    | "not_ready"
    | "stale"
    | "template_drift",
) {
  return `market.error.${status}` as const;
}
