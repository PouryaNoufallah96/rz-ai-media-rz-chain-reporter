"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useState } from "react";

import { Link, useRouter } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";
import { postAssistantApproval } from "../lib/approval-request";
import {
  type RunIntentResolution,
  resolveRunIntent,
  resolveRunToolIntent,
  runAnswerPatch,
} from "../lib/run-intent";
import {
  type AssistantPendingRun,
  type AssistantRunFormLoadResponse,
  type AssistantRunIntentPatch,
  type AssistantRunQuestion,
  type AssistantRunResult,
  assistantApproveRunResponseSchema,
  assistantPrepareRunResponseSchema,
  assistantRunFormLoadResponseSchema,
  assistantRunToolInputSchema,
  type SignedApprovalEnvelope,
} from "../schemas/approval";
import type { StartRunToolInvocation } from "../schemas/ui-message";
import {
  type AssistantFocusedQuestion,
  AssistantQuestion,
} from "./assistant-ask-user";
import { AssistantProposal } from "./assistant-proposal";

type RunToolRendererProps = {
  active: boolean;
  envelope: SignedApprovalEnvelope | null;
  invocation: StartRunToolInvocation;
  onCancel: () => void;
  onEdit: () => void;
  onIntent: (pendingRun: AssistantPendingRun) => void;
  onPrepared: (
    envelope: SignedApprovalEnvelope,
    pendingRun: AssistantPendingRun,
  ) => void;
  onResult: (result: AssistantRunResult) => void;
  pendingRun: AssistantPendingRun | null;
  retainedRun: AssistantPendingRun | null;
  result: AssistantRunResult | null;
};

export function RunToolRenderer(props: RunToolRendererProps) {
  const {
    active,
    envelope,
    invocation,
    onIntent,
    onPrepared,
    pendingRun,
    retainedRun,
    result,
  } = props;
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const toolCallId = invocation.toolCallId;
  const parsedToolInput = assistantRunToolInputSchema.safeParse(
    invocation.input ?? {},
  );
  const toolInput = parsedToolInput.success ? parsedToolInput.data : {};
  const approval =
    invocation.state === "approval-requested" ? invocation.approval : undefined;
  const formQuery = useRunForm({
    active: active && !result,
    editable: active && !envelope && !result,
    enabled: invocation.state === "approval-requested",
    onIntent,
    pendingRun,
    retainedRun,
    toolCallId,
    toolInput,
  });
  const form = formQuery.data ?? null;
  const resolution =
    form && active
      ? resolveRunToolIntent({ form, pendingRun, retainedRun, toolInput })
      : null;
  const preparationError = useRunPreparation({
    approval,
    enabled: active && !envelope && !result,
    onPrepared,
    resolution,
    toolCallId,
    toolInput,
  });
  const error =
    preparationError ?? (formQuery.isError ? t("proposal.loadError") : null);

  return (
    <RunToolContent
      props={props}
      form={form}
      resolution={resolution}
      error={error}
      onSelect={(next) => {
        onIntent(next.pendingRun);
      }}
    />
  );
}

