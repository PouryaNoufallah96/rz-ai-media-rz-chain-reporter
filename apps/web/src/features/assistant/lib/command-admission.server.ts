import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { RunConfigurationTransport } from "@rz-chain-reporter/contracts";
import { findAnalysisRunByIdempotencyKey } from "@rz-chain-reporter/db/repositories/analysis-run";
import { matchesAppliedCustomerTemplate } from "@rz-chain-reporter/db/repositories/customer-template-identity";

import { getMarketAnalysisCatalog } from "@/features/market-analysis/api/server/get-catalog";
import { getMarketAnalysisOptions } from "@/features/market-analysis/api/server/get-options";
import { marketTemplate } from "@/features/market-analysis/lib/template";
import { assistantMarketLoadProjectionSchema } from "@/features/market-analysis/schemas/reads";
import { customerTemplateFingerprint } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";

import type {
  AssistantMarketCommand,
  AssistantMarketLoadResponse,
  AssistantMarketResult,
  AssistantMarketToolInput,
  AssistantMarketValues,
  SignedApprovalEnvelope,
  SignedMarketApprovalEnvelope,
} from "../schemas/approval";
import { assistantMarketCommandSchema } from "../schemas/approval";
import {
  approvalConfigurationHash,
  issueMarketApproval,
  issueRunApproval,
  verifyMarketApproval,
  verifyRunApproval,
  verifySdkMarketApproval,
  verifySdkRunApproval,
} from "./approval-envelope.server";
import { resolveMarketToolInput } from "./market-intent";

type Identity = { actorId: string; workspaceId: string };
type CanonicalRunConfiguration =
  SignedApprovalEnvelope["payload"]["configuration"];

export type RunApprovalDependencies = {
  findRecovered: (
    identity: Identity,
    idempotencyKey: string,
  ) => ReturnType<typeof findAnalysisRunByIdempotencyKey>;
  now: () => number;
  revalidate: (workspaceId: string) => Promise<void>;
  resolveConfiguration: (
    workspaceId: string,
    configuration: RunConfigurationTransport,
  ) => Promise<
    | { status: "invalid"; issues: readonly unknown[] }
    | { status: "valid"; configuration: CanonicalRunConfiguration }
  >;
  startRun: (input: {
    configuration: RunConfigurationTransport;
    idempotencyKey: string;
  }) => Promise<{
    status: "created" | "replayed";
    analysisRunId: string;
    operationId: string;
  }>;
  templateMatches: (workspaceId: string) => Promise<boolean>;
};

const runApprovalDependencies: RunApprovalDependencies = {
  findRecovered(identity, idempotencyKey) {
    return findAnalysisRunByIdempotencyKey(
      rpcDb(),
      identity.workspaceId,
      identity.actorId,
      idempotencyKey,
    );
  },
  now: Date.now,
  async revalidate(workspaceId) {
    const { revalidateRpcMutation } = await import(
      "@/server/rpc/mutation-invalidation"
    );
    revalidateRpcMutation(["editorial", "startRun"], workspaceId);
  },
  async resolveConfiguration(workspaceId, configuration) {
    const { resolveRunConfiguration } = await import(
      "@/server/rpc/routers/editorial"
    );
    return resolveRunConfiguration(rpcDb(), workspaceId, configuration);
  },
  async startRun(input) {
    const { createRequestClient } = await import("@/lib/orpc.server");
    const client = await createRequestClient();
    return client.editorial.startRun(input);
  },
  templateMatches(workspaceId) {
    return matchesAppliedCustomerTemplate(
      rpcDb(),
      workspaceId,
      customerTemplateFingerprint,
    );
  },
};

export async function prepareRunApproval(
  identity: Identity,
  input: {
    configuration: RunConfigurationTransport;
    sdkApproval: SignedApprovalEnvelope["payload"]["sdkApproval"];
    toolInput: SignedApprovalEnvelope["payload"]["toolInput"];
  },
  dependencies = runApprovalDependencies,
) {
  if (!verifySdkRunApproval(input.sdkApproval, input.toolInput)) {
    return { status: "invalid" as const };
  }

  const resolved = await dependencies.resolveConfiguration(
    identity.workspaceId,
    input.configuration,
  );
  if (resolved.status === "invalid") {
    return { status: "invalid_configuration" as const };
  }
  if (!(await dependencies.templateMatches(identity.workspaceId))) {
    return { status: "template_drift" as const };
  }

  return {
    status: "prepared" as const,
    envelope: issueRunApproval({
      ...identity,
      configuration: resolved.configuration,
      sdkApproval: input.sdkApproval,
      toolInput: input.toolInput,
    }),
  };
}

