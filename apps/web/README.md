# `web`

The operator application: server-rendered interface, the HTTP API, authenticated
media routes and health endpoints. Built on the Next.js App Router.

```bash
pnpm dev:web                        # port 3001
CUSTOMER_TEMPLATE_KEY=<key> pnpm --filter web build
```

## What it does — and what it does not

It reads, renders, and accepts short mutations. Anything long or effectful is
handed to `apps/worker` through a transactional outbox.

**It makes exactly one kind of outbound provider call**: the assistant's streaming
turn, because streaming a reply to the operator *is* the product behaviour. That
exception is named here so it stays the only one.

## Layout

```
src/
├── app/[locale]/     routes; the locale is a root parameter
├── app/api/          route handlers, outside [locale]
├── features/<name>/  all product behaviour
├── server/rpc/       the router composition
├── components/       application-owned composition
├── lib/ hooks/ i18n/ cross-cutting, domain-free
└── proxy.ts          an optimistic redirect, not an authorization boundary
```

Thirteen feature slices. Each owns its components, schemas, database queries,
cached reads, server actions, hooks and message catalogs.

Dependency direction runs one way: `app/` → `features/` → `components`, `hooks`,
`lib`, `i18n`, `packages`. A feature may read another feature's cached reads,
schemas or helpers — never its server actions, database queries or cache tags.
`biome.json` enforces it, and the error message carries the reason.

## Framework configuration

Cache Components and partial prerendering, partial prefetching, the stable React
compiler, typed routes, and a standalone build.

Two settings worth knowing:

- **Server-function argument logging is off.** It is on by default in development
  and would print the sign-in password into the terminal in plain text.
- **Only the selected customer's template is traced into the artifact.** An image
  must never contain another customer's configuration.

## Cached reads

A read of customer-owned data is a cached kernel by default. Authentication and
installation resolution happen **outside** the cache boundary; the kernel is
private and its arguments are the cache key.

**A cache tag is an invalidation group, never a visibility channel.** Operator
isolation lives in the key and the SQL predicate. See
[`../../documentation/architecture/caching-and-realtime.md`](../../documentation/architecture/caching-and-realtime.md).

## Scripts

| Command | Purpose |
|---|---|
| `build:template` | Validates the template and writes the build identity. Runs first in `build`. |
| `i18n:check` | Both locale catalogs agree, and their ICU argument signatures match |
| `openapi:check` / `openapi:generate` | The API snapshot |
| `operator:create` / `operator:reset-password` | Account provisioning — interactive only |
| `probe:*` | Five deterministic policy probes |

## Environment

Copy `.env.example` to `.env`. Names and purposes are in
[`../../documentation/operations/environment-variables.md`](../../documentation/operations/environment-variables.md).

**Never set the durable event key here.** The web application subscribes to
realtime; it does not publish events.

## Packaging

Four stages: the application build; an `admin` image containing only the bundled
operator-account commands; a `prestart` stage building the identity gate as a
standalone bundle; and the runner.

Operator provisioning is a separate image, so the web server has no path to
creating accounts.

Build values arrive as a **BuildKit secret**, never as build arguments or image
environment variables — those persist in image layers.

The entrypoint runs the identity gate before the server, under `set -e`. A failed
gate means the container never starts.

## Related

- [`../../documentation/architecture/web-application.md`](../../documentation/architecture/web-application.md)
- [`../../documentation/reference/api.md`](../../documentation/reference/api.md)
- [`../../documentation/reference/conventions.md`](../../documentation/reference/conventions.md)
