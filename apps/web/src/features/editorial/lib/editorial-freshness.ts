import {
  type DraftsChangedRealtimeMessage,
  draftsChangedRealtimeMessageSchema,
  isOperationInProgress,
  type OperationLifecycle,
} from "@rz-chain-reporter/contracts";

const CARD_SHEET_CHANGE_CODES = [
  "queued",
  "running",
  "partial",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "dispatch_exhausted",
  "rearmed",
] as const satisfies readonly DraftsChangedRealtimeMessage["code"][];

export type FreshnessOperation = {
  operationId: string;
  lifecycle: OperationLifecycle;
};

export function cardSheetDraftChangeKey(
  data: unknown,
  analysisRunId: string,
  platformDraftId: string,
  copyOperation: FreshnessOperation | null,
) {
  const parsed = draftsChangedRealtimeMessageSchema.safeParse(data);
  if (
    !parsed.success ||
    parsed.data.analysisRunId !== analysisRunId ||
    parsed.data.platformDraftId !== platformDraftId ||
    !CARD_SHEET_CHANGE_CODES.some((code) => code === parsed.data.code)
  ) {
    return null;
  }
  if (
    copyOperation?.operationId === parsed.data.operationId &&
    copyProjectionAlreadyIncludes(copyOperation.lifecycle, parsed.data.code)
  ) {
    return null;
  }
  return `${parsed.data.operationId}:${parsed.data.code}`;
}

function copyProjectionAlreadyIncludes(
  lifecycle: OperationLifecycle,
  code: DraftsChangedRealtimeMessage["code"],
) {
  if (code === "running" && isOperationInProgress(lifecycle)) {
    return true;
  }
  if (code === "partial") return lifecycle === "succeeded";
  if (code === "dispatch_exhausted") return lifecycle === "failed";
  if (code === "rearmed") return lifecycle === "queued";
  return code === lifecycle;
}
