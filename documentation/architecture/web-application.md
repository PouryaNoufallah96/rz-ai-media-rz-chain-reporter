# The web application

The Next.js App Router on Node24. It serves the operator interface, the HTTP API,
the authenticated media routes, and the health endpoints.

## Framework configuration

| Option | Value | Why |
|---|---|---|
| `cacheComponents` | on | Cached reads and partial prerendering |
| `partialPrefetching` | on | Prefetch the static shell without the dynamic holes |
| `reactCompiler` | on | Stable compiler; memoisation is not hand-written |
| `typedRoutes` | on | Route parameters and search params are typed |
| `output` | `standalone` | The container runtime |
| `serverActions.allowedOrigins` | The public origin | Server-action origin allowlist |
| `serverActions.bodySizeLimit` | Reference-image budget plus a multipart envelope | One number, derived from the contract |
| `logging.serverFunctions` | **off** | On by default in development, and it would print the sign-in password into the terminal in plain text |
| `outputFileTracingIncludes` | Only the selected customer's template | The artifact must not contain every customer's configuration |
| `typescript.ignoreBuildErrors` | Conditional | Not a blanket skip — the build runs the type check first and then sets the flag, so types are checked exactly once instead of twice |

## Routing

```
app/
├── [locale]/              every human route; the locale is a root parameter
│   ├── layout.tsx         the root layout — <html lang dir> lives here
│   ├── page.tsx           the marketing home
│   ├── login/
│   └── (app)/             authenticated group, adds no URL segment
│       ├── dashboard/
│       ├── account/  assistant/  saved/  schedule/  sources/  usage/  installation/
│       └── market-analysis/
├── api/                   route handlers, deliberately outside [locale]
├── global-error.tsx
├── global-not-found.tsx
└── manifest.ts  robots.ts  sitemap.ts
```

**The locale is a root route parameter**, read through the framework's root-params
API and never from cookies or headers. That is what lets `<html lang dir>` render
outside any Suspense boundary while both locales still prerender. Both are
enumerated for static generation.

The locale cookie is disabled. A cookie would make the shell uncacheable, and the
locale is already in the URL.

**Pages are thin and deliberately non-async.** A page passes the *unawaited*
search-params promise down into a feature screen; the awaiting — and therefore the
dynamic boundary — happens inside the feature. That keeps the page itself part of
the static shell.

Two files sit above `[locale]` because they bypass the root layout and so cannot
read a root parameter: the global error boundary and the global not-found page.
Both render their own document at the default locale with hard-coded English copy.
That is deliberate for the error boundary in particular — the localisation
provider may be the thing that failed.

### The proxy is a convenience, not a boundary

`src/proxy.ts` redirects a visitor with no session cookie away from private pages.
It checks **cookie presence only** — no signature, no session lookup. It is a
redirect for the user's benefit, and it is stated as such in the source.

Real authorization happens downstream: in the session getter, in the procedure
ladder, and in each route handler. A layout gate that was the only check would
become a single point of failure the moment one route rendered outside it.

## Feature slices

Thirteen slices under `src/features/`, each owning its own components, schemas,
database queries, cached reads, server actions, hooks and message catalogs.

| Slice | Owns |
|---|---|
| `editorial` | The dashboard: run configuration, the lane board, the card sheet, the filtering report |
| `market-analysis` | The market setup workspace, the six-stage detail view, history and the completed report |
| `publishing` | Saved cards, the publishing desk, the publishing ticket, publication history |
| `account` | The operator's own metrics, activity, ledger, scheduled and saved cards |
| `sources` | The source catalogue, the import ledger and the item stream |
| `usage` | The usage report |
| `installation` | A read-only view of how this deployment is configured |
| `operations` | The always-mounted operations indicator |
| `assistant` | Reviewed knowledge, bounded workspace reads, run-start and Market-creation proposals, and the floating and full-page containers |
| `auth` | Sign-in |
| `media` | The upload boundary |
| `landing` | The marketing home |
| `shared` | The leaf-less hub: cross-slice contracts, URL parsers, the realtime token minter |

The dependency direction and the enforced privacy rules are in
[`../reference/conventions.md`](../reference/conventions.md).

`features/shared` is a hub with no leaves — it may not import any other slice.
That is what keeps it usable everywhere without creating a cycle.

