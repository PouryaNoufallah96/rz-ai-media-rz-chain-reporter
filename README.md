# RZ ChainReporter

An AI-assisted editorial desk. It reads a configured set of news sources, filters
and scores what it finds against a media brand's editorial rules, drafts
platform-specific copy, generates branded imagery, and publishes to that brand's
social accounts — with an operator reviewing and approving everything before it
goes out.

The product is deployed and configured as a **separate installation per
customer**. One server, one database, one customer. What differs between
customers is versioned configuration, not code.

**→ [Full documentation](documentation/README.md)**

## Quick start

Requires Docker, plus the Node and pnpm versions the repository pins — `.node-version` and the root `package.json` (`engines`, `packageManager`). A version manager and `corepack enable` will pick both up.

```bash
pnpm install --frozen-lockfile

cp .env.example .env                       # set POSTGRES_PASSWORD
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env

pnpm dev:stack                             # database + object storage + both apps
```

The operator application listens on <http://localhost:3001>.

There is no signup screen. Create your first account from the command line:

```bash
pnpm --filter web operator:create
```

Full setup, including applying a customer template, is in
[`documentation/operations/local-development.md`](documentation/operations/local-development.md).

## Verify a change

```bash
pnpm validate                              # lint, types, message catalogs, API snapshot, React checks
CUSTOMER_TEMPLATE_KEY=chainreporter pnpm build
```

Every command in the repository is catalogued in
[`documentation/reference/commands.md`](documentation/reference/commands.md).

## Workspace

A pnpm workspace built with Turborepo. Two independently deployable applications
and the packages they share.

| Path | What it is |
|---|---|
| [`apps/web`](apps/web/README.md) | Next.js operator application, HTTP API and health checks |
| [`apps/worker`](apps/worker/README.md) | Node worker owning every durable and effectful operation |
| [`packages/api`](packages/api/README.md) | oRPC procedure ladder, middleware and public error mapping |
| [`packages/auth`](packages/auth/README.md) | Authentication and the authorization context |
| [`packages/cache-invalidation`](packages/cache-invalidation/README.md) | Signed cache-invalidation transport shared by both applications |
| [`packages/config`](packages/config/README.md) | The shared TypeScript compiler base |
| [`packages/contracts`](packages/contracts/README.md) | Framework-free schemas, closed enums and event contracts |
| [`packages/customer-template`](packages/customer-template/README.md) | Template schema, loader, fingerprint and key grammar |
| [`packages/db`](packages/db/README.md) | Schema, migrations, repositories and the connection factory |
| [`packages/env`](packages/env/README.md) | Per-surface environment validation |
| [`packages/i18n`](packages/i18n/README.md) | Locale, direction, script and font facts |
| [`packages/market-chart`](packages/market-chart/README.md) | Deterministic chart geometry shared by preview and render |
| [`packages/model-gateway`](packages/model-gateway/README.md) | Model gateway, provider adapters and usage normalization |
| [`packages/storage`](packages/storage/README.md) | The object-storage seam |
| [`packages/ui`](packages/ui/README.md) | Owned components and design tokens |

Configuration data lives outside the workspace, in
[`customer-templates/`](documentation/domain/customer-template.md) — one reviewed
directory per installation, selected at build time by `CUSTOMER_TEMPLATE_KEY`.
Deployment material lives in
[`deploy/`](documentation/operations/deployment.md).

## Architecture in one paragraph

The browser talks only to `apps/web`. Reads are cached server components keyed to
the operator and the installation; short mutations are server actions or oRPC
procedures. Anything long or effectful — fetching a source, calling a model,
writing object bytes, publishing a post — is handed to `apps/worker` through a
transactional outbox and executed as a durable, retryable function. The worker
writes results back to PostgreSQL, tells the web application which cached tags to
expire, and pushes a live update to the screen that is watching. Every model call
goes through one application-owned gateway; every outbound fetch goes through one
request guard. Secrets exist only in the deployment environment.

The long version, with diagrams, starts at
[`documentation/architecture/README.md`](documentation/architecture/README.md).

## Contributing

- Read [`documentation/reference/conventions.md`](documentation/reference/conventions.md)
  before your first change. Most boundaries are enforced by `pnpm check`, and the
  error message tells you which rule you hit and why it exists.
- Ship the documentation change with the code change, not after it. The rules are
  in [`documentation/CONTRIBUTING.md`](documentation/CONTRIBUTING.md).
- Never commit a secret. Environment files are ignored; the `.env.example` files
  carry names and placeholders only.
