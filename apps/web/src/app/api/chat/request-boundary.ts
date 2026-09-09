import "server-only";

import { env } from "@rz-chain-reporter/env/server";
import type { z } from "zod";

import { MAX_REQUEST_BYTES } from "@/features/assistant/constants";

const APP_ORIGIN = new URL(env.APP_URL).origin;
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

type AssistantRequestIdentity = { userId: string; workspaceId: string } | null;

async function resolveAssistantRequestIdentity(): Promise<AssistantRequestIdentity> {
  const [{ getSession }, { rpcDb }, { resolveInstallationWorkspaceId }] =
    await Promise.all([
      import("@/features/auth/api/server/session"),
      import("@/server/rpc/db"),
      import("@/server/rpc/workspace"),
    ]);
  const session = await getSession();
  if (!session?.user) return null;
  return {
    userId: session.user.id,
    workspaceId: await resolveInstallationWorkspaceId(rpcDb()),
  };
}

type AssistantRequestBoundaryOptions = {
  appOrigin?: string;
  resolveIdentity?: () => Promise<AssistantRequestIdentity>;
};

export function rejected(status: number) {
  return new Response(null, { status, headers: PRIVATE_HEADERS });
}

export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: PRIVATE_HEADERS });
}

export async function readAssistantRequest<T>(
  request: Request,
  schema: z.ZodType<T>,
  options: AssistantRequestBoundaryOptions = {},
): Promise<
  | { ok: false; response: Response }
  | { ok: true; data: T; userId: string; workspaceId: string }
> {
  if (request.headers.get("origin") !== (options.appOrigin ?? APP_ORIGIN)) {
    return { ok: false, response: rejected(403) };
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return { ok: false, response: rejected(415) };
  }

  const identity = await (
    options.resolveIdentity ?? resolveAssistantRequestIdentity
  )();
  if (!identity) {
    return { ok: false, response: rejected(401) };
  }
  const body = await readBoundedText(request);
  if (body.kind === "empty") {
    return { ok: false, response: rejected(400) };
  }
  if (body.kind === "too-large") {
    return { ok: false, response: rejected(413) };
  }

  let value: unknown;
  try {
    value = JSON.parse(body.text);
  } catch {
    return { ok: false, response: rejected(400) };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, response: rejected(400) };
  }
  return {
    ok: true,
    data: parsed.data,
    userId: identity.userId,
    workspaceId: identity.workspaceId,
  };
}

export async function readBoundedText(
  request: Request,
): Promise<
  { kind: "empty" } | { kind: "too-large" } | { kind: "ok"; text: string }
> {
  const reader = request.body?.getReader();
  if (!reader) return { kind: "empty" };

  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return { kind: "too-large" };
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text.length === 0 ? { kind: "empty" } : { kind: "ok", text };
}
