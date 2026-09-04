import type { InvocationKey, UsageStatus } from "@rz-chain-reporter/contracts";

type SlotUsage = { invocationKey: InvocationKey; status: UsageStatus };

export function nextInvocationSlot(
  slots: readonly InvocationKey[],
  usage: readonly SlotUsage[],
) {
  const bySlot = new Map(usage.map((row) => [row.invocationKey, row.status]));
  for (const invocationKey of slots) {
    const status = bySlot.get(invocationKey);
    if (status === undefined)
      return { status: "available" as const, invocationKey };
    if (
      status === "pending" ||
      status === "unknown" ||
      status === "succeeded"
    ) {
      return { status: "blocked" as const, invocationKey, usageStatus: status };
    }
  }
  return { status: "exhausted" as const };
}
