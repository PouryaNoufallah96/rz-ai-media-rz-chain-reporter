# RZ ChainReporter

Next.js 16.3 and React 19.2 target for the ChainReporter migration. The project
is a pnpm/Turborepo modular monolith with an independently deployed durable
worker.

## Product model

ChainReporter is one reusable product, deployed and configured as a separate
installation per customer. Each installation has its own host, database, object
storage, and provider credentials; its media brands, sources, destination
accounts, models, editorial behavior, and optional Market Analysis capability
are configuration rather than code. There is no public signup and no shared
multi-tenant instance: operator accounts are provisioned when a deployment is
set up.

The two real customer configurations are explicit. `chainreporter` preserves
the four-brand legacy ChainReporter editorial product and disables Market
Analysis. `rzwire` preserves the seven-brand legacy RZWire product and enables
Market Analysis. Its six controlled instruments use CoinMarketCap's documented
keyless public K-line API with explicit BSC contract addresses, with Binance
public spot comparisons through its market-data-only endpoint. Keyed
CoinMarketCap Pro historical quotes remain a separate supported adapter, not an
alias for the public K-line capability (ADR 0015).

## Current foundation

- `apps/web`: App Router, Better Auth, oRPC, React Compiler, Cache Components/PPR, and Partial Prefetching.
- `apps/worker`: Node 24 boundary for durable AI, media, acquisition, publishing, scheduling, and reconciliation.
- `packages/api`: typed oRPC contracts and transport middleware.
- `packages/auth`: Better Auth server configuration.
- `packages/config`: shared TypeScript compiler base for every app and package.
- `packages/cache-invalidation`: framework-free signed cache-invalidation transport shared by web, worker, and deployment CLIs.
- `packages/contracts`: framework-free Zod contracts shared by web, worker, database, and customer-template validation.
- `packages/customer-template`: customer-template schema, loader, and canonical fingerprint.
- `packages/db`: PostgreSQL/Drizzle schema and migrations.
- `packages/env`: client, web-server, worker, build, and migration environment validation.
- `packages/i18n`: framework-free locale, direction, script, and font facts.
- `packages/model-gateway`: framework-free ModelGateway and OpenRouter/Ollama adapters shared by server runtimes.
- `packages/market-chart`: deterministic Market Analysis chart geometry and SVG serialization shared by web and worker.
- `packages/storage`: framework-free MinIO/`Storage` seam (ADR 0009).
- `packages/ui`: owned shadcn/Base UI source and Tailwind 4 tokens.

The scaffold is not the product implementation. Feature work proceeds through
reviewed migration phases and explicit product decisions.

## Bootstrap status

The dependency graph and lockfile are installed with the pinned Node, pnpm,
Turbo, Next, React, and diagnostic versions. Reviewed forward migrations live
in `packages/db/src/migrations` and apply with `pnpm db:migrate`. Compose keeps
web and worker startup gated on successful migration completion.

Current local verification:

```bash
pnpm install --frozen-lockfile
pnpm validate
CUSTOMER_TEMPLATE_KEY=chainreporter pnpm build
# or: CUSTOMER_TEMPLATE_KEY=rzwire pnpm build
```

Copy root `.env.example` to a local ignored `.env` and set `POSTGRES_PASSWORD`
before using Compose. Copy `apps/web/.env.example` and `apps/worker/.env.example`
the same way. Live secrets never belong in tracked files. Local stack
(Postgres, MinIO, Next, worker, Inngest):

```bash
pnpm dev:stack
```

## Database safety

- `db:generate` and reviewed SQL migrations are the normal workflow.
- `db:push` is sanctioned local disposable-database tooling. Keep the script.
  Use it only on a proven disposable local database; never against shared or
  production data. Applying product or phase schema uses reviewed `db:migrate`.
- Runtime and migration identities are separate in deployed environments.

## Delivery boundary

Web and worker build and deploy independently. PostgreSQL owns business state,
MinIO owns binary objects, and the workflow engine coordinates execution. See the
approved infrastructure plan before provisioning any service. No repository
commit, push, Linear or GitLab object, provider account, migration, or deployment
is implied by this scaffold.

The web image uses fixed non-production placeholders only to validate server
environment shape during `next build`; runtime credentials arrive through the
service environment and never become build arguments or image layers.