export async function approveRun(
  identity: Identity,
  candidate: unknown,
  dependencies = runApprovalDependencies,
) {
  const verified = verifyRunApproval(candidate, identity);
  if (verified.status !== "valid") return { status: "invalid" as const };

  const { payload } = verified.envelope;
  if (!verifySdkRunApproval(payload.sdkApproval, payload.toolInput)) {
    return { status: "invalid" as const };
  }

  const recovered = await dependencies.findRecovered(
    identity,
    payload.idempotencyKey,
  );
  if (recovered) {
    if (recovered.requestHash !== payload.configurationHash) {
      return { status: "invalid" as const };
    }
    return {
      status: "replayed" as const,
      analysisRunId: recovered.analysisRunId,
      operationId: recovered.operationId,
      href: `/dashboard?run=${encodeURIComponent(recovered.analysisRunId)}`,
    };
  }

  if (payload.expiresAt <= dependencies.now()) {
    return { status: "expired" as const };
  }
  if (
    payload.templateFingerprint !== customerTemplateFingerprint ||
    !(await dependencies.templateMatches(identity.workspaceId))
  ) {
    return { status: "template_drift" as const };
  }

  const resolved = await dependencies.resolveConfiguration(
    identity.workspaceId,
    payload.configuration,
  );
  if (
    resolved.status === "invalid" ||
    approvalConfigurationHash(resolved.configuration) !==
      payload.configurationHash
  ) {
    return { status: "stale" as const };
  }

  const result = await dependencies.startRun({
    configuration: resolved.configuration,
    idempotencyKey: payload.idempotencyKey,
  });
  await dependencies.revalidate(identity.workspaceId);
  return {
    status: result.status,
    analysisRunId: result.analysisRunId,
    operationId: result.operationId,
    href: `/dashboard?run=${encodeURIComponent(result.analysisRunId)}`,
  };
}

export async function loadMarketAction(
  input: AssistantMarketToolInput,
): Promise<AssistantMarketLoadResponse> {
  if (!marketTemplate.enabled) return { status: "disabled" };
  const [options, catalog] = await Promise.all([
    getMarketAnalysisOptions(),
    getMarketAnalysisCatalog(),
  ]);
  const defaultComparison = catalog.entries.find(
    (entry) => entry.baseAsset === options.defaultComparisonSymbol,
  );
  const projection = assistantMarketLoadProjectionSchema.parse({
    options: {
      instruments: options.instruments.map(({ id, key, name, symbol }) => ({
        id,
        key,
        name,
        symbol,
      })),
      enabledPeriods: options.enabledPeriods,
      enabledScales: options.enabledScales,
      defaultPeriod: options.defaultPeriod,
      defaultScale: options.defaultScale,
      outputFormat: options.outputFormat,
      defaultComparisonIdentity: defaultComparison?.canonicalIdentity ?? null,
      compositions: options.compositions.map((family) => ({
        key: family.key,
        displayName: family.displayName,
        variants: family.variants.map((variant) => ({
          key: variant.key,
          displayName: variant.displayName,
          formats: variant.formats,
          minSeries: variant.minSeries,
          maxSeries: variant.maxSeries,
          allowedScales: variant.allowedScales,
        })),
      })),
      defaultImageOptionKey: options.defaultImageOptionKey,
      imageOptions: options.imageOptions.map(({ key, name }) => ({
        key,
        name,
      })),
      defaultCopyModelOptionKey: options.defaultCopyModelOptionKey,
      copyModels: options.copyModels.map(({ key, name }) => ({ key, name })),
      catalog: catalog.entries,
    },
    analysis: null,
  });
  const resolved = resolveMarketToolInput(
    input,
    projection.options.instruments,
  );
  return {
    status: "loaded",
    ...projection,
    resolvedToolInput: resolved.input,
    question: resolved.question,
  };
}

export async function prepareMarketApproval(
  identity: Identity,
  input: {
    sdkApproval: SignedMarketApprovalEnvelope["payload"]["sdkApproval"];
    toolInput: AssistantMarketToolInput;
    values: AssistantMarketValues;
  },
) {
  if (!verifySdkMarketApproval(input.sdkApproval, input.toolInput)) {
    return { status: "invalid" as const };
  }
  if (!marketTemplate.enabled) return { status: "disabled" as const };
  if (
    !(await matchesAppliedCustomerTemplate(
      rpcDb(),
      identity.workspaceId,
      customerTemplateFingerprint,
    ))
  ) {
    return { status: "template_drift" as const };
  }
  const resolved = await resolveMarketCommand(input.toolInput, input.values);
  if (resolved.status !== "resolved") return { status: resolved.status };
  return {
    status: "prepared" as const,
    envelope: issueMarketApproval({
      ...identity,
      command: resolved.command,
      materialHash: resolved.materialHash,
      sdkApproval: input.sdkApproval,
      toolInput: input.toolInput,
      values: input.values,
    }),
  };
}

