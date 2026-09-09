import "server-only";

import { connection } from "next/server";
import {
  approveMarketAction,
  approveRun,
  loadMarketAction,
  prepareMarketApproval,
  prepareRunApproval,
} from "@/features/assistant/lib/command-admission.server";
import { assistantApprovalRequestSchema } from "@/features/assistant/schemas/approval";
import { getRunOptions } from "@/features/editorial/api/server/get-run-options";
import { getSourceCatalog } from "@/features/sources/api/server/get-source-catalog";

import {
  privateJson,
  readAssistantRequest,
  rejected,
} from "../request-boundary";

export async function POST(request: Request) {
  await connection();
  const boundary = await readAssistantRequest(
    request,
    assistantApprovalRequestSchema,
  );
  if (!boundary.ok) return boundary.response;

  const identity = {
    actorId: boundary.userId,
    workspaceId: boundary.workspaceId,
  };

  if (boundary.data.action === "load-market") {
    const result = await loadMarketAction(boundary.data.toolInput);
    return privateJson(result, result.status === "loaded" ? 200 : 409);
  }

  if (boundary.data.action === "prepare-market") {
    const result = await prepareMarketApproval(identity, boundary.data);
    return result.status === "prepared"
      ? privateJson(result)
      : privateJson(result, result.status === "invalid" ? 400 : 409);
  }

  if (boundary.data.action === "approve-market") {
    try {
      const result = await approveMarketAction(
        identity,
        boundary.data.envelope,
      );
      return "action" in result
        ? privateJson(result)
        : privateJson(result, result.status === "invalid" ? 400 : 409);
    } catch {
      return rejected(409);
    }
  }

  if (boundary.data.action === "load-run-form") {
    const [options, catalog] = await Promise.all([
      getRunOptions(),
      getSourceCatalog(),
    ]);
    return privateJson({
      status: "loaded",
      options: {
        models: options.models,
        brands: options.brands,
        platforms: options.platforms,
        defaults: options.defaults,
        bounds: options.bounds,
        windowHours: options.windowHours,
        recentTopics: options.recentTopics,
        previousRun: options.previousRun,
      },
      sources: catalog.entries.map(({ id, key, lifecycle, name, origin }) => ({
        id,
        key,
        lifecycle,
        name,
        origin,
      })),
    });
  }

  if (boundary.data.action === "prepare-run") {
    const result = await prepareRunApproval(identity, boundary.data);
    return result.status === "prepared"
      ? privateJson(result)
      : privateJson(result, result.status === "invalid" ? 400 : 409);
  }

  try {
    const result = await approveRun(identity, boundary.data.envelope);
    return result.status === "created" || result.status === "replayed"
      ? privateJson(result)
      : privateJson(result, result.status === "invalid" ? 400 : 409);
  } catch {
    return rejected(409);
  }
}
