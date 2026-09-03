import "server-only";

import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { readMarketInstrumentSelectorIcon } from "@/features/market-analysis/lib/template";
import { createInstallationContext } from "@/server/rpc/context";

const catalogKeySchema = z.string().regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/u);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ instrumentKey: string }> },
) {
  const installation = createInstallationContext(request.headers);
  const { requestId } = installation;
  const session = await installation.getSession();
  if (!session?.user) return notFound(requestId);
  await installation.getWorkspaceId();
  const params = await context.params;
  const instrumentKey = catalogKeySchema.safeParse(params.instrumentKey);
  if (!instrumentKey.success) return notFound(requestId);
  const icon = readMarketInstrumentSelectorIcon(instrumentKey.data);
  if (!icon) return notFound(requestId);
  return withRequestId(
    new Response(new Uint8Array(icon.bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(icon.bytes.byteLength),
        "content-type": icon.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    requestId,
  );
}

function notFound(requestId: string) {
  return problemResponse(requestId, 404, "not_found", "Not found");
}
