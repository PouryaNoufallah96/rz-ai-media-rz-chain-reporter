import "server-only";

import { auth } from "@rz-chain-reporter/auth";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

// Installation-rung workspace failures only; every other failure stays internal.
export class NotProvisionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotProvisionedError";
  }
}

export interface Context {
  headers: Headers;
  requestId: string;
  getSession: () => Promise<Session>;
  getWorkspaceId: () => Promise<string>;
}

export function createContext(
  headers: Headers,
  requestId: string,
  resolveWorkspaceId: () => Promise<string>,
): Context {
  let session: Promise<Session> | undefined;
  let workspaceId: Promise<string> | undefined;

  return {
    headers,
    requestId,
    getSession: () => (session ??= auth.api.getSession({ headers })),
    getWorkspaceId: () => (workspaceId ??= resolveWorkspaceId()),
  };
}

export function createPublicContext(requestId: string): Context {
  return {
    headers: new Headers(),
    requestId,
    getSession: () => Promise.resolve(null),
    getWorkspaceId: () => {
      throw new Error(
        "A public context has no installation identity: a public or cached scope must never resolve one",
      );
    },
  };
}
