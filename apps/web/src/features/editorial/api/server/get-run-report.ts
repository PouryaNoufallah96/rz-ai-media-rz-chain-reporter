import "server-only";

import { analysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { customerEditorial } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { editorialTags } from "../../db/cache/tags";
import { readRunFilters, readRunReportPage } from "../../db/queries";
import {
  loadReportSearchParams,
  normalizeReportQuery,
  type ReportQuery,
  type ReportSearchParams,
  type RunReport,
} from "../../schemas/report";

export async function getRunReport(
  analysisRunId: string,
  searchParams: ReportSearchParams,
): Promise<RunReport> {
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const query = normalizeReportQuery(
    await loadReportSearchParams(searchParams),
  );

  return {
    ...(await readCachedRunReport(workspaceId, analysisRunId, query)),
    thresholds: customerEditorial.thresholds,
    query,
    readAt: new Date(),
  };
}

async function readCachedRunReport(
  workspaceId: string,
  analysisRunId: string,
  query: ReportQuery,
) {
  "use cache";
  cacheTag(editorialTags.reads(workspaceId));
  cacheLife("minutes");

  const database = rpcDb();
  const [page, progress, brands] = await Promise.all([
    readRunReportPage(
      database,
      workspaceId,
      analysisRunId,
      query,
      customerEditorial.thresholds.mediaFitByBrandKey,
    ),
    analysisRunProgress(database, workspaceId, [analysisRunId]),
    readRunFilters(database, workspaceId, analysisRunId),
  ]);

  return { page, funnels: progress[analysisRunId] ?? null, brands };
}
