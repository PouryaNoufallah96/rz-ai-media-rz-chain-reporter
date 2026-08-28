import type { ActivityEventType } from "@rz-chain-reporter/contracts";

export const ACCOUNT_NAMESPACE = "account" as const;

export const ACCOUNT_SAVED_STATES = ["active", "discarded", "all"] as const;

export const ACCOUNT_AUDIT_PAGE_SIZE = 20;

export const ACTIVITY_RECORD_KINDS = [
  "draft",
  "savedCard",
  "approval",
  "schedule",
  "publication",
  "operation",
  "installation",
] as const;

export const ACTIVITY_MESSAGE = {
  "saved_card.saved": "activity.events.saved_card.saved",
  "saved_card.discarded": "activity.events.saved_card.discarded",
  "saved_card.restored": "activity.events.saved_card.restored",
  "approval.granted": "activity.events.approval.granted",
  "schedule.created": "activity.events.schedule.created",
  "schedule.cancelled": "activity.events.schedule.cancelled",
  "schedule.rescheduled": "activity.events.schedule.rescheduled",
  "schedule.missed": "activity.events.schedule.missed",
  "publication.requested": "activity.events.publication.requested",
  "publication.confirmed": "activity.events.publication.confirmed",
  "publication.failed": "activity.events.publication.failed",
  "publication.delivery_unknown":
    "activity.events.publication.delivery_unknown",
  "publication.reconciled_delivered":
    "activity.events.publication.reconciled_delivered",
  "publication.reconciled_not_delivered":
    "activity.events.publication.reconciled_not_delivered",
  "publication.telegram_attested_delivered":
    "activity.events.publication.telegram_attested_delivered",
  "publication.telegram_attested_not_delivered":
    "activity.events.publication.telegram_attested_not_delivered",
  "publishing.paused": "activity.events.publishing.paused",
  "publishing.resumed": "activity.events.publishing.resumed",
} as const satisfies Record<ActivityEventType, string>;
