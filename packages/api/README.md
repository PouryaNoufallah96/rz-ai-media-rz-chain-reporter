# `@rz-chain-reporter/api`

The procedure ladder and the request-boundary helpers. It exports **builders
only** — the router tree lives in `apps/web/src/server/rpc/`, because a package can
never import a feature.

Every file begins with `import "server-only"`.

## The ladder

```
publicProcedure          attaches a request id to every declared error
  └── protectedProcedure     requires a session · declares 401 · adds session
        └── installationProcedure  resolves the installation · declares 503 · adds workspaceId
```

Three rungs. There is no fourth.

Each rung adds both a check and a declared error, so an installation procedure
implicitly declares unauthorised and not-provisioned on top of its own map.

**Zero or several installation rows is a provisioning fault, not an unreachable
database.** It is the only error the installation rung translates; anything else
is re-thrown as internal.

## Request identifiers on every error

The base middleware merges a request id into every declared error's data while
keeping the code, status, message and declared-ness **verbatim** — otherwise the
procedure's declared error map would no longer match, and a client's exhaustive
switch would break.

An error whose data is not a plain object is re-thrown untouched rather than
mutated.

An **inbound** request id is accepted only when it matches a strict pattern;
otherwise a fresh one is generated. A caller cannot inject arbitrary text into
logs.

## Context

```ts
interface Context {
  headers: Headers;
  requestId: string;
  getSession: () => Promise<Session>;
  getWorkspaceId: () => Promise<string>;
}
```

Both getters are memoised per context, so a procedure and its middleware share one
session read.

The session type is derived structurally from the auth package rather than
redeclared — there is no second definition to drift.

`createPublicContext` supplies empty headers, a session getter that always resolves
null, and a workspace getter that **throws synchronously**. A public or cached
scope must never resolve an installation identity, and that is enforced
structurally rather than by convention.

## Problem responses

`problemResponse(requestId, status, code, title)` produces a small RFC 7807-shaped
body with the request id in both the payload and the header. Used by the route
handlers for failures that happen before a procedure is reached.

## Related

[`../../documentation/reference/api.md`](../../documentation/reference/api.md) — every procedure and route handler.