## The API boundary

Typed procedures composed into one router, exposed over HTTP at `/api/rpc` and,
for some procedures, as server actions.

### The procedure ladder

```
publicProcedure         attaches a request id to every declared error
  └── protectedProcedure    requires a session; declares 401
        └── installationProcedure   resolves the installation; declares 503
```

Each rung adds both a check and a declared error, so an installation procedure
implicitly declares unauthorised and not-provisioned on top of its own error map,
and **every error payload carries a request id** — which is what makes a support
conversation about a specific failure possible.

Zero or several installation rows is treated as a *provisioning fault*, not an
unreachable database. Those are different problems with different fixes, so they
get different status codes.

### Five procedures are server actions only

`editorial.startCopyVariantTranslation`, `editorial.startPresentationTranslation`,
`marketAnalysis.generate`, `marketAnalysis.retryGenerationFinalization` and
`marketAnalysis.retryCaptions` are defined in the router modules but not
registered on the HTTP transport. They exist on the server-function boundary only,
and therefore do not appear in the generated API document.

### The RPC handler

- **Cross-site request forgery protection** on both ends — a handler plugin paired
  with a link plugin on the browser client.
- **A body limit**, plus a `Content-Length` rejection *before the body is read*.
- **One shared mutation mapping**: `editorial.startRun` expires the workspace's
  editorial and drafts tags; `editorial.updateDraftRevision` expires drafts. The
  HTTP handler applies that mapping directly after success, while server actions
  retain their existing feature refresh path.

Authentication is not enforced at the handler. It is enforced per procedure by
the ladder — so a new procedure cannot accidentally inherit "public" from its
transport.

## Route handlers

Twelve, and each one's guard order matters.

| Route | Purpose |
|---|---|
| `/api/auth/[...all]` | The authentication library's handler. Sign-up is disabled. |
| `/api/rpc/[[...rest]]` | The typed API |
| `/api/health` | Liveness. The only fully static handler — no imports, no work. |
| `/api/health/ready` | Readiness: a bounded database probe plus the applied-template check |
| `/api/internal/cache-invalidation` | The signed invalidation bridge |
| `/api/media/[mediaAssetId]` | Authenticated operator media |
| `/api/publishing-media/[grant]` | The capability-token route a publishing platform fetches |
| `/api/media-brands/[brandKey]/logo` | A template-declared brand logo |
| `/api/market-analysis-instruments/[key]/icon` | A template-declared instrument icon |
| `/api/market-analysis-compositions/[family]/[variant]` | A template-declared composition sample |
| `/api/chat` | The assistant's streaming turn |
| `/api/chat/approve` | Load, prepare and explicitly approve one run start or template-enabled new Market Analysis |

### Things worth knowing about specific handlers

**Media authorization is operator-owned, not merely workspace-scoped.** The media
route runs two ownership probes in parallel — one for card media, one for market
media — and returns `404` if neither passes. An invalid identifier also returns
`404` rather than `400`, so the route is not an existence oracle. The content
length comes from the database record rather than from the stream.

**The publishing-media route never sees the raw token as a key.** A malformed
token returns `404` with **no database lookup at all**. A valid one is hashed
before lookup. The response carries no disposition, no redirect, no cookie, and is
explicitly uncacheable. A grant is single-use.

**The three template-asset routes serve files bundled into the artifact**, not
object storage — and each is gated on a session, path-bounded to the customer
directory, and verified against the template's declared byte length and digest
before serving. Every failure is a `404`.

**The assistant endpoints share one deliberate guard order**: connection, then
origin (checked *before the body is touched*), then content type, then session,
then a bounded body read, then parse, then schema. Every response is private and
no-store; a rejection is bodyless and carries no detail. Browser-supplied card,
run, analysis and prior-result identifiers are untrusted and are resolved again
through operator-owned reads.

The streaming endpoint answers from reviewed customer knowledge and product help.
Questions about current workspace state use one bounded read tool. Its result is a
compact assistant card with capped facts and rows, safe authenticated media URLs
when a verified Market artifact exists, and a clickable **Open** control for the
owning screen. Paths in guidance replies are clickable too. These cards do not
mount the Card Sheet, publishing desk or Market Analysis workspace inside chat.

