import "server-only";
import { randomUUID } from "node:crypto";

const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRequestId(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER)?.trim();
  return supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export function problemResponse(
  requestId: string,
  status: number,
  code: string,
  title: string,
): Response {
  return Response.json(
    { type: "about:blank", title, status, code, requestId },
    { status, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}
