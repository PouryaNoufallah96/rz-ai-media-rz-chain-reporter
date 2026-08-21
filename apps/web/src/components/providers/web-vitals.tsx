"use client";

import * as Sentry from "@sentry/nextjs";
import { useReportWebVitals } from "next/web-vitals";

const reportWebVitals: Parameters<typeof useReportWebVitals>[0] = (metric) => {
  if (!Sentry.isEnabled()) {
    return;
  }

  Sentry.logger.info("web.vital", {
    delta: metric.delta,
    metric: metric.name,
    navigationType: metric.navigationType,
    rating: metric.rating,
    value: metric.value,
  });
};

export function WebVitals() {
  useReportWebVitals(reportWebVitals);
  return null;
}
