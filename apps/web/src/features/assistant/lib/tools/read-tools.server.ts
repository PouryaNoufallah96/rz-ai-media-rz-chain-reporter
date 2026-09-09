import "server-only";

import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { tool } from "ai";
import { getTranslations } from "next-intl/server";

import { getAccountSummary } from "@/features/account/api/server/get-account-summary";
import { getActivityHistory } from "@/features/account/api/server/get-activity-history";
import { getActivityLedger } from "@/features/account/api/server/get-activity-ledger";
import { requireSession } from "@/features/auth/api/server/session";
import { getEditorialWorkspace } from "@/features/editorial/api/server/get-editorial-workspace";
import { getPlatformDraft } from "@/features/editorial/api/server/get-platform-draft";
import { getRecentTopics } from "@/features/editorial/api/server/get-recent-topics";
import { getRunOptions } from "@/features/editorial/api/server/get-run-options";
import { getRunReport } from "@/features/editorial/api/server/get-run-report";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import { getInstallationOverview } from "@/features/installation/api/server/get-installation";
import { getMarketAnalysis } from "@/features/market-analysis/api/server/get-analysis";
import { getMarketAnalysisCatalog } from "@/features/market-analysis/api/server/get-catalog";
import { getMarketAnalysisHistory } from "@/features/market-analysis/api/server/get-history";
import { getMarketAnalysisOptions } from "@/features/market-analysis/api/server/get-options";
import { getMarketAnalysisReport } from "@/features/market-analysis/api/server/get-report";
import { getPublishingHistory } from "@/features/publishing/api/server/get-publishing-history";
import { getSavedHistory } from "@/features/publishing/api/server/get-saved-history";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";
import { getUsageView } from "@/features/usage/api/server/get-usage";
import {
  customerBrandPolicy,
  customerTemplate,
  customerTimeZone,
} from "@/lib/customer-template.server";

import {
  type AssistantReadInput,
  type AssistantReadResult,
  assistantReadResultSchema,
  assistantReadToolInputSchema,
  MAX_ASSISTANT_READ_ITEMS,
  READ_WORKSPACE_TOOL,
} from "../../schemas/assistant-message";
import {
  fact,
  href,
  item,
  projectAccountResult,
  projectMarketCatalogResult,
  projectMarketHistoryResult,
  projectMarketOptionsResult,
  projectPublishingResult,
  projectSavedResult,
  projectUsageResult,
  result,
} from "../read-projections";

export const ASSISTANT_READ_TOOL_NAMES = [READ_WORKSPACE_TOOL] as const;

type AssistantReadScope = {
  currentDraftId: string | null;
  currentMarketAnalysisId: string | null;
  currentRunId: string | null;
  locale: ContentLocale;
};

const MAX_CARD_CANDIDATES = 8;
const MAX_CARD_REVISIONS = 8;
const MAX_CARD_COPY_PREVIEW_CHARS = 220;

export function assistantReadTools(scope: AssistantReadScope) {
  return {
    [READ_WORKSPACE_TOOL]: tool({
      description:
        "Read exactly one bounded owner surface. Use current/recent runs, the open card, Account, Saved, Publishing, canonical rolling Usage filters, or enabled Market Analysis. Results are already authorization-scoped and include exact owner links. Calendar periods are unsupported; never call another target in the same step.",
      inputSchema: assistantReadToolInputSchema,
      outputSchema: assistantReadResultSchema,
      execute: ({ request }) => readWorkspace(request, scope),
    }),
  } as const;
}

export type AssistantReadTools = ReturnType<typeof assistantReadTools>;

