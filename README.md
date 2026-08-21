# RZ ChainReporter

Next.js 16.3 and React 19.2 target for the ChainReporter migration. The project
is a pnpm/Turborepo modular monolith with an independently deployed durable
worker.

## Product model

ChainReporter is one reusable product, deployed and configured as a separate
installation per customer. Each installation has its own host, database, object
storage, and provider credentials; its media brands, sources, destination
accounts, models, and editorial behavior are configuration rather than code. The
crypto ChainReporter is one such installation — another customer could work in an
entirely different domain. There is no public signup and no shared multi-tenant
instance: operator accounts are provisioned when a deployment is set up.

## Current foundation

- `apps/web`: App Router, Better Auth, oRPC, React Compiler, Cache Components/PPR, and Partial Prefetching.
- `apps/worker`: Node 24 boundary for durable AI, media, acquisition, publishing, scheduling, and reconciliation.
- `packages/api`: typed oRPC contracts and transport middleware.
- `packages/auth`: Better Auth server configuration.
- `packages/config`: shared TypeScript compiler base for every app and package.
- `packages/contracts`: framework-free Zod factories shared by `apps/web` and `packages/db`.
- `packages/customer-template`: customer-template schema, loader, and canonical fingerprint.
- `packages/db`: PostgreSQL/Drizzle schema and migrations.
- `packages/env`: client, web-server, worker, build, and migration environment validation.
- `packages/i18n`: framework-free locale, direction, script, and font facts.
- `packages/storage`: framework-free MinIO/`Storage` seam (ADR 0009).
- `packages/ui`: owned shadcn/Base UI source and Tailwind 4 tokens.

The scaffold is not the product implementation. Feature work proceeds through
reviewed migration phases and explicit product decisions.

## Bootstrap status

The dependency graph and lockfile are installed with the pinned Node, pnpm,
Turbo, Next, React, and diagnostic versions. `packages/db/src/migrations` holds
thirteen reviewed migrations, `0000_initial_auth` through `0012_sharp_george_stacy`,
applied to the local development database with `pnpm db:migrate`. Compose keeps
web and worker startup gated on successful migration completion.

Current local verification:

```bash
pnpm install --frozen-lockfile
pnpm run check-types
pnpm run check
pnpm run build
```

Copy root `.env.example` to a local ignored `.env` and set `POSTGRES_PASSWORD`
before using Compose. Copy `apps/web/.env.example` and `apps/worker/.env.example`
the same way. Live secrets never belong in tracked files. Local stack
(Postgres, MinIO, Next, worker, Inngest):

```bash
pnpm dev:stack
```

Use `pnpm exec shadcn` only after the exact CLI version is locked. Never use a
floating `npx`, `pnpm dlx`, or `@latest` command in project instructions.

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
