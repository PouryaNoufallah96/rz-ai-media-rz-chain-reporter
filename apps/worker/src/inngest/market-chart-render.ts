import { createHash } from "node:crypto";
import {
  MARKET_CHART_OUTPUT_DIMENSIONS,
  MARKET_CHART_RENDER_COMMAND_PREFIX,
  MARKET_CHART_RENDER_CONTRACT_VERSION,
  MARKET_CHART_RENDER_MEDIA_KIND,
  type MarketChartRenderInput,
  marketChartSpecSchema,
} from "@rz-chain-reporter/contracts";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { getMarketAnalysis } from "@rz-chain-reporter/db/repositories/market-analysis";
import { getMarketSnapshotWithSeries } from "@rz-chain-reporter/db/repositories/market-snapshot";
import { resolveMediaAssetObjectOwnership } from "@rz-chain-reporter/db/repositories/media-asset";
import {
  claimOperationExecution,
  settleClaimedOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import {
  marketAnalysis,
  marketChartRender,
} from "@rz-chain-reporter/db/schema/market-analysis";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { renderMarketChartSvg } from "@rz-chain-reporter/market-chart";
import { and, eq, inArray, like, lte } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import sharp from "sharp";
import { workerLogger } from "../logging/logger";
import { notifyMarketAnalysisChanged } from "../web-cache/market-analysis";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import {
  compensateProviderOriginal,
  prepareMarketChartRender,
  workerStorage,
} from "./media-storage";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-chart-render";
const CLAIM_LEASE_MS = 5 * 60_000;

function claimant(operationId: string) {
  return `${MARKET_CHART_RENDER_COMMAND_PREFIX}${operationId}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableIdentity(operationId: string) {
  const hex = createHash("sha256")
    .update(`market-chart-render:${operationId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function objectKey(workspaceId: string, mediaAssetId: string) {
  return `${workspaceId}/market-chart-renders/${mediaAssetId}.png`;
}

async function loadRenderInput(
  runtime: WorkerRuntime,
  input: {
    marketAnalysisId: string;
    marketChartRenderId: string;
    operationId: string;
    workspaceId: string;
  },
) {
  const analysis = await getMarketAnalysis(
    runtime.db,
    input.workspaceId,
    input.marketAnalysisId,
  );
  const [render] = await runtime.db
    .select()
    .from(marketChartRender)
    .where(
      and(
        eq(marketChartRender.workspaceId, input.workspaceId),
        eq(marketChartRender.id, input.marketChartRenderId),
        eq(marketChartRender.operationId, input.operationId),
      ),
    );
  if (!analysis || !render || !analysis.currentSnapshotId) {
    throw new NonRetriableError("market chart render context is missing");
  }
  if (render.renderContractVersion !== MARKET_CHART_RENDER_CONTRACT_VERSION) {
    throw new NonRetriableError("market chart render contract mismatch");
  }
  if (
    analysis.currentChartRenderId !== render.id ||
    analysis.chartApprovalFingerprint !== render.expectedChartFingerprint
  ) {
    return { status: "superseded" as const };
  }
  const snapshot = await getMarketSnapshotWithSeries(
    runtime.db,
    input.workspaceId,
    analysis.currentSnapshotId,
  );
  if (
    !snapshot?.snapshot.effectiveWindowStart ||
    !snapshot.snapshot.effectiveWindowEnd
  ) {
    throw new NonRetriableError("market chart snapshot is not renderable");
  }
  const spec = marketChartSpecSchema.parse(analysis.currentChartSpec);
  const byIdentity = new Map(
    analysis.normalizedRequest.series.map((series) => [
      series.descriptorIdentity,
      series,
    ]),
  );
  const series: MarketChartRenderInput["snapshot"]["series"] =
    snapshot.series.map((entry) => {
      const descriptor = byIdentity.get(entry.descriptorIdentity);
      if (!descriptor) {
        throw new NonRetriableError(
          "market chart series descriptor is missing",
        );
      }
      return entry.outcome === "succeeded"
        ? {
            outcome: "succeeded" as const,
            id: entry.descriptorIdentity,
            label: descriptor.displayName,
            symbol: descriptor.symbol,
            role: entry.role,
            points: (entry.points ?? []).map((point) => [...point]),
            changePercent: entry.changePercent ?? "0",
            warnings: [...entry.warnings],
            attributionIdentity: entry.attributionIdentity,
          }
        : {
            outcome: "failed" as const,
            id: entry.descriptorIdentity,
            label: descriptor.displayName,
            symbol: descriptor.symbol,
            role: entry.role,
            warnings: [...entry.warnings],
            failureCode: entry.failureCode ?? "MARKET_PROVIDER_UNAVAILABLE",
          };
    });
  const snapshotChecksum = createHash("sha256")
    .update(
      stableJson({
        effectiveWindowEnd: snapshot.snapshot.effectiveWindowEnd.toISOString(),
        effectiveWindowStart:
          snapshot.snapshot.effectiveWindowStart.toISOString(),
        id: snapshot.snapshot.id,
        period: snapshot.snapshot.period,
        scale: snapshot.snapshot.scale,
        series,
      }),
    )
    .digest("hex");
  const attributionIdentities = [
    ...new Set(
      snapshot.series.flatMap((entry) =>
        entry.outcome === "succeeded" && entry.attributionIdentity
          ? [entry.attributionIdentity]
          : [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right, "en"));
  return {
    status: "ready" as const,
    render,
    input: {
      renderContractVersion: MARKET_CHART_RENDER_CONTRACT_VERSION,
      contentLocale: analysis.contentLocale,
      dimensions: MARKET_CHART_OUTPUT_DIMENSIONS.landscape,
      snapshot: {
        id: snapshot.snapshot.id,
        checksum: snapshotChecksum,
        period: snapshot.snapshot.period,
        scale: snapshot.snapshot.scale,
        effectiveWindowStart:
          snapshot.snapshot.effectiveWindowStart.toISOString(),
        effectiveWindowEnd: snapshot.snapshot.effectiveWindowEnd.toISOString(),
        series,
      },
      spec,
      attribution: attributionIdentities.map((identity) => ({
        required: true,
        chartLevel: true,
        identity,
        text: identity,
        hyperlinkRequired: false,
      })),
    } satisfies MarketChartRenderInput,
  };
}

async function settleOwned(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
  lifecycle: "cancelled" | "failed",
) {
  const owner = claimant(operationId);
  const [current] = await runtime.db
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, operationId),
      ),
    );
  if (!current || current.claimedBy !== owner) return null;
  return settleClaimedOperation(runtime.db, workspaceId, {
    id: operationId,
    claimedBy: owner,
    expectedVersion: current.version,
    lifecycle,
  });
}

async function removeUnownedObject(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
) {
  const key = objectKey(workspaceId, stableIdentity(operationId));
  const ownership = await resolveMediaAssetObjectOwnership(
    runtime.db,
    workspaceId,
    key,
  );
  if (ownership.status !== "absent") {
    if (ownership.status === "uncertain") {
      workerLogger.warn("worker.market-chart.cleanup-deferred", {
        operationId,
        status: ownership.status,
        workspaceId,
      });
    }
    return ownership.status;
  }
  return compensateChartObject(workspaceId, operationId, key);
}

async function compensateChartObject(
  workspaceId: string,
  operationId: string,
  key: string,
) {
  const result = await compensateProviderOriginal(workerStorage(), key);
  if (result.status === "uncertain") {
    workerLogger.warn("worker.market-chart.cleanup-deferred", {
      operationId,
      status: result.status,
      workspaceId,
    });
  }
  return result.status;
}

async function attachRenderedChart(
  runtime: WorkerRuntime,
  input: {
    actualBytes: number;
    checksum: string;
    claimedBy: string;
    height: number;
    marketAnalysisId: string;
    marketChartRenderId: string;
    mediaAssetId: string;
    objectKey: string;
    operationId: string;
    operationVersion: number;
    width: number;
    workspaceId: string;
  },
) {
  return runtime.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const [currentOperation] = await tx
      .select()
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .for("update");
    const [render] = await tx
      .select()
      .from(marketChartRender)
      .where(
        and(
          eq(marketChartRender.workspaceId, input.workspaceId),
          eq(marketChartRender.id, input.marketChartRenderId),
        ),
      )
      .for("update");
    const [analysis] = await tx
      .select()
      .from(marketAnalysis)
      .where(
        and(
          eq(marketAnalysis.workspaceId, input.workspaceId),
          eq(marketAnalysis.id, input.marketAnalysisId),
        ),
      )
      .for("update");
    if (!currentOperation || !render || !analysis) {
      throw new NonRetriableError(
        "market chart render settlement context disappeared",
      );
    }
    const now = new Date();
    if (render.mediaAssetId === input.mediaAssetId) {
      if (
        currentOperation.claimedBy === input.claimedBy &&
        currentOperation.version === input.operationVersion &&
        currentOperation.leaseExpiresAt &&
        currentOperation.leaseExpiresAt > now
      ) {
        const [settled] = await tx
          .update(operation)
          .set({
            claimedAt: null,
            claimedBy: null,
            leaseExpiresAt: null,
            lifecycle: "succeeded",
            updatedAt: new Date(),
            version: currentOperation.version + 1,
          })
          .where(
            and(
              eq(operation.id, currentOperation.id),
              eq(operation.version, currentOperation.version),
              eq(operation.claimedBy, input.claimedBy),
            ),
          )
          .returning();
        if (!settled)
          throw new Error("market chart replay lost operation ownership");
      }
      return { status: "replayed" as const };
    }
    if (
      currentOperation.claimedBy !== input.claimedBy ||
      currentOperation.version !== input.operationVersion ||
      !currentOperation.leaseExpiresAt ||
      currentOperation.leaseExpiresAt <= now ||
      !(["running", "settling"] as const).includes(
        currentOperation.lifecycle as "running" | "settling",
      )
    ) {
      return { status: "lost" as const };
    }
    if (
      analysis.currentChartRenderId !== render.id ||
      analysis.chartApprovalFingerprint !== render.expectedChartFingerprint
    ) {
      await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle: "cancelled",
          updatedAt: new Date(),
          version: currentOperation.version + 1,
        })
        .where(
          and(
            eq(operation.id, currentOperation.id),
            eq(operation.version, currentOperation.version),
          ),
        );
      return { status: "superseded" as const };
    }
    await tx
      .insert(mediaAsset)
      .values({
        id: input.mediaAssetId,
        workspaceId: input.workspaceId,
        kind: MARKET_CHART_RENDER_MEDIA_KIND,
        objectKey: input.objectKey,
        mimeType: "image/png",
        declaredBytes: input.actualBytes,
        actualBytes: input.actualBytes,
        checksum: input.checksum,
        width: input.width,
        height: input.height,
        lifecycle: "verified",
        verifiedAt: now,
      })
      .onConflictDoNothing();
    const [asset] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(
          eq(mediaAsset.workspaceId, input.workspaceId),
          eq(mediaAsset.id, input.mediaAssetId),
        ),
      );
    if (
      !asset ||
      asset.objectKey !== input.objectKey ||
      asset.checksum !== input.checksum ||
      asset.lifecycle !== "verified"
    ) {
      throw new Error("market chart media identity conflict");
    }
    const [attached] = await tx
      .update(marketChartRender)
      .set({
        mediaAssetId: input.mediaAssetId,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(marketChartRender.id, render.id),
          eq(marketChartRender.operationId, input.operationId),
        ),
      )
      .returning();
    if (!attached)
      throw new Error("market chart render attachment lost its lock");
    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "succeeded",
        updatedAt: now,
        version: currentOperation.version + 1,
      })
      .where(
        and(
          eq(operation.id, currentOperation.id),
          eq(operation.version, currentOperation.version),
          eq(operation.claimedBy, input.claimedBy),
        ),
      )
      .returning();
    if (!settled)
      throw new Error("market chart render lost operation ownership");
    return { status: "rendered" as const, mediaAssetId: input.mediaAssetId };
  });
}