export async function readWorkspace(
  input: AssistantReadInput,
  scope: AssistantReadScope,
): Promise<AssistantReadResult> {
  switch (input.target) {
    case "installation":
      return readInstallation();
    case "runs":
      return readRuns(input.scope, scope.currentRunId);
    case "run":
      return readRun(input.runId ?? scope.currentRunId, scope.locale);
    case "run_report":
      return readRunReport(input.runId);
    case "card":
      return readCard(input.draftId ?? scope.currentDraftId, scope.locale);
    case "account":
      return readAccount();
    case "activity":
      return readActivity();
    case "activity_ledger":
      return readLedger(input.cursor ?? null);
    case "topics":
      return readTopics();
    case "saved":
      return readSaved(input.state, input.cursor ?? null);
    case "publishing":
      return readPublishing(input.view, input.cursor ?? null);
    case "usage":
      return readUsage(input);
    case "market_options":
      return readMarketOptions();
    case "market_catalog":
      return readMarketCatalog();
    case "market_history":
      return readMarketHistory(input.cursor ?? null);
    case "market_analysis":
      return readAnalysis(
        input.analysisId ?? scope.currentMarketAnalysisId,
        scope.locale,
      );
    case "market_report":
      return readMarketReport(
        input.analysisId ?? scope.currentMarketAnalysisId,
      );
  }
}

async function readInstallation(): Promise<AssistantReadResult> {
  const installation = await getInstallationOverview();
  const enabledSources = installation.sources.filter(
    (source) => source.enabled,
  );
  return result("installation", "/installation", {
    facts: [
      fact("workspace", installation.identity.workspaceName),
      fact("template", installation.identity.templateKey ?? "—"),
      fact("timeZone", customerTimeZone),
      fact("brands", installation.mediaBrands.length),
      fact("sources", installation.sources.length),
      fact("enabledSources", enabledSources.length),
      fact("destinations", installation.destinations.length),
      fact("marketAnalysis", customerTemplate.marketAnalysis.enabled),
    ],
    items: [
      ...customerBrandPolicy.map((brand) =>
        item(brand.key, brand.name, {
          href: brand.logo?.url ?? null,
          facts: [
            fact(
              "destinations",
              installation.mediaBrands
                .find((entry) => entry.key === brand.key)
                ?.destinationKeys.join(", ") ?? "—",
            ),
          ],
        }),
      ),
      ...installation.destinations.map((destination) =>
        item(destination.key, destination.label, {
          status: destination.binding,
          facts: [fact("provider", destination.platform)],
        }),
      ),
    ].slice(0, 20),
  });
}

async function readRuns(
  scope: "current" | "recent",
  currentRunId: string | null,
): Promise<AssistantReadResult> {
  const options = await getRunOptions();
  const runs =
    scope === "current"
      ? options.runs.filter((run) => run.id === currentRunId).slice(0, 1)
      : options.runs.slice(0, 4);
  return result("runs", "/dashboard", {
    notice:
      scope === "current" && currentRunId === null
        ? "currentRunRequired"
        : "none",
    facts: [fact("items", runs.length)],
    items: runs.map((run) =>
      item(run.id, run.id, {
        status: run.lifecycle,
        occurredAt: run.startedAt,
        href: href("/dashboard", { run: run.id }),
        facts: [fact("kind", run.kind)],
      }),
    ),
  });
}

