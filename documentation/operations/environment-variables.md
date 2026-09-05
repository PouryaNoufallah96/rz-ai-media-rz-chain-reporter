# Environment variables

Every variable the system reads, where it is validated, and what happens when it
is absent.

## How validation is organised

`packages/env` splits validation by **surface** rather than exposing one object,
because the surfaces genuinely differ: the browser must never see a database URL,
the worker is not a Next.js process, and the migration tooling uses a different
identity from the running application.

| Module | Exports | Consumed by |
|---|---|---|
| `server.ts` | An eagerly validated object, server-only | The Next.js server runtime |
| `web.ts` | The client object | The browser — one optional value |
| `worker.ts` | A validation function | The worker runtime and its prestart gate |
| `build.ts` | A validation function | The web build |
| `migration.ts` | Migration and reconcile validators | The database package |
| `destination-bindings.ts` | Per-destination credential resolution | Binding checks and the publishers |
| `browser.ts` | A module that throws on import | The bundler guard |

Every validator treats an **empty string as absent**. `VARIABLE=` and an unset
variable behave identically, which is what makes a commented-out example safe to
uncomment and leave blank.

Origins are validated strictly: a URL that carries credentials, a path, a query or
a fragment is rejected, not trimmed.

The browser module is a deliberate trap. `packages/env` and `packages/db` both
resolve to a module that throws under the `browser` export condition, so an
accidental client import fails loudly at build time instead of quietly bundling a
database driver into a page.

## Core identity

| Variable | Required | Purpose |
|---|---|---|
| `CUSTOMER_TEMPLATE_KEY` | Yes, everywhere | Names the template directory this deployment runs. **Not a secret** — it names committed, reviewed data. Both the images and the running processes assert it agrees with what was built. |
| `DATABASE_URL` | Yes | The runtime data connection. In production it uses the application role, which has no schema privileges. |
| `MIGRATION_DATABASE_URL` | Migrations only | The schema connection, using the migration role. The deploy script refuses a file that defines both this and the runtime URL. |
| `NODE_ENV` | Defaulted | Runtime mode. Also gates the rule that a production worker may not run a mutable version. |
| `APP_VERSION` | Yes for a durable worker | The immutable release identity. It may not be `dev` in production. |

## Web application

| Variable | Required | Purpose |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes, at least 32 characters | Session signing |
| `BETTER_AUTH_URL` | Yes, an origin | The authentication base URL |
| `APP_URL` | Yes, an origin | The public origin, used for site metadata and as the server-action origin allowlist. Distinct from the authentication URL. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | The browser error reporter. The only variable the browser ever sees. |
| `SENTRY_DSN` | Optional | The server-side error reporter. Absent means logs go to standard output. |
| `INNGEST_SIGNING_KEY` | Yes in production | The web application uses it to mint realtime subscription tokens. |
| `OPENROUTER_API_KEY` | Yes | The remote model provider. The assistant cannot start without it. |
| `PUBLISHING_EMERGENCY_PAUSED` | Optional | An operator brake. Only `1` or `true` pauses. |

**Never set the durable event key on the web application.** It publishes no
events; the worker does. The example file says so explicitly.

## Worker

| Variable | Required | Purpose |
|---|---|---|
| `WORKER_MODE` | Yes | `durable` or `health-only`. The health-only mode skips every capability gate and the object store. |
| `WORKER_HEALTH_PORT` | Defaulted to 3002 | The health server port |
| `INNGEST_EVENT_KEY` | Yes when not in development mode | Publishing durable events |
| `INNGEST_SIGNING_KEY` | Yes when not in development mode | Signing durable traffic |
| `INNGEST_DEV` | Development only | Switches the SDK to the local development server. **Refused in every production environment file, and the deploy script greps the rendered Compose output to prove it is absent.** |
| `INNGEST_CONNECT_MAX_WORKER_CONCURRENCY` | Defaulted to 12 | Concurrent function executions. Production sets it lower. |
| `OPENROUTER_API_KEY` | Yes | The remote model backend |
| `OLLAMA_BASE_URL` | Optional | The on-host model backend, when a task's configuration selects it. **Refused in the web environment** — the web application cannot serve it. |
| `FIRECRAWL_API_KEY` | Conditionally | Required only when an enabled source selects a rendered-page fetch mode. Prestart exits with the unbound code if the template needs it and it is missing. |
| `PUBLISHING_EMERGENCY_PAUSED` | Optional | The same brake, checked inside the publish effect |
| `SENTRY_DSN` | Optional | Error reporting |

## Object storage

| Variable | Notes |
|---|---|
| `S3_ENDPOINT` | An origin. Locally the loopback MinIO; in a deployment the service name. |
| `S3_REGION` | Fixed. The schema accepts one literal value. |
| `S3_BUCKET` | The bucket name |
| `S3_ACCESS_KEY_ID` | Must equal the storage service's root user |
| `S3_SECRET_ACCESS_KEY` | Must equal the storage service's root password |

Individually optional at the schema level, but enforced **as a set** by the
prestart gate and the worker's runtime configuration. Four of five present is the
same as none: the object store reports itself unbound and the process refuses to
start in durable mode.

## Publishing credentials

Credentials are bound to a destination account's **stable key**, not to a
hard-coded name. The prefix is the key with hyphens replaced by underscores and
upper-cased.

