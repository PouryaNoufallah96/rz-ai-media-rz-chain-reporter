import "server-only";

import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import { stableKeySchema } from "@rz-chain-reporter/customer-template/stable-key";
import type { NextRequest } from "next/server";

import { readMarketCompositionSample } from "@/features/market-analysis/lib/template";
import { createInstallationContext } from "@/server/rpc/context";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/market-analysis-compositions/[familyKey]/[variantKey]">,
) {
  const installation = createInstallationContext(request.headers);
  const { requestId } = installation;
  const session = await installation.getSession();
  if (!session?.user) return notFound(requestId);
  await installation.getWorkspaceId();
  const params = await context.params;
  const familyKey = stableKeySchema.safeParse(params.familyKey);
  const variantKey = stableKeySchema.safeParse(params.variantKey);
  if (!familyKey.success || !variantKey.success) return notFound(requestId);
  const sample = readMarketCompositionSample(familyKey.data, variantKey.data);
  if (!sample) return notFound(requestId);
  return withRequestId(
    new Response(new Uint8Array(sample.bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(sample.bytes.byteLength),
        "content-type": sample.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    requestId,
  );
}

function notFound(requestId: string) {
  return problemResponse(requestId, 404, "not_found", "Not found");
}
