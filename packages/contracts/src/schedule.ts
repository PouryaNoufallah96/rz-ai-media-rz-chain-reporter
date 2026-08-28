import { z } from "zod";

export const SCHEDULE_STATUSES = [
  "scheduled",
  "cancelled",
  "rescheduled",
  "effect_claimed",
  "completed",
  "failed",
  "delivery_unknown",
  "missed_requires_confirmation",
] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);
