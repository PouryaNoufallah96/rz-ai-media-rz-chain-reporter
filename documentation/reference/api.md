# API reference

Two surfaces: typed procedures, and route handlers.

## Typed procedures

Defined with a schema-first contract and composed into one router. Exposed over
HTTP at `/api/rpc`, and — for some procedures — as typed server actions.

A generated OpenAPI document is produced from the live router and committed
alongside this page as [`openapi.json`](openapi.json):

```bash
pnpm --filter web openapi:generate   # rewrite the snapshot
pnpm openapi:check                   # fail if it has drifted from the router
```

`openapi:check` is part of `pnpm validate`, so a procedure whose contract changed
without the snapshot being regenerated fails the gate. Because the snapshot is
committed rather than generated on demand, the check behaves identically on a
fresh clone.

The document's title is fixed, so it does not vary per installation.

### The procedure ladder

```
publicProcedure          attaches a request id to every declared error
  └── protectedProcedure     requires a session · declares 401
        └── installationProcedure  resolves the installation · declares 503
```

Every installation procedure therefore implicitly declares unauthorised and
not-provisioned on top of its own error map, and **every error payload carries a
request id** — the identifier a support conversation is built on.

Zero or several installation rows is a *provisioning fault* (503), not an
unreachable database (500). Different problems, different fixes, different codes.

Authentication is enforced **per procedure**, not at the transport. A new
procedure cannot inherit "public" by accident.

### Namespaces

| Namespace | Procedures |
|---|---|
| `auth` | `signIn`, `signOut` |
| `editorial` | 10 registered |
| `installation` | `overview` |
| `marketAnalysis` | 11 registered |
| `media` | `createIntent`, `confirm` |
| `operations` | `list` |
| `publishing` | 14 |
| `sources` | `startImport` |
| `usage` | `detail` |

### `auth`

| Procedure | Notes |
|---|---|
| `signIn` | Public. Declares invalid-credentials (401) and rate-limited (429) with a retry-after value. Logs an outcome and a request id — **never an email address, a password, or provider error text.** |
| `signOut` | Public. |

There is no `signUp`. Accounts are provisioned from the command line.

### `editorial`

Run commands: `startRun`, `cancelRun`.

Draft commands: `routeDraft`, `reorderDrafts`, `updateDraftRevision`,
`regenerateCopy`, `refreshArticleAndRegenerate`, `retryCopyGeneration`,
`startImageGeneration`, `retryImageGeneration`.

Two shared error maps cover copy operations (validation, not-found, idempotency
reuse, operation-in-progress, template drift) and image operations (those plus
source-extract-required, intent conflict, media locked, version conflict,
reference conflict).

**The accepted run configuration is derived from customer-template bounds** — brand
keys, model keys, platforms, the selection and shortlist caps, the promo prompt
limit, semantic limits and the fan-out ceiling. A run cannot be configured outside
what the installation declares.

Ownership is checked per command: the run must belong to the calling operator.

### `marketAnalysis`

`create`, `updateMarketRequest`, `searchComparisons`, `approveChart`,
`retryChart`, `saveChartDefault`, `approveStory`, `approveDesign`, `generate`,
`retryGenerationFinalization`, `approveFinal`, `preparePlatform`,
`retryCaptions`, `finish`.

**Each stage approval is keyed by a fingerprint of the exact state it approved**,
so an approval does not carry forward across a change.

Every command resolves the analysis through an operator-scoped read first.

### `publishing`

Fourteen procedures covering the whole lifecycle: `saveCard`, `discardCard`,
`restoreCard`, `approve`, `directPublish`, `schedulePublication`,
`cancelScheduledPublication`, `reschedulePublication`,
`recoverMissedPublication`, `retryPublication`, `reconcilePublication`,
`attestTelegramPublication`, `pausePublishing`, `resumePublishing`.

The declared error map is the largest in the system and it is worth reading as
documentation of the domain: approval required, approval snapshot stale, image
generation in progress, media not publishable, text-only not supported,
destination disabled, destination unbound, destination not mapped, publishing
paused, schedule in the past, schedule effect already started, missed schedule
requires confirmation, publication already claimed, publication already confirmed,
reconciliation required, evidence insufficient, Telegram attestation required.

**Adding a repository failure status without mapping it to a declared error is a
compile error.** The mapping is typed against the union of every repository result
status, so a new failure mode cannot silently become a 500.