export function createMarketChartRenderFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const effect = client.createFunction(
    {
      id: FUNCTION_ID,
      retries: 3,
      timeouts: { finish: "8m" },
      triggers: [durableEvents.operationMarketChartRenderRequested],
      onFailure: async ({ event, step }) => {
        const payload = event.data.event.data;
        const settled = await step.run(
          "settle-failed-market-chart-render",
          () =>
            settleOwned(
              runtime,
              payload.workspaceId,
              payload.operationId,
              "failed",
            ),
        );
        await step.run("cleanup-failed-market-chart-render", () =>
          removeUnownedObject(
            runtime,
            payload.workspaceId,
            payload.operationId,
          ),
        );
        if (settled) {
          await notifyMarketAnalysisChanged(
            step,
            payload.workspaceId,
            payload.marketAnalysisId,
            "render-failure",
          );
        }
      },
    },
    async ({ event, step }) => {
      const owner = claimant(event.data.operationId);
      const claimed = await step.run("claim-market-chart-render", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        return claimOperationExecution(runtime.db, event.data.workspaceId, {
          id: event.data.operationId,
          claimedBy: owner,
          now: new Date(),
          leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
        });
      });
      if (claimed.status !== "claimed") {
        if (claimed.status === "terminal") {
          await notifyMarketAnalysisChanged(
            step,
            event.data.workspaceId,
            event.data.marketAnalysisId,
            "render-replayed",
          );
        }
        return { status: claimed.status };
      }
      if (
        !claimed.operation.commandType.startsWith(
          MARKET_CHART_RENDER_COMMAND_PREFIX,
        )
      ) {
        throw new NonRetriableError(
          "market chart render command type mismatch",
        );
      }
      const loaded = await step.run("load-market-chart-render-input", () =>
        loadRenderInput(runtime, event.data),
      );
      if (loaded.status === "superseded") {
        const settled = await step.run(
          "settle-superseded-market-chart-render",
          () =>
            settleOwned(
              runtime,
              event.data.workspaceId,
              event.data.operationId,
              "cancelled",
            ),
        );
        if (settled)
          await notifyMarketAnalysisChanged(
            step,
            event.data.workspaceId,
            event.data.marketAnalysisId,
            "render-superseded",
          );
        return loaded;
      }
      const rendered = await step.run("render-market-chart-png", async () => {
        const svg = renderMarketChartSvg(loaded.input);
        const bytes = await sharp(Buffer.from(svg))
          .png({
            adaptiveFiltering: false,
            compressionLevel: 9,
            palette: false,
          })
          .toBuffer();
        return { bytes: bytes.toString("base64") };
      });
      const mediaAssetId = stableIdentity(event.data.operationId);
      const key = objectKey(event.data.workspaceId, mediaAssetId);
      const prepared = await step.run("store-market-chart-png", () =>
        prepareMarketChartRender(workerStorage(), {
          bytes: Buffer.from(rendered.bytes, "base64"),
          height: loaded.input.dimensions.height,
          mediaAssetId,
          objectKey: key,
          width: loaded.input.dimensions.width,
        }),
      );
      let attached: Awaited<ReturnType<typeof attachRenderedChart>>;
      try {
        attached = await step.run("attach-market-chart-render", () =>
          attachRenderedChart(runtime, {
            ...prepared,
            claimedBy: owner,
            marketAnalysisId: event.data.marketAnalysisId,
            marketChartRenderId: event.data.marketChartRenderId,
            operationId: event.data.operationId,
            operationVersion: claimed.operation.version,
            workspaceId: event.data.workspaceId,
          }),
        );
      } catch (error) {
        await step.run("resolve-ambiguous-market-chart-attachment", () =>
          removeUnownedObject(
            runtime,
            event.data.workspaceId,
            event.data.operationId,
          ),
        );
        throw error;
      }
      if (attached.status === "lost" || attached.status === "superseded") {
        await step.run("cleanup-losing-market-chart-render", () =>
          compensateChartObject(
            event.data.workspaceId,
            event.data.operationId,
            key,
          ),
        );
      }
      await notifyMarketAnalysisChanged(
        step,
        event.data.workspaceId,
        event.data.marketAnalysisId,
        `render-${attached.status}`,
      );
      return attached;
    },
  );
  const cancelled = client.createFunction(
    {
      id: `${FUNCTION_ID}-cancelled`,
      retries: 3,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const payload = (
        event.data.event as
          | {
              data?: {
                operationId?: string;
                workspaceId?: string;
                marketAnalysisId?: string;
              };
            }
          | undefined
      )?.data;
      if (
        !payload?.operationId ||
        !payload.workspaceId ||
        !payload.marketAnalysisId
      )
        return { status: "ignored" };
      const { marketAnalysisId, operationId, workspaceId } = payload;
      const settled = await step.run(
        "settle-cancelled-market-chart-render",
        () => settleOwned(runtime, workspaceId, operationId, "cancelled"),
      );
      await step.run("cleanup-cancelled-market-chart-render", () =>
        removeUnownedObject(runtime, workspaceId, operationId),
      );
      if (settled)
        await notifyMarketAnalysisChanged(
          step,
          workspaceId,
          marketAnalysisId,
          "render-cancelled",
        );
      return { status: settled ? "cancelled" : "ignored" };
    },
  );
  return [effect, cancelled];
}

