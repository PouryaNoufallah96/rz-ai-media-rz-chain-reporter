import type { StateMarkState } from "@/components/common/state-mark";

import type { PublishingHistoryRow } from "../schemas/history";

export function publicationMark(
  lifecycle: PublishingHistoryRow["lifecycle"],
): StateMarkState {
  switch (lifecycle) {
    case "confirmed":
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "delivery_unknown":
    case "missed_requires_confirmation":
      return "unknown";
    case "effect_claimed":
    case "reserved":
      return "running";
    case "rescheduled":
      return "retrying";
    default:
      return "queued";
  }
}