One nuance worth knowing: recovering a missed schedule is **operator-scoped**,
while retrying a publication is workspace-scoped and takes no user identifier.

### `sources`

`startImport`. Declares validation-failed, import-in-progress (409), template
drift, transient conflict and idempotency reuse.

If the set of importable source identifiers differs from what was requested, the
command **fails validation** rather than silently importing a subset. An unknown
or disabled source is never quietly dropped.

### `media`

`createIntent` and `confirm` — the authenticated upload boundary. Confirmation
checks **ownership first**, then applies the confirmation, and reports whether the
call was a replay.

### `installation`, `operations`, `usage`

`installation.overview` is the read-only configuration view.
`operations.list` is the initial snapshot for the live indicator, operator-scoped.
`usage.detail` is the keyset usage report, operator-scoped.

### Five procedures are server actions only

These are defined but **not registered on the HTTP transport**, and therefore do
not appear in the generated document:

- `editorial.startCopyVariantTranslation`
- `editorial.startPresentationTranslation`
- `marketAnalysis.generate`
- `marketAnalysis.retryGenerationFinalization`
- `marketAnalysis.retryCaptions`

They exist on the server-function boundary only.

### Error shape

Errors are the declared codes from each procedure's map, plus the ladder's
implicit ones, plus the common transport codes. Every payload carries a request
id.

Validation issue messages are **stable codes the presentation layer translates**,
not prose. A client switch over an action's declared codes can be exhaustive.

## Route handlers