async function readRun(
  runId: string | null,
  presentationLocale: ContentLocale,
): Promise<AssistantReadResult> {
  if (!runId) {
    return result("run", "/dashboard", { notice: "currentRunRequired" });
  }
  const [workspace, catalog] = await Promise.all([
    getEditorialWorkspace(Promise.resolve({ run: runId }), presentationLocale),
    getSourceCatalog(),
  ]);
  if (!workspace.head) {
    return result("run", "/dashboard", { notice: "notFound" });
  }
  const configuration = workspace.head.configuration;
  const sourceIds =
    configuration.kind === "news" ? configuration.sourceIds : [];
  const selected = new Set(sourceIds);
  const sources = catalog.entries.filter((source) => selected.has(source.id));
  return result("run", href("/dashboard", { run: runId }), {
    observedAt: workspace.readAt,
    facts: [
      fact("kind", configuration.kind),
      fact("lifecycle", workspace.head.lifecycle),
      fact("startedAt", workspace.head.startedAt.toISOString()),
      fact(
        "brands",
        configuration.kind === "news"
          ? configuration.brands.length
          : configuration.promo.brands.length,
      ),
      fact("sources", sources.length),
      fact("modelLanes", workspace.modelLanes.length),
      fact(
        "telegramCards",
        workspace.telegramLanes.reduce(
          (sum, lane) => sum + lane.cards.length,
          0,
        ),
      ),
    ],
    items: [
      ...sources
        .slice(0, 4)
        .map((source) =>
          item(source.id, source.name, { status: source.lifecycle }),
        ),
      ...workspace.modelLanes.slice(0, 6).map((lane) =>
        item(
          lane.unitId ?? `${lane.brandKey}:${lane.modelOptionKey}`,
          lane.brandName,
          {
            status: lane.status,
            facts: [
              fact("requestedModel", lane.modelOptionKey),
              fact("candidates", lane.selections.length),
              fact("promoIdeas", lane.promoIdeas.length),
            ],
          },
        ),
      ),
      ...workspace.modelLanes.flatMap((lane) => [
        ...lane.selections.slice(0, 1).map((selection) =>
          item(selection.id, selection.title, {
            status: selection.suggestedPlatform,
            occurredAt: selection.publishedAt,
            facts: [fact("brands", lane.brandName), fact("kind", "selection")],
          }),
        ),
        ...lane.promoIdeas.slice(0, 1).map((idea) =>
          item(idea.id, idea.title, {
            status: "promo",
            facts: [fact("brands", lane.brandName), fact("kind", "promo")],
          }),
        ),
      ]),
      ...workspace.telegramLanes.flatMap((lane) =>
        lane.cards.slice(0, 2).map((card) =>
          item(card.telegramFilterResultId, card.title, {
            status: card.disposition,
            occurredAt: card.publishedAt,
            facts: [fact("brands", lane.brandName), fact("kind", "telegram")],
          }),
        ),
      ),
    ].slice(0, 20),
  });
}

async function readRunReport(runId: string): Promise<AssistantReadResult> {
  const report = await getRunReport(runId, Promise.resolve({}));
  return result("runReport", `/dashboard/runs/${runId}/report`, {
    observedAt: report.readAt,
    notice: report.funnels ? "none" : "notFound",
    facts: report.funnels
      ? [
          fact("fetched", report.funnels.items.fetched),
          fact("admitted", report.funnels.items.admitted),
          fact("output", report.funnels.items.inOutputLane),
          fact("selections", report.funnels.selections),
          fact("promoIdeas", report.funnels.promoIdeas),
        ]
      : [],
    items: report.page.rows.slice(0, 8).map((row) =>
      item(row.sourceItemId, row.title, {
        status: row.disposition,
        occurredAt: row.publishedAt,
        facts: [
          fact("brands", row.brandName ?? "—"),
          fact("provider", row.sourceName),
        ],
      }),
    ),
  });
}

async function readCard(
  draftId: string | null,
  presentationLocale: ContentLocale,
): Promise<AssistantReadResult> {
  if (!draftId) {
    return result("card", "/dashboard", { notice: "cardRequired" });
  }
  const [draft, t] = await Promise.all([
    getPlatformDraft(draftId, presentationLocale),
    getTranslations({
      locale: presentationLocale,
      namespace: EDITORIAL_NAMESPACE,
    }),
  ]);
  if (!draft) {
    return result("card", "/dashboard", { notice: "notFound" });
  }
  const card = draft.card;
  const cardHref =
    draft.executionScope.kind === "analysis_run"
      ? href("/dashboard", {
          run: draft.executionScope.analysisRunId,
          draft: card.id,
        })
      : href(`/market-analysis/${draft.executionScope.marketAnalysisId}`, {
          draft: card.id,
        });
  return result("card", cardHref, {
    observedAt: draft.readAt,
    facts: [
      fact("brands", card.brandName),
      fact("provider", card.platform),
      fact("kind", card.sourceKind),
      fact("candidates", card.candidates.length),
      fact("items", card.revisions.length),
      fact("lifecycle", draft.lifecycle),
      fact("activeRevision", card.activeRevisionId ?? "none"),
      fact("image", imageSummary(card)),
      fact("approval", approvalSummary(card)),
      fact(
        "publication",
        card.publishing.latestPublication?.lifecycle ?? "none",
      ),
      fact("schedule", scheduleSummary(card)),
    ],
    items: [
      ...card.candidates.slice(0, MAX_CARD_CANDIDATES).map((candidate) =>
        item(
          candidate.id,
          t("cardSheet.variantLabel", { key: candidate.variantKey }),
          {
            status:
              card.generation?.operationId === candidate.operationId
                ? (card.generation.units.find(
                    (unit) => unit.variantKey === candidate.variantKey,
                  )?.status ?? null)
                : null,
            facts: [
              fact("kind", "candidate"),
              fact("contentLocale", candidate.contentLocale),
              fact("requestedModel", candidate.modelOptionKey),
              fact("copyPreview", copyPreview(candidate.body)),
            ],
          },
        ),
      ),
      ...card.revisions.slice(0, MAX_CARD_REVISIONS).map((revision) =>
        item(revision.id, revision.headline || card.originTitle, {
          status:
            card.publishing.approval?.draftRevisionId === revision.id
              ? "approved"
              : card.activeRevisionId === revision.id
                ? "active"
                : null,
          facts: [
            fact("kind", "revision"),
            fact("contentLocale", revision.contentLocale),
          ],
        }),
      ),
    ],
  });
}

