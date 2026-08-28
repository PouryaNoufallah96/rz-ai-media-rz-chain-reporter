import "server-only";

import { env } from "@rz-chain-reporter/env/server";
import { connection } from "next/server";
import { MAX_REQUEST_BYTES } from "@/features/assistant/constants";
import { assistantChatRequestSchema } from "@/features/assistant/schemas/chat-request";
import { getSession } from "@/features/auth/api/server/session";
import { respondToAssistantTurn } from "./respond";

const APP_ORIGIN = new URL(env.APP_URL).origin;

function rejected(status: number) {
  return new Response(null, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  await connection();

  // Origin is checked before the body is touched, and the body is byte-capped
  // before it is parsed.
  if (request.headers.get("origin") !== APP_ORIGIN) {
    return rejected(403);
  }

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return rejected(415);
  }

  const session = await getSession();

  if (!session?.user) {
    return rejected(401);
  }

  const body = await readBoundedText(request);

  if (body === null) {
    return rejected(413);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return rejected(400);
  }

  const validated = assistantChatRequestSchema.safeParse(parsed);

  if (!validated.success) {
    return rejected(400);
  }

  return respondToAssistantTurn(
    validated.data,
    session.user.id,
    request.signal,
  );
}

async function readBoundedText(request: Request) {
  const reader = request.body?.getReader();

  if (!reader) {
    return null;
  }

  const chunks: BlobPart[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    size += value.byteLength;

    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }

    chunks.push(value.slice().buffer);
  }

  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}
