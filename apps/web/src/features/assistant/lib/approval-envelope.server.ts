import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { canonicalRunConfiguration } from "@rz-chain-reporter/contracts";
import { env } from "@rz-chain-reporter/env/server";

import { customerTemplateFingerprint } from "@/lib/customer-template.server";
import {
  ASSISTANT_APPROVAL_CONTRACT,
  type AssistantMarketCommand,
  type AssistantMarketToolInput,
  type AssistantMarketValues,
  type AssistantRunIntentPatch,
  approvalPayloadSchema,
  MARKET_ACTION_TOOL,
  marketApprovalPayloadSchema,
  type SignedApprovalEnvelope,
  type SignedMarketApprovalEnvelope,
  START_RUN_TOOL,
  signedApprovalEnvelopeSchema,
  signedMarketApprovalEnvelopeSchema,
} from "../schemas/approval";

const APPROVAL_TTL_MS = 10 * 60 * 1_000;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("approval payload contains a non-JSON value");
  }
  return encoded;
}

export function approvalConfigurationHash(configuration: unknown) {
  const parsed = approvalPayloadSchema.shape.configuration.parse(configuration);
  return createHash("sha256")
    .update(canonicalRunConfiguration(parsed))
    .digest("hex");
}

function sign(payload: unknown) {
  return createHmac("sha256", env.ASSISTANT_APPROVAL_SECRET)
    .update(canonical(payload))
    .digest("hex");
}

export function issueRunApproval(input: {
  actorId: string;
  configuration: SignedApprovalEnvelope["payload"]["configuration"];
  sdkApproval: SignedApprovalEnvelope["payload"]["sdkApproval"];
  toolInput: AssistantRunIntentPatch;
  workspaceId: string;
}): SignedApprovalEnvelope {
  const issuedAt = Date.now();
  const payload = approvalPayloadSchema.parse({
    actorId: input.actorId,
    configuration: input.configuration,
    configurationHash: approvalConfigurationHash(input.configuration),
    consequenceKey: "assistant.run.start",
    contract: ASSISTANT_APPROVAL_CONTRACT,
    expiresAt: issuedAt + APPROVAL_TTL_MS,
    idempotencyKey: randomUUID(),
    issuedAt,
    proposalId: randomUUID(),
    sdkApproval: input.sdkApproval,
    templateFingerprint: customerTemplateFingerprint,
    toolInput: input.toolInput,
    toolName: START_RUN_TOOL,
    workspaceId: input.workspaceId,
  });
  return { payload, signature: sign(payload) };
}

export function issueMarketApproval(input: {
  actorId: string;
  command: AssistantMarketCommand;
  materialHash: string;
  sdkApproval: SignedMarketApprovalEnvelope["payload"]["sdkApproval"];
  toolInput: AssistantMarketToolInput;
  values: AssistantMarketValues;
  workspaceId: string;
}): SignedMarketApprovalEnvelope {
  const issuedAt = Date.now();
  const payload = marketApprovalPayloadSchema.parse({
    actorId: input.actorId,
    command: input.command,
    consequenceKey: "assistant.market.create",
    contract: ASSISTANT_APPROVAL_CONTRACT,
    expiresAt: issuedAt + APPROVAL_TTL_MS,
    issuedAt,
    materialHash: input.materialHash,
    proposalId: randomUUID(),
    sdkApproval: input.sdkApproval,
    templateFingerprint: customerTemplateFingerprint,
    toolInput: input.toolInput,
    toolName: MARKET_ACTION_TOOL,
    values: input.values,
    workspaceId: input.workspaceId,
  });
  return { payload, signature: sign(payload) };
}

export function verifyRunApproval(
  candidate: unknown,
  identity: { actorId: string; workspaceId: string },
) {
  const envelope = signedApprovalEnvelopeSchema.safeParse(candidate);
  if (!envelope.success) return { status: "invalid" as const };

  const expected = Buffer.from(sign(envelope.data.payload));
  const supplied = Buffer.from(envelope.data.signature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied) ||
    envelope.data.payload.actorId !== identity.actorId ||
    envelope.data.payload.workspaceId !== identity.workspaceId ||
    envelope.data.payload.configurationHash !==
      approvalConfigurationHash(envelope.data.payload.configuration)
  ) {
    return { status: "invalid" as const };
  }
  return { status: "valid" as const, envelope: envelope.data };
}

export function verifyMarketApproval(
  candidate: unknown,
  identity: { actorId: string; workspaceId: string },
) {
  const envelope = signedMarketApprovalEnvelopeSchema.safeParse(candidate);
  if (!envelope.success) return { status: "invalid" as const };

  const expected = Buffer.from(sign(envelope.data.payload));
  const supplied = Buffer.from(envelope.data.signature);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied) ||
    envelope.data.payload.actorId !== identity.actorId ||
    envelope.data.payload.workspaceId !== identity.workspaceId
  ) {
    return { status: "invalid" as const };
  }
  return { status: "valid" as const, envelope: envelope.data };
}

export function verifySdkRunApproval(
  sdkApproval: SignedApprovalEnvelope["payload"]["sdkApproval"],
  toolInput: AssistantRunIntentPatch,
) {
  return verifySdkApproval(sdkApproval, START_RUN_TOOL, toolInput);
}

export function verifySdkMarketApproval(
  sdkApproval: SignedMarketApprovalEnvelope["payload"]["sdkApproval"],
  toolInput: AssistantMarketToolInput,
) {
  return verifySdkApproval(sdkApproval, MARKET_ACTION_TOOL, toolInput);
}

function verifySdkApproval(
  sdkApproval: SignedApprovalEnvelope["payload"]["sdkApproval"],
  toolName: string,
  toolInput: unknown,
) {
  const inputDigest = createHash("sha256")
    .update(canonical(toolInput))
    .digest("base64url");
  const payload = JSON.stringify([
    "ai-sdk-tool-approval-v1",
    sdkApproval.approvalId,
    sdkApproval.toolCallId,
    toolName,
    inputDigest,
  ]);
  const expected = createHmac("sha256", env.ASSISTANT_APPROVAL_SECRET)
    .update(payload)
    .digest("base64url");
  const supplied = Buffer.from(sdkApproval.signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    supplied.length === expectedBuffer.length &&
    timingSafeEqual(supplied, expectedBuffer)
  );
}