The only effect proposals are starting one News or Promo run and, when the
template enables it, creating one new Market Analysis. The assistant collects
missing material values and shows the complete proposal. A separate explicit
approval sends a short-lived signed envelope bound to the operator, installation,
validated command and stable replay identity. A replay returns the same domain
record instead of starting another effect.

Editing, routing, Card Sheet work, media changes, approval, publishing,
scheduling and every later Market Analysis stage stay in their native desks. A
successful assistant result links to the new run or analysis so the operator can
continue there.

The authenticated layout owns one assistant controller and one chat connection.
Its compact, expanded and mobile floating surfaces and the `/assistant` page share
one live conversation body. The page is only another host for that body; it does
not create a second transcript or workflow runtime.

## Server-side composition

`Suspended` is the standard data boundary: an error boundary around a Suspense
boundary around an async resolver, with a render prop. It handles the empty case
explicitly rather than making every caller check.

The error boundary re-throws framework control-flow errors **first**. Redirects,
not-found signals and prerender bailouts arrive as ordinary render errors, and
swallowing them would break navigation in ways that are very hard to diagnose.

The application shell is header-first and full width. Multi Media, Account,
Assistant and Usage are always primary links; **Market Analysis is inserted only
when the template enables it**. The flag is read on the server and passed down as a
boolean — the client never reads the template. Operations is an uncounted utility
indicator rather than a nav link.

## Localization

Message catalogs live per slice. The root provider deliberately passes **no
messages**: an island renders inside a `Localized` wrapper naming exactly the
namespaces it needs. An island without one throws rather than silently leaking
key paths into the interface.

A missing key throws loudly outside production and is swallowed in production.

A fixed `now` is passed to the intl provider, because the library's default is
build time and a build-time timestamp under prerendering produces stale relative
formatting. Callers that need real relative time pass their own.

The Persian font is loaded with preloading **off**, because preload links are
keyed by layout path rather than by locale — leaving it on would ship the Persian
font to every English page.

The locale switch preserves the query string, so switching language does not
discard a filter.

## Logging and privacy

Structured logs go through one logger with a **field allowlist**: outcome,
request identifier and user identifier. Nothing else can be logged as a
structured attribute.

Every value is additionally redacted — authorization headers, cookies, passwords,
secrets, tokens and keys are rewritten, query strings are stripped from URLs, and
values are truncated.

Error reporting is scrubbed hard: breadcrumbs, extra data, request data, tags and
user data are blanked; **every exception value and message is replaced with a
fixed string**; routes are sanitised so identifiers become placeholders and the
publishing-media token becomes `:grant`. Span attribute bags are emptied, because
they carry raw request paths.

Sign-in logs an outcome and a request identifier. No email address, no password,
no provider error text.

## Client-side pieces worth knowing

**`useAction`** is the project's typed server-action hook, used instead of the
framework's built-in. Its error code union is the action's **declared** error
codes plus the common ones plus an unknown fallback, so a component's error
handling can be exhaustive against the router's declared map. Field errors are
extracted by path, and validation messages are treated as **stable codes the
presentation layer translates**, not as prose.

**Realtime freshness** is a small pure state machine shared by the hooks and a
probe: bursts of live messages coalesce into a trailing refresh rather than
fanning out into a refresh storm, and a reconnect fires exactly one catch-up. The
subscription effect uses the "effect event" primitive so it never reconnects when
props change.

**Tables** use an explicitly empty feature set — no client-side sorting, filtering
or pagination. The server owns the query, and pagination is cursor-based.

## Build and packaging

The build is four stages. The application build; an `admin` image containing only
the bundled operator-account commands; a `prestart` stage that builds the identity
gate as a standalone bundle; and the runner.

Operator provisioning is a **separate image**, so the web server has no path to
creating accounts.

The build's environment values arrive as a **BuildKit secret**, never as build
arguments or image environment variables — those persist in image layers.
Committed placeholders keep a local build working.

Details in [`../operations/deployment.md`](../operations/deployment.md).

## Related

- [`caching-and-realtime.md`](caching-and-realtime.md) — how a screen stays fast
  and current
- [`../reference/api.md`](../reference/api.md) — every procedure and handler
- [`../reference/conventions.md`](../reference/conventions.md) — the enforced
  boundaries
