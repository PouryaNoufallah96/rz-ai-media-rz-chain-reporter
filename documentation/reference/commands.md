# Command reference

Every command is defined in a `package.json` in this repository. Root commands
fan out through Turborepo; package commands can also be run directly with
`pnpm --filter <package> <script>`.

## Everyday development

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install exactly what the lockfile says. Use this, not a bare `pnpm install`, unless you are deliberately changing a dependency. |
| `pnpm dev` | Run every package's `dev` task through Turborepo. Assumes PostgreSQL and object storage are already up. |
| `pnpm dev:stack` | Start PostgreSQL and object storage, run the storage bucket initialiser, then start `dev`. This is the normal entry point on a cold machine. |
| `pnpm dev:web` | Run only the web application. It listens on port 3001. |
| `pnpm --filter worker dev` | Run only the worker, watching both its own source and `customer-templates/`. |
| `pnpm --filter worker dev:inngest` | Run the local durable-execution dev server. |

## Verification

| Command | What it checks |
|---|---|
| `pnpm validate` | The full gate: `check`, `check-types`, `i18n:check`, `openapi:check`, the root config lint, and the React diagnostic pass. Runs with `--continue=always` so you see every failure in one pass, not just the first. |
| `pnpm check` | Biome lint and format check across the workspace plus the root config files. |
| `pnpm fix` | The same, writing fixes. |
| `pnpm check-types` | TypeScript across every package. |
| `pnpm i18n:check` | Walks every feature's `messages/` directory and verifies that both locale catalogs carry the same keys and that every message parses as a valid ICU message. |
| `pnpm openapi:check` | Regenerates the OpenAPI document from the live oRPC router and fails if [`documentation/reference/openapi.json`](openapi.json) has drifted from it. `pnpm --filter web openapi:generate` rewrites that file. The snapshot is committed, so the check means the same thing on a fresh clone as it does on your machine. The document title is fixed, so it does not vary per installation. |
| `pnpm doctor` | The React diagnostic pass, run on demand rather than installed as a dependency. |

`pnpm build` requires `CUSTOMER_TEMPLATE_KEY` to be set, because the build
validates and embeds one installation's template:

```bash
CUSTOMER_TEMPLATE_KEY=chainreporter pnpm build
```

## Database

| Command | What it does |
|---|---|
| `pnpm db:start` / `db:stop` / `db:down` | Local PostgreSQL container lifecycle. |
| `pnpm db:watch` | The same container in the foreground, with logs. |
| `pnpm db:generate` | Generate a migration from schema changes. Review the SQL before committing it. |
| `pnpm db:migrate` | Apply reviewed forward migrations. This is what runs in every environment. |
| `pnpm db:push` | Push the schema directly without a migration. Local disposable databases only — see the warning in [`../operations/database-migrations.md`](../operations/database-migrations.md). |
| `pnpm db:studio` | Open the schema browser. |
| `pnpm --filter @rz-chain-reporter/db db:seed` | Seed a development database. |

## Installation configuration

| Command | What it does |
|---|---|
| `pnpm template:reconcile` | Apply the selected customer template to the database — brands, sources, destination accounts and the rest. No startup path ever seeds; this command is the only writer. Add `--check` to compare without writing. |
| `pnpm bindings:preflight` | Verify that every destination account declared by the template has a secret bound in the environment, before anything starts. |
| `pnpm bindings:prestart` | The same check, run as a startup gate so an unbound destination fails loudly at boot rather than at first publish. |
| `pnpm bindings:record` | Record the resolved bindings for an installation. |
| `pnpm --filter @rz-chain-reporter/customer-template validate` | Validate every template directory against the schema, including the declared-file boundary. |

## Operator accounts

There is no public signup. Accounts are created from the command line when an
installation is set up.

| Command | What it does |
|---|---|
| `pnpm --filter web operator:create` | Create an operator account. |
| `pnpm --filter web operator:reset-password` | Reset an operator's password. |

## Containers

| Command | What it does |
|---|---|
| `pnpm docker:build` | Build every service image. |
| `pnpm docker:up` | Build and start the full stack in the background. |
| `pnpm docker:down` | Stop it. |
| `pnpm docker:logs` | Follow logs across services. |

## Probes

