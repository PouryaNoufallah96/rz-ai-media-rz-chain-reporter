# Repository layout

A pnpm workspace driven by Turborepo. Two deployable applications sit in `apps/`,
and everything they share sits in `packages/`. `pnpm-workspace.yaml` declares the
globs `apps/*` and `packages/*`; nothing else is a workspace package.

```
rz-chain-reporter/
├── apps/
│   ├── web/                  Next.js operator application
│   └── worker/               Node background worker
├── packages/
│   ├── api/                  oRPC procedure ladder and middleware
│   ├── auth/                 Better Auth configuration
│   ├── cache-invalidation/   Signed cache-invalidation transport
│   ├── config/               Shared TypeScript compiler base
│   ├── contracts/            Framework-free Zod contracts and enums
│   ├── customer-template/    Template schema, loader and fingerprint
│   ├── db/                   Drizzle schema, migrations and repositories
│   ├── env/                  Per-surface environment validation
│   ├── i18n/                 Locale, direction, script and font facts
│   ├── market-chart/         Deterministic chart geometry and SVG
│   ├── model-gateway/        Model gateway and provider adapters
│   ├── storage/              Object-storage seam
│   └── ui/                   Owned components and design tokens
├── customer-templates/       Versioned per-installation configuration data
├── deploy/                   Compose files, Nginx, scripts, environment examples
├── documentation/            This documentation set
└── patches/                  Reviewed dependency patches
```

## Why the split is where it is

A package exists when it has at least two real consumers, or when it owns a
boundary that has to stay independent of any one deployment. That rule is why
there is no generic `utils` package and no `types` package: feature behaviour
stays inside the feature that owns it.

Several packages are deliberately **framework-free** — no `next`, no
`server-only`, no React. That is not stylistic. `apps/worker` is a plain Node
process that must be able to import them, and a `server-only` import or a `next`
dependency would break that. The packages in this category are `contracts`,
`cache-invalidation`, `customer-template`, `i18n`, `market-chart`,
`model-gateway` and `storage`.

The reverse direction is closed: `packages/**` never imports `apps/**`. If it
did, the worker could no longer build and deploy independently of the web
application, and the build graph would contain a cycle.

## The two applications

| | `apps/web` | `apps/worker` |
|---|---|---|
| Runtime | Next.js App Router on Node | Plain Node process |
| Serves | Operator browser traffic, the HTTP API, health checks | No public traffic; a health endpoint only |
| Owns | Reads, short mutations, cached rendering, session handling | Every long or effectful operation |
| Deployed | Independently | Independently |
| Build output | Next standalone bundle | A bundled ESM entry plus operator CLIs |

The dividing line is durability. Anything that calls a model provider, fetches a
remote source, writes object bytes, or publishes to a social platform runs in the
worker, where it can be retried and reconciled. A request-bound route never does
that work — with exactly one documented exception, the assistant's streaming
turn, which is described in
[`architecture/web-application.md`](../architecture/web-application.md).

## Inside `apps/web/src`

Vertical slices. Route files stay thin and compose a feature; product behaviour
lives in `features/`.

| Path | Contents |
|---|---|
| `app/[locale]/` | Routes only. The locale is a root route parameter, so the root layout lives here rather than one level up. |
| `app/api/` | Route handlers, deliberately outside `[locale]` because they cannot read a root parameter. |
| `features/<name>/` | All product behaviour: components, schemas, database queries, cached reads, server actions, hooks and message catalogs. |
| `server/rpc/` | The oRPC router composition — the one place allowed to import across every feature. |
| `components/` | Application-owned composition: layout shell, providers, tables, form shells. |
| `lib/`, `hooks/`, `i18n/` | Cross-cutting, domain-free code. |

Dependency direction runs one way: `app/` → `features/` → `components`, `hooks`,
`lib`, `i18n`, `packages`. A feature may read another feature's cached reads,
schemas or helpers, but never its server actions, database queries or cache tags
— crossing those particular lines would either couple two invalidation graphs or
bypass the owning feature's authorization. `biome.json` enforces the boundaries
that can be enforced statically.

## Inside `apps/worker/src`

Grouped by responsibility rather than by feature, because a single durable
pipeline touches several providers.

| Path | Contents |
|---|---|
| `runtime/`, `health/` | Worker mode validation, readiness state, health server, ordered drain |
| `inngest/` | Durable event definitions, function definitions, realtime channels, probe CLIs |
| `sources/`, `articles/` | Ingestion ports and their adapters |
| `fetch/` | The outbound-request guard every remote fetch goes through |
| `editorial/` | Deterministic filtering, scoring and localization helpers |
| `market/`, `market-generation/` | Market data adapters and market poster generation |
| `publishing/` | Publisher port, per-platform adapters and reconciliation |
| `relay/` | Transactional outbox relay |
| `model-gateway/` | The worker's binding to the shared gateway |
| `observability/`, `logging/` | Tracing, error reporting and metadata-only logs |
| `web-cache/` | Best-effort cache-invalidation notifications back to the web app |
| `identity/`, `bindings/` | Build identity assertion and destination-binding checks |

## `customer-templates/`

Not a workspace package. It is reviewed configuration data, one directory per
installation, selected at build time by the `CUSTOMER_TEMPLATE_KEY` environment
variable. Each build copies only the selected directory into its artifact. See
[`domain/customer-template.md`](../domain/customer-template.md).

## `deploy/`

Everything that is common to every installation: Compose files, the deployment
script, Nginx templates, database bootstrap, backup, and secret-free environment
examples. Per-installation secrets are never tracked here. See
[`operations/deployment.md`](../operations/deployment.md).
