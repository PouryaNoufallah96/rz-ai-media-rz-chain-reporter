import { z } from "zod";

export const SCHEDULE_STATUSES = [
  "scheduled",
  "cancelled",
  "completed",
] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);