export async function approveMarketAction(
  identity: Identity,
  candidate: unknown,
) {
  const verified = verifyMarketApproval(candidate, identity);
  if (verified.status !== "valid") return { status: "invalid" as const };
  const { payload } = verified.envelope;
  if (!verifySdkMarketApproval(payload.sdkApproval, payload.toolInput)) {
    return { status: "invalid" as const };
  }
  if (payload.expiresAt <= Date.now()) return { status: "expired" as const };
  if (!marketTemplate.enabled) return { status: "disabled" as const };
  if (
    payload.templateFingerprint !== customerTemplateFingerprint ||
    !(await matchesAppliedCustomerTemplate(
      rpcDb(),
      identity.workspaceId,
      customerTemplateFingerprint,
    ))
  ) {
    return { status: "template_drift" as const };
  }

  const current = await resolveMarketCommand(
    payload.toolInput,
    payload.values,
    payload.command,
  );
  if (
    current.status !== "resolved" ||
    current.materialHash !== payload.materialHash ||
    JSON.stringify(current.command) !== JSON.stringify(payload.command)
  ) {
    return { status: "stale" as const };
  }
  return executeMarketCommand(payload.command, identity.workspaceId);
}

async function resolveMarketCommand(
  toolInput: AssistantMarketToolInput,
  values: AssistantMarketValues,
  retained?: AssistantMarketCommand,
) {
  const loaded = await loadMarketAction(toolInput);
  if (loaded.status !== "loaded") return { status: loaded.status };
  const resolved = loaded.resolvedToolInput
    ? loaded.resolvedToolInput
    : resolveMarketToolInput(
        toolInput,
        loaded.options.instruments,
        values.primaryInstrumentIds,
      ).input;
  if (!resolved) return { status: "not_ready" as const };

  const primaryInstrumentIds =
    values.primaryInstrumentIds ?? resolved.primaryInstrumentIds;
  const brandingInstrumentId =
    values.brandingInstrumentId ??
    resolved.brandingInstrumentId ??
    primaryInstrumentIds?.[0];
  const comparisonCatalogIdentities =
    values.comparisonCatalogIdentities ?? resolved.comparisonCatalogIdentities;
  const period = values.period ?? resolved.period;
  const scale = values.scale ?? resolved.scale;
  const outputFormat = values.outputFormat ?? resolved.outputFormat;
  const contentLocale = values.contentLocale ?? resolved.contentLocale;
  if (
    !primaryInstrumentIds?.length ||
    !brandingInstrumentId ||
    comparisonCatalogIdentities === undefined ||
    !period ||
    !scale ||
    !outputFormat ||
    !contentLocale ||
    !primaryInstrumentIds.includes(brandingInstrumentId) ||
    primaryInstrumentIds.some(
      (id) => !loaded.options.instruments.some((item) => item.id === id),
    ) ||
    comparisonCatalogIdentities.some(
      (identity) =>
        !loaded.options.catalog.some(
          (item) => item.canonicalIdentity === identity,
        ),
    )
  ) {
    return { status: "not_ready" as const };
  }

  const command = assistantMarketCommandSchema.safeParse({
    action: "create",
    input: {
      primaryInstrumentIds,
      brandingInstrumentId,
      comparisonCatalogIdentities,
      period,
      scale,
      outputFormat,
      contentLocale,
      idempotencyKey: retained?.input.idempotencyKey ?? randomUUID(),
    },
  });
  if (!command.success) return { status: "not_ready" as const };
  return {
    status: "resolved" as const,
    command: command.data,
    materialHash: createHash("sha256")
      .update(JSON.stringify(command.data))
      .digest("hex"),
  };
}

async function executeMarketCommand(
  command: AssistantMarketCommand,
  workspaceId: string,
): Promise<AssistantMarketResult> {
  const [{ createRequestClient }, { revalidateRpcMutation }] =
    await Promise.all([
      import("@/lib/orpc.server"),
      import("@/server/rpc/mutation-invalidation"),
    ]);
  const client = await createRequestClient();
  const raw = await client.marketAnalysis.create(command.input);
  revalidateRpcMutation(["marketAnalysis", "create"], workspaceId);
  return {
    status: raw.replayed
      ? "replayed"
      : raw.operationId
        ? "queued"
        : "completed",
    action: "create",
    analysisId: raw.analysisId,
    href: `/market-analysis/${raw.analysisId}?step=market`,
    operationId: raw.operationId ?? null,
    version: raw.version,
  };
}
