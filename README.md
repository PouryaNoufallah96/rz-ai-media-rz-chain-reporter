# RZ ChainReporter

Next.js 16.3 and React 19.2 target for the ChainReporter migration. The project
is a pnpm/Turborepo modular monolith with an independently deployed durable
worker.

## Current foundation

- `apps/web`: App Router, Better Auth, oRPC, React Compiler, Cache Components/PPR, and Partial Prefetching.
- `apps/worker`: Node 24 boundary for durable AI, media, acquisition, publishing, scheduling, and reconciliation.
- `packages/api`: typed oRPC contracts and transport middleware.
- `packages/auth`: Better Auth server configuration.
- `packages/db`: PostgreSQL/Drizzle schema and migrations.
- `packages/env`: client, web-server, and worker environment validation.
- `packages/ui`: owned shadcn/Base UI source and Tailwind 4 tokens.

The scaffold is not the product implementation. Feature work proceeds through
reviewed migration phases and explicit product decisions.

## Bootstrap status

The dependency graph and lockfile are installed with the pinned Node, pnpm,
Turbo, Next, React, and diagnostic versions. The initial Better Auth
schema migration is generated and reviewed in `packages/db/src/migrations`;
it has not been applied to any database. Compose keeps web and worker startup
gated on successful migration completion.

Current local verification:

```bash
pnpm install --frozen-lockfile
pnpm run check-types
pnpm run check
pnpm run build
```

Copy root `.env.example` to a local ignored `.env` and set `POSTGRES_PASSWORD`
before using Compose. Local stack (Postgres, Next, worker, Inngest):

```bash
pnpm dev:stack
```

Use `pnpm exec shadcn` only after the exact CLI version is locked. Never use a
floating `npx`, `pnpm dlx`, or `@latest` command in project instructions.

## Database safety

- `db:generate` and reviewed SQL migrations are the normal workflow.
- `db:push` is local disposable-database tooling only; never use it for shared or production data.
- Runtime and migration identities are separate in deployed environments.

## Delivery boundary

Web and worker build and deploy independently. PostgreSQL owns business state,
R2 owns binary objects, and the workflow engine coordinates execution. See the
approved infrastructure plan before provisioning any service. No repository
commit, push, Linear or GitLab object, provider account, migration, or deployment
is implied by this scaffold.

The web image uses fixed non-production placeholders only to validate server
environment shape during `next build`; runtime credentials arrive through the
service environment and never become build arguments or image layers.