function RunToolContent({
  props,
  form,
  resolution,
  error,
  onSelect,
}: {
  props: RunToolRendererProps;
  form: AssistantRunFormLoadResponse | null;
  resolution: RunIntentResolution | null;
  error: string | null;
  onSelect: (resolution: RunIntentResolution) => void;
}) {
  const { active, envelope, invocation, onCancel, onEdit, onResult, result } =
    props;
  const t = useTranslations(ASSISTANT_NAMESPACE);

  if (invocation.state !== "approval-requested") return null;
  if (!invocation.approval.signature) {
    return <RunError>{t("proposal.invalid")}</RunError>;
  }
  if (result) {
    return (
      <Alert>
        <AlertTitle>{t(`proposal.result.${result.status}`)}</AlertTitle>
        <AlertDescription className="grid gap-2">
          <span>{t("proposal.result.description")}</span>
          <Button
            className="w-fit"
            nativeButton={false}
            render={<Link href={result.href} />}
            size="sm"
            variant="outline"
          >
            {t("proposal.result.open")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (envelope) {
    return (
      <RunApproval
        active={active}
        envelope={envelope}
        loadError={error}
        form={form}
        onCancel={onCancel}
        onEdit={onEdit}
        onResult={onResult}
      />
    );
  }
  if (!active) return null;
  if (!form || !resolution) {
    return error ? (
      <RunError>{error}</RunError>
    ) : (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Spinner />
        {t("proposal.loading")}
      </div>
    );
  }
  if (error) return <RunError>{error}</RunError>;
  if (!resolution.question) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Spinner />
        {t("proposal.preparing")}
      </div>
    );
  }
  const question = resolution.question;

  return (
    <div className="grid gap-2">
      <AssistantQuestion
        onAnswer={(value) => {
          const next = resolveRunIntent(
            resolution.pendingRun.intent,
            runAnswerPatch(question, value, resolution.pendingRun.intent, form),
            form,
          );
          onSelect(next);
        }}
        question={questionOf(question, form, t)}
      />
      <Button className="w-fit" onClick={onCancel} size="sm" variant="ghost">
        {t("proposal.cancel")}
      </Button>
    </div>
  );
}

function RunApproval({
  active,
  envelope,
  form,
  loadError,
  onCancel,
  onEdit,
  onResult,
}: {
  active: boolean;
  envelope: SignedApprovalEnvelope;
  form: AssistantRunFormLoadResponse | null;
  loadError: string | null;
  onCancel: () => void;
  onEdit: () => void;
  onResult: (result: AssistantRunResult) => void;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = () => {
    setPending(true);
    setError(null);
    void postAssistantApproval({ action: "approve-run", envelope })
      .then((value) => {
        const parsed = assistantApproveRunResponseSchema.safeParse(value);
        if (!parsed.success || parsed.data.status === "invalid") {
          setError(t("proposal.invalid"));
        } else if (
          parsed.data.status === "created" ||
          parsed.data.status === "replayed"
        ) {
          onResult(parsed.data);
          router.push(parsed.data.href);
        } else {
          setError(t(`proposal.error.${parsed.data.status}`));
        }
      })
      .catch(() => setError(t("proposal.error.rejected")))
      .finally(() => setPending(false));
  };
  return (
    <AssistantProposal
      active={active}
      envelope={envelope}
      error={error ?? loadError}
      form={form}
      onApprove={approve}
      onCancel={onCancel}
      onEdit={onEdit}
      pending={pending}
    />
  );
}

function runFormQueryKey(toolCallId: string) {
  return ["assistant", "run-form", toolCallId];
}

function useRunForm({
  active,
  editable,
  enabled,
  onIntent,
  pendingRun,
  retainedRun,
  toolCallId,
  toolInput,
}: {
  active: boolean;
  editable: boolean;
  enabled: boolean;
  onIntent: (pendingRun: AssistantPendingRun) => void;
  pendingRun: AssistantPendingRun | null;
  retainedRun: AssistantPendingRun | null;
  toolCallId: string;
  toolInput: AssistantRunIntentPatch;
}) {
  const queryClient = useQueryClient();
  const formQuery = useQuery({
    enabled: active && enabled,
    gcTime: 0,
    queryFn: async ({ signal }) =>
      assistantRunFormLoadResponseSchema.parse(
        await postAssistantApproval({ action: "load-run-form" }, signal),
      ),
    queryKey: runFormQueryKey(toolCallId),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const onFormLoaded = useEffectEvent(
    (nextForm: AssistantRunFormLoadResponse) => {
      if (!editable) return;
      const next = resolveRunToolIntent({
        form: nextForm,
        pendingRun,
        retainedRun,
        toolInput,
      });
      if (!samePendingRun(pendingRun, next.pendingRun))
        onIntent(next.pendingRun);
    },
  );
  useEffect(() => {
    if (!editable) return;
    const cache = queryClient.getQueryCache();
    const query = cache.find<AssistantRunFormLoadResponse>({
      queryKey: runFormQueryKey(toolCallId),
      exact: true,
    });
    const notify = () => {
      if (query?.state.status === "success" && query.state.data)
        onFormLoaded(query.state.data);
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
  return formQuery;
}

function runPreviewQueryKey(toolCallId: string) {
  return ["assistant", "run-preview", toolCallId];
}

function useRunPreparation({
  approval,
  enabled,
  onPrepared,
  resolution,
  toolCallId,
  toolInput,
}: {
  approval: { id: string; signature?: string } | undefined;
  enabled: boolean;
  onPrepared: (
    envelope: SignedApprovalEnvelope,
    pendingRun: AssistantPendingRun,
  ) => void;
  resolution: RunIntentResolution | null;
  toolCallId: string;
  toolInput: AssistantRunIntentPatch;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const queryClient = useQueryClient();
  const preview = useQuery({
    enabled:
      enabled && Boolean(approval?.signature && resolution?.configuration),
    gcTime: 0,
    queryFn: async ({ signal }) => {
      if (!approval?.signature || !resolution?.configuration)
        throw new Error("Incomplete run preview");
      const response = assistantPrepareRunResponseSchema.parse(
        await postAssistantApproval(
          {
            action: "prepare-run",
            configuration: resolution.configuration,
            sdkApproval: {
              approvalId: approval.id,
              signature: approval.signature,
              toolCallId,
            },
            toolInput,
          },
          signal,
        ),
      );
      return { pendingRun: resolution.pendingRun, response };
    },
    queryKey: runPreviewQueryKey(toolCallId),
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const onPreviewLoaded = useEffectEvent(
    (data: NonNullable<typeof preview.data>) => {
      if (enabled && data.response.status === "prepared")
        onPrepared(data.response.envelope, data.pendingRun);
    },
  );
  useEffect(() => {
    if (!enabled) return;
    const cache = queryClient.getQueryCache();
    const query = cache.find<NonNullable<typeof preview.data>>({
      queryKey: runPreviewQueryKey(toolCallId),
      exact: true,
    });
    const notify = () => {
      if (query?.state.status === "success" && query.state.data)
        onPreviewLoaded(query.state.data);
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
  }, [enabled, queryClient, toolCallId]);
  if (preview.isError) return t("proposal.error.rejected");
  if (!preview.data || preview.data.response.status === "prepared") return null;
  return t(
    preview.data.response.status === "template_drift"
      ? "proposal.error.template_drift"
      : "proposal.error.invalid_configuration",
  );
}

function questionOf(
  question: AssistantRunQuestion,
  form: AssistantRunFormLoadResponse,
  t: ReturnType<typeof useTranslations<typeof ASSISTANT_NAMESPACE>>,
): AssistantFocusedQuestion {
  if (question === "kind") {
    return {
      choices: [
        { id: "news", label: t("runQuestion.kind.news") },
        { id: "promo", label: t("runQuestion.kind.promo") },
      ],
      error: t("runQuestion.required"),
      name: "run-kind",
      submitLabel: t("runQuestion.continue"),
      title: t("runQuestion.kind.title"),
    };
  }
  if (question === "sources") {
    return {
      choices: sourceChoices(form, t),
      description: t("runQuestion.sources.description"),
      error: t("runQuestion.required"),
      name: "run-sources",
      submitLabel: t("runQuestion.continue"),
      title: t("runQuestion.sources.title"),
    };
  }
  if (question === "promoBrands") {
    return {
      choices: form.options.brands.flatMap((brand) =>
        brand.promoEnabled ? [{ id: brand.key, label: brand.name }] : [],
      ),
      description: t("runQuestion.promoBrands.description"),
      error: t("runQuestion.required"),
      name: "run-promo-brands",
      submitLabel: t("runQuestion.continue"),
      title: t("runQuestion.promoBrands.title"),
    };
  }
  if (question === "topics") {
    return {
      description: t("runQuestion.topics.description"),
      error: t("runQuestion.required"),
      input: {
        maxLength: form.options.bounds.semanticMaxChars,
        placeholder: t("runQuestion.topics.placeholder"),
      },
      name: "run-topics",
      submitLabel: t("runQuestion.continue"),
      title: t("runQuestion.topics.title"),
    };
  }
  return {
    description: t("runQuestion.promoText.description"),
    error: t("runQuestion.required"),
    input: {
      maxLength: form.options.bounds.promoPromptMaxChars,
      placeholder: t("runQuestion.promoText.placeholder"),
    },
    name: "run-promo-text",
    submitLabel: t("runQuestion.review"),
    title: t("runQuestion.promoText.title"),
  };
}

function sourceChoices(
  form: AssistantRunFormLoadResponse,
  t: ReturnType<typeof useTranslations<typeof ASSISTANT_NAMESPACE>>,
) {
  const enabled = form.sources.filter(
    (source) => source.lifecycle === "enabled",
  );
  const choices: { id: string; label: string; description: string }[] = [];
  const defaultKeys = new Set(form.options.defaults.sourceKeys ?? []);
  const defaultCount = enabled.filter((source) =>
    defaultKeys.has(source.key),
  ).length;
  if (defaultCount > 0) {
    choices.push({
      id: "owner_defaults",
      label: t("runQuestion.sources.ownerDefaults"),
      description: t("runQuestion.sources.count", { count: defaultCount }),
    });
  }
  const groups = [
    ["all_enabled", "all", enabled.length],
    [
      "rss_enabled",
      "rss",
      enabled.filter((source) => source.origin === "rss").length,
    ],
    [
      "telegram_enabled",
      "telegram",
      enabled.filter((source) => source.origin === "telegram_public").length,
    ],
  ] as const;
  for (const [id, label, count] of groups) {
    if (count > 0) {
      choices.push({
        id,
        label: t(`runQuestion.sources.${label}`),
        description: t("runQuestion.sources.count", { count }),
      });
    }
  }
  return choices;
}

function samePendingRun(
  left: AssistantPendingRun | null,
  right: AssistantPendingRun,
) {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function RunError({ children }: { children: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