function copyPreview(body: string) {
  const compact = body.replace(/\s+/gu, " ").trim();
  if (compact.length <= MAX_CARD_COPY_PREVIEW_CHARS) return compact;
  return `${compact.slice(0, MAX_CARD_COPY_PREVIEW_CHARS - 1).trimEnd()}…`;
}

type ExactDraftCard = NonNullable<
  Awaited<ReturnType<typeof getPlatformDraft>>
>["card"];

function imageSummary(card: ExactDraftCard) {
  const activeRevision = card.revisions.find(
    (revision) => revision.id === card.activeRevisionId,
  );
  if (activeRevision?.selectedFinalMediaAssetId) {
    return `selected:${activeRevision.selectedFinalMediaAssetId}`;
  }
  const imageGeneration = card.imageGeneration;
  return imageGeneration &&
    activeRevision &&
    imageGeneration.draftRevisionId === activeRevision.id
    ? imageGeneration.lifecycle
    : "none";
}

function approvalSummary(card: ExactDraftCard) {
  const approval = card.publishing.approval;
  return approval ? `approved:${approval.draftRevisionId}` : "notApproved";
}

function scheduleSummary(card: ExactDraftCard) {
  const schedule = card.publishing.latestSchedule;
  return schedule
    ? `${schedule.lifecycle}:${schedule.scheduledAt.toISOString()}:${schedule.timezone}`
    : "none";
}

async function readAccount(): Promise<AssistantReadResult> {
  const [session, summary] = await Promise.all([
    requireSession(),
    getAccountSummary(),
  ]);
  return projectAccountResult(session.user, summary);
}

async function readActivity(): Promise<AssistantReadResult> {
  const rows = await getActivityHistory();
  return result("activity", "/account", {
    facts: [fact("items", rows.length)],
    items: rows.map((row) =>
      item(row.id, row.headline ?? row.brandName ?? row.eventType, {
        status: row.eventType,
        occurredAt: row.occurredAt,
        href: row.platformDraftId
          ? href("/account", { draft: row.platformDraftId })
          : null,
        facts: row.platform ? [fact("provider", row.platform)] : [],
      }),
    ),
  });
}

async function readLedger(cursor: string | null): Promise<AssistantReadResult> {
  const page = await getActivityLedger(cursor);
  return result("activityLedger", href("/account", { auditCursor: cursor }), {
    facts: [fact("items", page.rows.length)],
    items: page.rows.map((row) =>
      item(row.id, row.recordKind, {
        status: row.eventType,
        occurredAt: row.occurredAt,
        facts: [fact("profile", row.actorName ?? row.actorEmail ?? "—")],
      }),
    ),
    cursors: page,
  });
}

async function readTopics(): Promise<AssistantReadResult> {
  const topics = await getRecentTopics();
  return result("topics", "/account", {
    facts: [fact("items", topics.length)],
    items: topics.map((topic, index) => item(`topic-${index}`, topic)),
  });
}

async function readSaved(
  state: "active" | "discarded" | "all",
  cursor: string | null,
): Promise<AssistantReadResult> {
  const saved = await getSavedHistory(
    { state, cursor },
    MAX_ASSISTANT_READ_ITEMS,
  );
  return projectSavedResult(state, cursor, saved.page);
}