export async function reconcileStaleMarketChartRenders(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
) {
  const candidates = await runtime.db
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        inArray(operation.lifecycle, ["running", "settling"]),
        like(operation.commandType, `${MARKET_CHART_RENDER_COMMAND_PREFIX}%`),
        lte(operation.leaseExpiresAt, now),
      ),
    )
    .limit(10);
  const settled: {
    marketAnalysisId: string;
    operationId: string;
    lifecycle: "cancelled" | "failed" | "succeeded";
  }[] = [];
  for (const candidate of candidates) {
    const result = await runtime.db.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      const [render] = await tx
        .select()
        .from(marketChartRender)
        .where(
          and(
            eq(marketChartRender.workspaceId, workspaceId),
            eq(marketChartRender.operationId, candidate.id),
          ),
        )
        .for("update");
      if (!render) return null;
      const [analysis] = await tx
        .select()
        .from(marketAnalysis)
        .where(
          and(
            eq(marketAnalysis.workspaceId, workspaceId),
            eq(marketAnalysis.id, render.marketAnalysisId),
          ),
        )
        .for("update");
      const lifecycle: "cancelled" | "failed" | "succeeded" =
        render.mediaAssetId
          ? "succeeded"
          : analysis?.currentChartRenderId !== render.id ||
              analysis.chartApprovalFingerprint !==
                render.expectedChartFingerprint
            ? "cancelled"
            : "failed";
      const [updated] = await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle,
          updatedAt: now,
          version: candidate.version + 1,
        })
        .where(
          and(
            eq(operation.id, candidate.id),
            eq(operation.version, candidate.version),
            inArray(operation.lifecycle, ["running", "settling"]),
          ),
        )
        .returning();
      return updated
        ? {
            marketAnalysisId: render.marketAnalysisId,
            operationId: candidate.id,
            lifecycle,
          }
        : null;
    });
    if (result) settled.push(result);
    if (result && result.lifecycle !== "succeeded")
      await removeUnownedObject(runtime, workspaceId, candidate.id);
  }
  return settled;
}
