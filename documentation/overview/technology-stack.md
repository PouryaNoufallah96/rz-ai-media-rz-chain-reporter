# Technology stack

What the product is built on, and why each piece was chosen.

**No version numbers appear on this page, deliberately.** A version written into
prose is wrong the first time someone runs an upgrade, and nobody notices until a
reader trusts it. The versions in force are always readable from the repository
itself, in exactly three places:

| What | Read it from |
|---|---|
| The Node.js version | `.node-version`, and the `engines` block in the root `package.json` |
| The package manager | the `packageManager` field in the root `package.json` |
| Every library version | the `catalog:` section of `pnpm-workspace.yaml` |

That third one is the important one: a dependency version is declared **once**
for the whole workspace and referenced by name from every `package.json`, so two
packages cannot silently disagree.

## Runtime and toolchain

| Tool | Where it is pinned | Why this choice |
|---|---|---|
| Node.js | `.node-version`, `package.json` `engines` | Native ESM, stable `node:` built-ins, and the `--import tsx` loader the operator scripts rely on. The worker bundle targets the same major. |
| pnpm | `package.json` `engines` + `packageManager` | Content-addressed store and strict `node_modules` layout, so an undeclared dependency fails at build rather than at runtime. |
| Turborepo | root `devDependencies` | Task graph and content-hash caching across the workspace. |
| TypeScript | catalog | One compiler for every app and package, configured once in `packages/config/tsconfig.base.json`. |
| Biome | root `devDependencies` | Single binary for formatting and linting, and the place architectural import boundaries are enforced. |

## Application frameworks

| Library | Used by |
|---|---|
| Next.js | `apps/web` |
| React / React DOM | `apps/web`, `packages/ui` |
| Inngest | `apps/worker`, realtime channels in `packages/contracts` |
| Drizzle ORM | `packages/db` |
| `pg` | `packages/db` connection pool |
| Better Auth | `packages/auth` |
| oRPC (`@orpc/*`) | `packages/api`, `apps/web` |
| Zod | every package that validates anything |
| Tailwind CSS | `packages/ui`, `apps/web` |

Next.js is additionally pinned through a top-level `overrides` entry in
`pnpm-workspace.yaml`, so a transitive dependency cannot pull a second copy of
the framework into the tree.

## AI and provider libraries

| Library | Purpose |
|---|---|
| `ai` (AI SDK) | Model calls behind `packages/model-gateway` |
| `@ai-sdk/react` | The assistant streaming turn in `apps/web` |
| `@openrouter/ai-sdk-provider` | The remote model backend |
| `@ai-sdk/openai-compatible` | The optional on-host model backend |
| `@ai-sdk/otel` | Trace attributes for model calls |
| `sharp` | Image composition in `apps/worker` |
| `@aws-sdk/client-s3` + presigner | The object-storage driver in `packages/storage` |
| `undici` | Outbound HTTP with a pinned DNS lookup, which is what makes the request guard in `apps/worker/src/fetch/` possible |
| `fast-xml-parser` | RSS and Atom parsing — never a regular expression |
| `htmlparser2` | Article extraction |
| `firecrawl` | The optional article fetcher for sources that need rendered pages |

## User interface

| Library | Purpose |
|---|---|
| `@base-ui/react` | Unstyled accessible primitives underneath the owned components |
| `@shadcn/react` | Component source that lives in `packages/ui/src`, not in `node_modules` |
| `next-intl` | Message catalogs and locale-aware formatting |
| `nuqs` | Typed URL state for filters, sort and pagination |
| `react-hook-form` + `@hookform/resolvers` | Application forms, validated by the same Zod schemas the server uses |
| `@tanstack/react-query` | Client-owned asynchronous state, mainly around realtime channels |
| `@tanstack/react-table` | Genuinely tabular screens |
| `@tanstack/react-hotkeys` | Typed app command shortcuts with portable Mod bindings |
| `@dnd-kit/react` + `@dnd-kit/dom` | Accessible lane and card reordering |
| `lucide-react` | Icons |
| `sonner` | Toasts |
| `next-themes` | Theme switching |
| `@daypicker/react` + `@daypicker/persian` | Date selection in both calendars the product supports |

## Observability

| Library | Purpose |
|---|---|
| `@sentry/nextjs` | Errors, sampled traces and redacted structured logs in `apps/web` |
| `@sentry/node` | The same in `apps/worker` |
| `@opentelemetry/api` | Span API |
| `@opentelemetry/sdk-trace-node` | Worker tracer provider |

Sentry is optional per installation. When its DSN is absent the application still
runs and structured logs fall back to stdout.

## Dependency policy

Four settings in `pnpm-workspace.yaml` exist to keep supply-chain risk and
version drift down:

- **`catalog:`** — a dependency version is written once and referenced by name
  from every `package.json`. Two packages cannot silently disagree on a version.
- **`minimumReleaseAge`** — a package published within the configured window is
  not installable, which blocks the period in which most compromised releases are
  caught and yanked. `minimumReleaseAgeExclude` lists the exceptions currently
  granted.
- **`allowBuilds`** — postinstall scripts are denied by default. Only the
  packages listed there may run one; the denied list names the ones that asked
  and were refused.
- **`patchedDependencies`** — reviewed patches live under `patches/`. The patch
  file is part of the diff, so the change is reviewable.

## Upgrading

Change the version in the one place it is declared — the catalog entry,
`.node-version`, or `engines` — then run `pnpm install` and `pnpm validate`. No
documentation page needs editing, because none of them state a version.

What *does* need editing is any page that states a **capability** a version
gave us. There is exactly one of those: the database page records that primary
keys use a built-in time-ordered UUID function, which needs PostgreSQL 18 or
later. If a floor like that changes, the page that states the capability changes
with it.

## What is deliberately absent

- **No test framework.** Verification is done with type checks, static analysis,
  and the deterministic probe commands catalogued in
  [`../reference/commands.md`](../reference/commands.md).
- **No second authentication library.** Better Auth is the only one.
- **No second remote model provider.** OpenRouter is the only remote backend;
  the alternative is an on-host backend, selected per task by configuration.
- **No client-side database or object-storage access.** The browser talks only to
  `apps/web`.