async function readPublishing(
  view: "scheduled" | "published" | "reconciliation",
  cursor: string | null,
): Promise<AssistantReadResult> {
  const publishing = await getPublishingHistory(
    { view, cursor },
    MAX_ASSISTANT_READ_ITEMS,
  );
  return projectPublishingResult(view, cursor, publishing);
}

async function readUsage(
  input: Extract<AssistantReadInput, { target: "usage" }>,
): Promise<AssistantReadResult> {
  const query = {
    period: input.period,
    model: input.model ?? null,
    backend: input.backend ?? null,
    provider: input.provider ?? null,
    task: input.task ?? null,
    status: input.status ?? null,
    cursor: input.cursor ?? null,
  };
  const searchParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== null) searchParams[key] = value;
  }
  const usage = await getUsageView(Promise.resolve(searchParams));
  return projectUsageResult(input, usage, customerTimeZone);
}

async function readMarketOptions(): Promise<AssistantReadResult> {
  if (!customerTemplate.marketAnalysis.enabled)
    return marketDisabled("marketOptions");
  const options = await getMarketAnalysisOptions();
  return projectMarketOptionsResult(options);
}

async function readMarketCatalog(): Promise<AssistantReadResult> {
  if (!customerTemplate.marketAnalysis.enabled)
    return marketDisabled("marketCatalog");
  const catalog = await getMarketAnalysisCatalog();
  return projectMarketCatalogResult(catalog);
}

async function readMarketHistory(
  cursor: string | null,
): Promise<AssistantReadResult> {
  if (!customerTemplate.marketAnalysis.enabled)
    return marketDisabled("marketHistory");
  const history = await getMarketAnalysisHistory(
    {
      status: null,
      q: null,
      cursor,
    },
    MAX_ASSISTANT_READ_ITEMS,
  );
  return projectMarketHistoryResult(history.base, cursor);
}

async function readAnalysis(
  analysisId: string | null,
  presentationLocale: ContentLocale,
): Promise<AssistantReadResult> {
  if (!customerTemplate.marketAnalysis.enabled)
    return marketDisabled("marketAnalysis");
  if (!analysisId)
    return result("marketAnalysis", "/market-analysis", {
      notice: "notFound",
    });
  const analysis = await getMarketAnalysis(analysisId, presentationLocale);
  if (!analysis)
    return result("marketAnalysis", "/market-analysis", { notice: "notFound" });
  const symbols = analysis.normalizedRequest.series
    .map((series) => series.symbol)
    .join(" / ");
  const ownerHref = `/market-analysis/${analysis.id}`;
  const items = [
    ...(analysis.currentChartMediaAssetId
      ? [
          item(
            analysis.currentChartMediaAssetId,
            `${analysis.visualOwnerName} chart`,
            {
              status: analysis.chartRender?.lifecycle ?? "ready",
              href: `/api/media/${analysis.currentChartMediaAssetId}`,
              facts: [fact("kind", "chart")],
            },
          ),
        ]
      : []),
    ...(analysis.currentFinalMediaAssetId
      ? [
          item(
            analysis.currentFinalMediaAssetId,
            analysis.storyHeadline ?? `${analysis.visualOwnerName} final image`,
            {
              status: analysis.generation?.phase ?? "ready",
              href: `/api/media/${analysis.currentFinalMediaAssetId}`,
              facts: [fact("kind", "final")],
            },
          ),
        ]
      : []),
    ...analysis.platformDrafts.flatMap((draft) => [
      item(draft.id, draft.originTitle, {
        href: href(ownerHref, { draft: draft.id }),
        status: draft.generation?.lifecycle ?? null,
        facts: [
          fact("provider", draft.platform),
          fact("candidates", draft.candidates.length),
          fact("activeRevision", draft.activeRevisionId ?? "none"),
          fact("approval", approvalSummary(draft)),
          fact(
            "publication",
            draft.publishing.latestPublication?.lifecycle ?? "none",
          ),
          fact("schedule", scheduleSummary(draft)),
        ],
      }),
      ...draft.candidates.slice(0, 3).map((candidate) =>
        item(candidate.id, copyPreview(candidate.body), {
          href: href(ownerHref, { draft: draft.id }),
          status:
            draft.generation?.units.find(
              (unit) => unit.variantKey === candidate.variantKey,
            )?.status ?? null,
          facts: [
            fact("kind", "candidate"),
            fact("provider", draft.platform),
            fact("contentLocale", candidate.contentLocale),
          ],
        }),
      ),
    ]),
  ].slice(0, MAX_ASSISTANT_READ_ITEMS);
  return result("marketAnalysis", `/market-analysis/${analysis.id}`, {
    facts: [
      fact("status", analysis.status),
      fact("stage", marketAnalysisStage(analysis)),
      fact("brands", analysis.mediaBrandName),
      fact("items", symbols),
      fact("period", analysis.normalizedRequest.period),
      fact("scale", analysis.normalizedRequest.scale),
      fact("outputFormat", analysis.outputFormat ?? "none"),
      fact("contentLocale", analysis.contentLocale),
      fact("linkedDrafts", analysis.linkedDrafts.length),
      fact("media", mediaCount(analysis)),
      fact("approval", marketApprovalSummary(analysis)),
      fact("lifecycle", analysis.generation?.phase ?? "none"),
    ],
    items,
  });
}