Twelve, outside the locale segment because they cannot read a root parameter.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/[...all]` | GET, POST | — | The authentication library's handler. Sign-up disabled. |
| `/api/rpc/[[...rest]]` | GET, POST | Per procedure | The typed API |
| `/api/health` | GET | None | Liveness. The only fully static handler. |
| `/api/health/ready` | GET | None | Readiness |
| `/api/internal/cache-invalidation` | POST | HMAC signature | Cache invalidation |
| `/api/media/[mediaAssetId]` | GET | Session + ownership | Operator media |
| `/api/publishing-media/[grant]` | GET | Capability token | Media for a publishing platform |
| `/api/media-brands/[brandKey]/logo` | GET | Session | A template-declared brand logo |
| `/api/market-analysis-instruments/[key]/icon` | GET | Session | A template-declared icon |
| `/api/market-analysis-compositions/[family]/[variant]` | GET | Session | A template-declared sample |
| `/api/chat` | POST | Session | The assistant's streaming turn |
| `/api/chat/approve` | POST | Session | Load, prepare or approve one run start or template-enabled new Market Analysis |

### Health

`/api/health` returns a static payload. No database, no session, no imports.

`/api/health/ready` returns `503` with a **reason** and no fingerprints:

| Reason | Meaning |
|---|---|
| `database-unavailable` | The probe did not complete within its deadline |
| `not-provisioned` | No installation row |
| `multiple-installations` | More than one |
| `template-not-applied` | The applied fingerprint does not match this process |

It repeats the boot fingerprint check, so a live process **drops out of rotation**
if the database is reconciled underneath it.

### Cache invalidation

HMAC-SHA256 over the timestamp and raw body, constant-time comparison, bounded
clock skew. **Fails closed** when no secret is configured. Body size checked twice
— declared and actual. Tags are validated against a pattern and a count limit.

The response reports each tag and whether it was revalidated; the sender only
reports success when every tag came back confirmed.

The reverse proxy returns `404` for this path from the public internet.

### Media

Two ownership probes in parallel, one for card media and one for market media.
Neither passing is a `404`. An invalid identifier is also a `404` — never a `400`,
so the route is not an existence oracle.

Content length comes from the database record, not from the stream. Responses are
private and uncacheable, with content-type sniffing disabled.

### Publishing media

The capability-token route a publishing platform fetches.

**A malformed token returns `404` with no database lookup at all.** A valid one is
hashed before lookup — the raw token is never a lookup key and never logged.

Refused when: no grant, no recorded byte count, the object is missing, or the
storage length disagrees with the recorded length. Single-use: a second fetch
after acceptance is a `404`.

The response carries no disposition, no redirect, no cookie, and is explicitly
uncacheable. The reverse proxy disables access logging for this path so grant URLs
never reach a log file.

### Template asset routes

All three serve **files bundled into the artifact**, not object storage. Each
requires a session, validates its key against the stable-key grammar, and reads
through a path-bounded loader that verifies the file's declared byte length and
digest before serving. Every failure is a `404`.

### The assistant

Both assistant endpoints use one request boundary. Its guard order is deliberately:
connection, then **origin — checked before the body is touched**, then content
type, then session, then a bounded body read, then parse, then schema.

Every rejection is a bodyless, private, no-store response with no detail. Successful
stream and approval responses are private and no-store too.

The claimed card is authorized against a live draft in **this operator's own run**,
matching platform, brand and content locale. The identifier the browser supplied
is untrusted.

Context comes from reviewed customer knowledge, product help, and authenticated,
bounded reads of this operator's live workspace — never arbitrary retrieval. The
browser may retain at most 40 messages with 24 parts each for 60 minutes, but a
request projects only the six most recent user or assistant text turns and six
minimal read-result referents. That strict context is capped at 12 KiB inside the
32 KiB request limit. Referents carry only a read kind, stable identifier, title
and owner link; the server performs a fresh owner-scoped read before returning a
result, and restored context cannot authorize an effect. Knowledge citations carry
a synthetic document identifier and a digest — never a file path.

The model may call typed clarification and one bounded workspace read. Read output
is a compact assistant card with capped facts and rows. Verified Market artifacts
may use the authenticated media route; other links target the canonical owner
screen. Each card has a clickable **Open** control, and canonical paths in guidance
text are clickable. No read mounts a Card Sheet, publishing desk or Market
Analysis workspace in chat.

The only effect tools prepare one News or Promo run start or, when enabled by the
customer template, one new Market Analysis. Model input is untrusted intent.
Brand, model, source and instrument choices come from current installation owners,
and missing material values must be resolved before a canonical command can be
prepared. Calling a tool does not start an effect.

`/api/chat/approve` loads current run options or the enabled Market Analysis
setup choices, resolves focused values against live template bounds, and signs a
short-lived envelope bound to the operator, installation, exact tool input,
canonical command, material fingerprint and stable idempotency identity. Natural-
language or focused-control changes create a new preview and envelope; only that
preview's explicit Approve button submits it. Tampered, cross-operator, cross-
installation, expired, stale and template-drifted proposals are refused. Lost
responses recover the same run or Market Analysis and operation identity without
admitting a duplicate effect.

The Market tool ends after creation. Chart, Story, Design, Generate, Publish and
every action on an existing analysis stay in the native Market Analysis
workspace. Editorial, Card Sheet, media, approval, publishing and scheduling
actions likewise remain in their native owners and have no assistant approval
payload.

For setup, the model schema accepts bounded instrument references separately
from the canonical owner command's UUID-only fields. The server keeps the exact
SDK-validated input unchanged, resolves names, symbols, keys or IDs against fresh
operator-owned options, and signs both that input and the separately validated
canonical command. Unknown or ambiguous references produce one current-choice
question and never a guessed UUID. Pending answers are bounded conversation data:
omission remains unresolved, an empty comparison list remains explicit, and
Cancel, Clear or a result removes the pending request. Approval revalidates and
re-resolves the signed material before admitting the effect.

The bounded card read accepts either the currently open draft or one exact draft
identifier from an owner-scoped referent. It reauthorizes that Card Sheet state
and fails closed when the draft is malformed, missing or belongs to another
operator; it never falls back to the latest card. Read results expose only capped
screen-visible status and canonical owner links. Completed Market reports may
also expose authenticated chart and final-image URLs. Those URLs are read-only;
the assistant accepts no upload or pending browser file.

Every turn opens an operation whose identity material is a **fresh opaque
identifier** — never the question, the card text, or a content-derived hash.

## Conventions

**Errors** are declared per procedure with explicit status codes. Nothing relies
on an unhandled exception becoming a 500.

**Idempotency**: every command carries an idempotency key and a request hash. A
replay is recognised as a replay; a reused key with different content is a
distinct, declared error.

**Optimistic concurrency**: mutations that can race take an expected version and
declare a version-conflict error.

**Ownership** is checked in the handler, not assumed from the session.

## Adding a procedure

1. Add it to the router module for its namespace.
2. Declare `.input()`, `.output()` and `.errors()` — all three.
3. Choose the right rung of the ladder.
4. Check ownership explicitly.
5. Register it in the router unless it is deliberately a server action only.
6. Run `pnpm openapi:check`, and regenerate if it drifted.
7. Update this page.
