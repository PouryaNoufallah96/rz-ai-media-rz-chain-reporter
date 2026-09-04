import "server-only";

import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import { stableKeySchema } from "@rz-chain-reporter/customer-template/stable-key";
import type { NextRequest } from "next/server";

import { readMediaBrandLogo } from "@/lib/customer-template.server";
import { createInstallationContext } from "@/server/rpc/context";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/media-brands/[brandKey]/logo">,
) {
  const installation = createInstallationContext(request.headers);
  const { requestId } = installation;
  const session = await installation.getSession();
  if (!session?.user) return notFound(requestId);
  await installation.getWorkspaceId();
  const params = await context.params;
  const brandKey = stableKeySchema.safeParse(params.brandKey);
  if (!brandKey.success) return notFound(requestId);
  const logo = readMediaBrandLogo(brandKey.data);
  if (!logo) return notFound(requestId);
  return withRequestId(
    new Response(new Uint8Array(logo.bytes), {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(logo.bytes.byteLength),
        "content-type": logo.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    requestId,
  );
}

function notFound(requestId: string) {
  return problemResponse(requestId, 404, "not_found", "Not found");
}
