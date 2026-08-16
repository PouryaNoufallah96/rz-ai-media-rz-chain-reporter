import "server-only";

import { auth } from "@rz-chain-reporter/auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

export interface Context {
  headers: Headers;
  requestId: string;
  getSession: () => Promise<Session>;
}

export function createContext(headers: Headers, requestId: string): Context {
  let pending: Promise<Session> | undefined;

  return {
    headers,
    requestId,
    getSession: () => (pending ??= auth.api.getSession({ headers })),
  };
}

export function createPublicContext(requestId: string): Context {
  return {
    headers: new Headers(),
    requestId,
    getSession: () => Promise.resolve(null),
  };
}