| Platform | Per destination account | Deployment-wide |
|---|---|---|
| Telegram | `DEST_<PREFIX>_BOT_TOKEN` | — |
| X | `DEST_<PREFIX>_ACCESS_TOKEN`, `DEST_<PREFIX>_ACCESS_TOKEN_SECRET` | `X_API_KEY`, `X_API_SECRET` |
| Instagram | — | `META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN` |

Instagram uses one deployment-wide token for every account rather than a
per-destination secret, which is why it has no per-account variables.

Non-secret values — a Telegram channel, an Instagram account identifier — come
from the **customer template**, not the environment. Only the secret is an
environment variable.

A **whitespace-only value counts as unset**. The binding report names the missing
credential *category*, never the variable that would hold it, so a report can be
pasted into an issue without disclosing the naming scheme of a live deployment.

> **Note:** `META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN` ships **commented out** in
> the starter worker environment, because most installations have no Instagram
> destination. Uncomment and fill it the moment one is enabled — it is
> deployment-wide, so one value covers every Instagram destination.

## Market data

Only relevant when the customer template enables the market capability. Each
provider has an enable flag and an attribution identity; two also take a key.

| Provider | Variables |
|---|---|
| Binance | `MARKET_BINANCE_ENABLED`, `MARKET_BINANCE_GEO_ALLOWED`, `MARKET_BINANCE_ATTRIBUTION_IDENTITY` |
| Public CoinMarketCap | `MARKET_COINMARKETCAP_PUBLIC_ENABLED`, `MARKET_COINMARKETCAP_PUBLIC_ATTRIBUTION_IDENTITY` |
| Keyed CoinMarketCap | `MARKET_COINMARKETCAP_ENABLED`, `MARKET_COINMARKETCAP_ATTRIBUTION_IDENTITY`, `COINMARKETCAP_API_KEY` |
| CoinGecko | `MARKET_COINGECKO_ENABLED`, `MARKET_COINGECKO_ATTRIBUTION_IDENTITY`, `COINGECKO_API_KEY` |

Flags accept `1` or `true`; anything else is false. The prestart gate verifies
that the providers the template actually needs are bound.

## Cache invalidation

| Variable | Purpose |
|---|---|
| `CACHE_INVALIDATION_WEBHOOK_SECRET` | The shared HMAC secret, at least 32 characters |
| `WEB_INTERNAL_BASE_URL` | Where out-of-process writers send the invalidation |

An **optional pair**. Set both and invalidation works; set neither and it is
cleanly disabled, with cached entries expiring on their own schedule. Set only
one and the worker logs a misconfiguration at startup naming which half is
missing.

When the secret is unset on the web side, the internal route fails closed.

The deploy script requires the secret to be **identical** across the web, worker
and reconcile environments — a mismatch would produce invalidations that are
silently rejected.

## Infrastructure

| Variable | Where |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | The database container and the role bootstrap |
| `MIGRATION_ROLE`, `MIGRATION_PASSWORD`, `APP_ROLE`, `APP_PASSWORD` | The three-identity split, production only |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | The storage container. Must match the `S3_*` values. |

## Build-time only

| Variable | Purpose |
|---|---|
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | A stable server-action encryption key, so a redeploy does not invalidate encrypted payloads already in flight |
| `SENTRY_AUTH_TOKEN` | Source-map upload. **Refused in both runtime environments** — a running process has no reason to hold an upload token. |
| `CHAINREPORTER_TYPES_CHECKED` | Set by the build script after the type check, so the framework build can skip its own redundant pass |

These live in the build environment file, which is supplied to the image build as
a **BuildKit secret** rather than as build arguments — build arguments persist in
image layers.

## Example files

| File | Covers |
|---|---|
| `.env.example` | The whole local stack, one flat file |
| `.env.migration.example` | Three keys: the template, the migration connection, the mode |
| `apps/web/.env.example` | The web application in local development |
| `apps/worker/.env.example` | The worker in local development |
| `deploy/env-examples/*.env` | The seven production runtime files |

All are secret-free. Placeholder values use a marker string that the deploy script
greps for and refuses, so a half-filled file cannot reach production.

**Add a variable to an example only when a process already reads it.** An example
listing a variable nothing consumes teaches the next person to configure something
that does nothing.

## Two things a reader should know

**Two variables are asserted by the deploy script but nothing reads them.**
`CORS_ORIGIN` and `SENTRY_AUTH_TOKEN` have no reader in `apps/`, in `packages/`,
or in the build — no source-map upload step is wired. They are required to be
present and are checked for presence, and that is all they do. They are kept
rather than removed because every provisioned installation's environment files
already carry them; retiring them is a deploy-configuration change, not a
documentation one.

`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is a different case and is **not** in that
group: no module in `apps/` or `packages/` reads it, but the framework does, at
build time and again at runtime.

**The encryption key must be identical in the build and web environments, and the
deploy script asserts it.** Server-action arguments are encrypted with it when a
page is rendered and decrypted with it when the form is submitted, so a
divergence builds and starts cleanly and then fails every submission with an
opaque *failed to find server action*. The assertion also rejects an empty value
on either side, which the older presence-only check did not.

## Adding a variable

1. Add it to the right surface in `packages/env/src/`, with a real validator —
   an origin as an origin, a URL as a URL, a bounded integer as a bounded integer.
2. Add it to the matching example file **only if a process already reads it**.
3. Document it here, in the table it belongs to.
4. If it is a secret, confirm it is never logged, never a build argument, and
   never reaches the client bundle.
5. If it must agree with another file's value, add the assertion to the deploy
   script. A mismatch that is only caught at runtime is a mismatch caught during
   an incident.