type MarketAnalysis = NonNullable<
  Awaited<ReturnType<typeof getMarketAnalysis>>
>;

function marketAnalysisStage(analysis: MarketAnalysis) {
  if (analysis.status === "completed" || analysis.approvals.final.fingerprint)
    return "publish";
  if (
    analysis.currentFinalMediaAssetId ||
    analysis.approvals.design.fingerprint
  )
    return "generate";
  if (analysis.approvals.story.fingerprint) return "design";
  if (analysis.approvals.chart.fingerprint) return "story";
  if (analysis.currentSnapshot) return "chart";
  return "market";
}

function marketApprovalSummary(analysis: MarketAnalysis) {
  const approved = [
    ...(analysis.approvals.chart.fingerprint ? ["chart"] : []),
    ...(analysis.approvals.story.fingerprint ? ["story"] : []),
    ...(analysis.approvals.design.fingerprint ? ["design"] : []),
    ...(analysis.approvals.final.fingerprint ? ["final"] : []),
  ];
  return approved.join(",") || "none";
}

function mediaCount(analysis: MarketAnalysis) {
  return (
    Number(Boolean(analysis.currentChartMediaAssetId)) +
    Number(Boolean(analysis.currentFinalMediaAssetId))
  );
}

async function readMarketReport(
  analysisId: string | null,
): Promise<AssistantReadResult> {
  if (!customerTemplate.marketAnalysis.enabled)
    return marketDisabled("marketReport");
  if (!analysisId)
    return result("marketReport", "/market-analysis", { notice: "notFound" });
  const report = await getMarketAnalysisReport(analysisId);
  if (!report)
    return result("marketReport", "/market-analysis", { notice: "notFound" });
  const live = await report.live;
  const integrity = new Map(
    live.media.map((media) => [media.id, media.integrity]),
  );
  return result("marketReport", `/market-analysis/${analysisId}`, {
    observedAt: report.core.completedAt,
    facts: [
      fact("brands", report.core.mediaBrand.name),
      fact("contentLocale", report.core.contentLocale),
      fact("period", report.core.snapshot.period),
      fact("outputFormat", report.core.design.outputFormat),
      fact(
        "linkedDrafts",
        live.handoffs.flatMap((handoff) => handoff.drafts).length,
      ),
      fact("media", 2),
    ],
    items: [
      item(report.core.final.media.id, report.core.story.headline, {
        status:
          integrity.get(report.core.final.media.id) ??
          "temporarily_unavailable",
        href: `/api/media/${report.core.final.media.id}`,
        facts: [fact("kind", "final")],
      }),
      item(report.core.chart.media.id, report.core.visualOwner.name, {
        status:
          integrity.get(report.core.chart.media.id) ??
          "temporarily_unavailable",
        href: `/api/media/${report.core.chart.media.id}`,
        facts: [fact("kind", "chart")],
      }),
    ],
  });
}

function marketDisabled(
  kind:
    | "marketOptions"
    | "marketCatalog"
    | "marketHistory"
    | "marketAnalysis"
    | "marketReport",
) {
  return result(kind, "/market-analysis", { notice: "marketDisabled" });
}