Probes are deterministic command-line drivers for one pipeline or one boundary.
They exist because this repository has no test framework: a probe is how a change
to an effectful path is proven before it ships. They read real configuration and
either run against a disposable local database or against fixtures, and they
print an explicit outcome.

### Web

| Command | What it proves |
|---|---|
| `pnpm --filter web probe:assistant-read` | Deterministic assistant read projections, locale forwarding, strict prior-context bounds and owner-scoped read behaviour. |
| `pnpm --filter web probe:assistant-approval` | Assistant request guards plus signed run-start and Market-create approval, expiry, drift, replay and recovery behaviour. |
| `pnpm --filter web probe:assistant-run-start` | Typed run tooling, per-step usage settlement and shared mutation invalidation. |
| `pnpm --filter web probe:assistant-market` | Template-conditional Market Analysis creation, strict approval transport and rejection of retired Market actions. |
| `pnpm --filter web probe:assistant-container` | One assistant conversation moving between compact, expanded, mobile and full-page containers without remounting. |
| `pnpm --filter web probe:editorial-presentation` | Card presentation selection, including which localized bundle is chosen. |
| `pnpm --filter web probe:editorial-freshness` | Freshness handling in the editorial workspace. |
| `pnpm --filter web probe:report-policy` | The filtering report's policy decisions. |
| `pnpm --filter web probe:revision-editor-state` | Draft revision editor state transitions. |
| `pnpm --filter web probe:run-configuration` | How a run's configuration is resolved. |

### Worker

| Command | What it proves |
|---|---|
| `pnpm --filter worker probe:source-import` | Source acquisition end to end. |
| `pnpm --filter worker probe:analysis-run` | The editorial analysis run. |
| `pnpm --filter worker probe:copy-generation` | Copy generation for a draft. |
| `pnpm --filter worker probe:copy-variant-translation` | Copy variant translation. |
| `pnpm --filter worker probe:presentation-translation` | Card presentation translation. |
| `pnpm --filter worker probe:image-generation` | Image generation and branded composition. |
| `pnpm --filter worker probe:market` | The market-data adapters against their real endpoints. |
| `pnpm --filter worker probe:market-generation` | Market poster generation. |
| `pnpm --filter worker probe:verification-settlement` | Market verification settlement. |
| `pnpm --filter worker probe:publishing` | The publishing lifecycle including provider effects. |
| `pnpm --filter worker generation-probe` | The shared generation harness. |
| `pnpm --filter worker scheduled-probe` | Scheduled-effect behaviour. |
| `pnpm --filter worker relay:rearm` | Re-arm the transactional outbox relay after an exhausted lease. |
| `node dist/fetch-probe.js` (bundled) — source `src/fetch/probe-cli.ts` | The outbound-request guard: which URLs are allowed and which are refused. |
| `node dist/editorial.js` (bundled) — source `src/editorial/fixture-cli.ts` | Deterministic editorial filtering against fixtures. |

### Database

| Command | What it proves |
|---|---|
| `pnpm --filter @rz-chain-reporter/db probe:assistant-run-start` | Stable run and operation identity under replay, conflict and response recovery. |
| `pnpm --filter @rz-chain-reporter/db probe:platform-draft` | Platform routing, copy and revision replay, media verification and revision-version behaviour. |
| `pnpm --filter @rz-chain-reporter/db probe:publishing-domain` | Saved cards, exact approval snapshots, publication and schedule replay, recovery, reconciliation, attestation and pause behaviour. |
| `pnpm --filter @rz-chain-reporter/db probe:source-import` | Source import persistence. |
| `pnpm --filter @rz-chain-reporter/db probe:analysis-run-candidates` | Candidate selection for an analysis run. |
| `pnpm --filter @rz-chain-reporter/db probe:presentation-localization` | Presentation localization storage. |
| `pnpm --filter @rz-chain-reporter/db probe:presentation-translation` | The translation request aggregate. |
| `pnpm --filter @rz-chain-reporter/db probe:copy-variant-localization` | Copy variant localization storage. |
| `pnpm --filter @rz-chain-reporter/db probe:market-catalog-bootstrap` | Market comparison catalog bootstrap. |
| `pnpm --filter @rz-chain-reporter/db probe:market-analysis` | Market analysis persistence. |

### Chart

| Command | What it proves |
|---|---|
| `pnpm --filter @rz-chain-reporter/market-chart probe:market-chart` | That the browser preview and the worker's canonical render agree on geometry. |
