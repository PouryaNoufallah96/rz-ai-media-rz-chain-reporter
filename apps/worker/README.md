# `worker`

The background worker. It owns every durable and effectful operation: ingestion,
enrichment, editorial analysis, copy and image generation, translation, market
data and rendering, media verification, storage reconciliation, scheduling and
publishing.

No inbound port except its own health server.

```bash
pnpm --filter worker dev            # watches src/ and customer-templates/
pnpm --filter worker dev:inngest    # the local durable-execution server
```

## Two validated modes

**`durable`** is the real thing. It additionally requires an immutable application
version and refuses the literal `dev` in production.

**`health-only`** starts the health server and nothing else — no template load, no
database, no durable connection. It is what the deployment's one-shot binding step
runs under.

## Health

| Endpoint | Proves |
|---|---|
| `/health` | The process answers |
| `/health/ready` | The database is reachable, exactly one installation exists and its template matches this artifact, the object store answers, the durable connection is active, and the relay is accepting |

Readiness reports a **capability breakdown** rather than a single boolean, so a
failing probe usually identifies its own cause. Draining is reported distinctly
from starting, so a load balancer can drain before the process exits.

## Startup and drain

Observability is initialised **before** the application module is imported, so
tracing is armed before any worker module is evaluated.

The health server starts **before** the dependency checks, so a host can get an
answer while the installation is still being prepared. The dependency loop retries
rather than exiting, logging each distinct failure code once.

Signal handling is owned by the application, not the SDK — the drain order matters:
flip health to unavailable, await initialisation, drain the relay, close the
durable connection, close health, close the database. Each stage is individually
caught; the whole sequence races a deadline.

## Layout

```
src/
├── runtime/ health/      modes, readiness, drain
├── inngest/              events, functions, channels, probe drivers
├── sources/ articles/    ingestion ports and adapters
├── fetch/                the outbound request guard
├── editorial/            deterministic filtering
├── market/ market-generation/
├── publishing/           the publisher port and adapters
├── relay/                the transactional outbox relay
├── model-gateway/        the worker's binding to the shared gateway
├── observability/ logging/
├── web-cache/            cache invalidation and live messages
└── identity/ bindings/   startup gates
```

## Invariants worth knowing

**Nearly every function's first step re-verifies the applied template identity.**
That closes the window where a worker keeps executing against a database
reconciled to a different configuration.

**Cancellation is a durable settlement.** A cancelled run cannot write its own
terminal state, so every cancellable function registers a sibling triggered by the
cancellation event. Without it, a cancelled run leaves a row stuck in `running`.

**The publishing provider effect has zero retries.** A failure there is a
settlement, not something to try again.

**Invalidate the cache, wait for it to settle, then publish the live message.**
Never the reverse — a client woken first would re-read the stale entry.

**Every outbound fetch goes through one guard.** In production it has no exemption
list.

## Environment

Copy `.env.example` to `.env`. Names and purposes are in
[`../../documentation/operations/environment-variables.md`](../../documentation/operations/environment-variables.md).

## Probes

Deterministic drivers for the request guard, each market adapter, the editorial
pipeline against frozen fixtures, each generation path, and the publishing
lifecycle. They are how an effectful change is proven in the absence of a test
framework. Catalogued in
[`../../documentation/reference/commands.md`](../../documentation/reference/commands.md).

## Packaging

One bundle command produces twelve entry points: the main process, the identity
gate, the binding commands, the relay re-arm command and seven probe drivers.

The image ships two fonts — a Latin face and a Persian face — with recorded
provenance, upstream commits, checksums and licences. That pair is what makes
bilingual chart and poster rendering work inside the container.

The entrypoint runs the identity gate before the worker, under `set -e`.

## Related

- [`../../documentation/architecture/worker-application.md`](../../documentation/architecture/worker-application.md)
- [`../../documentation/domain/README.md`](../../documentation/domain/README.md)
