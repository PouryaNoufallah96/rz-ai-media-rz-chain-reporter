# `@rz-chain-reporter/db`

PostgreSQL with Drizzle: the schema, the migrations, the repositories, the
connection factory, and the customer-template reconciler.

## Server and worker only

The package resolves to a module that **throws on import** under the browser
export condition. An accidental client import fails loudly at build time instead
of quietly bundling a database driver into a page.

## What it exports

| Subpath | Contains |
|---|---|
| `.` | `createDb`, the probe timeout constant |
| `./schema` and `./schema/*` | Tables and enum types |
| `./repositories/*` | Command and query functions |
| `./executor` | The executor and transaction types, and the workspace-context helper |
| `./filters` | Workspace and soft-delete predicates, safe pattern escaping |
| `./db-error` | Driver-error classification |

## `createDb`

```ts
const { db, check, close } = createDb(url, { connectionTimeoutMillis });
```

Caller options can override the pool defaults but **never** the connection string,
which is applied last.

### `check()` bounds three layers, because they stack

1. **Pool acquisition** — waiting for a connection.
2. **The per-query clock**, which only starts *after* acquisition.
3. **An outer deadline** covering both together.

Bounding fewer than three reintroduces a health check that can hang past its own
timeout. Both consumers — the web readiness route and the worker health server —
pass the same constant.

## Schema conventions

**Primary keys** are time-ordered UUIDs from a PostgreSQL built-in — the one
introduced in version 18, which is therefore the floor. The schema uses **no
extensions at all**.

**Every foreign key is named by hand.** That is load-bearing: the error classifier
reads constraint names to turn a driver error into a domain outcome. An
auto-generated name would not be recognised — the helper module says so
explicitly.

**Business rules live in the database where they can.** Single-in-flight rules are
partial unique indexes. Immutability and state transitions are triggers. Two
concurrent requests cannot both win a race PostgreSQL is arbitrating.

## Error classification

`classifyDbError` turns driver errors into domain outcomes:

| Condition | Result |
|---|---|
| Serialization failure or deadlock | Retry |
| A named unique violation | The specific domain error it means |
| A foreign-key violation on a named constraint | Not found |
| Anything else | Unclassified |

Three constraints carry business meaning by name: operation identity, active saved
card, and unsettled source import.

## Workspace context

`withWorkspaceContext(tx, workspaceId)` sets a **transaction-local** setting.
Transaction-local is deliberate — a session-local value would leak to the next
borrower of the pooled connection.

It is a diagnostic stamp, not row-level-security enforcement.

## Migrations

Forward-only SQL under `src/migrations/`, generated from the schema and reviewed
before commit.

```bash
pnpm db:generate    # generate from schema changes
pnpm db:migrate     # apply reviewed migrations
pnpm db:push        # local disposable databases only
```

`db:push` applies the schema with no migration and no history. Read
[`../../documentation/operations/database-migrations.md`](../../documentation/operations/database-migrations.md)
before using it.

Migrations use a separate connection string and, in a deployment, a separate role
with schema privileges the application role does not have.

## The reconciler

```bash
pnpm template:reconcile [--check]
```

Applies the customer template to the database: the workspace, brands, market
instruments, sources, destination accounts and their mappings. One transaction,
under a deployment-wide advisory lock.

**`--check` is enforced by PostgreSQL** in a read-only transaction, and exits with
a distinct code on divergence.

A workspace row with no template key is adopted. One holding a *different* key
raises a foreign-installation error and is never rewritten — the guard against
pointing a reconcile at another customer's database.

Exactly one change is blocked rather than applied: changing an existing
destination account's platform.

## Probes

Eleven under `src/probes/`. Each builds a real fixture in a real database,
exercises real repository functions — several with genuinely concurrent
transactions — asserts, cleans up and prints an explicit summary.

They are how the schema's guarantees are verified without a test framework. See
[`../../documentation/reference/commands.md`](../../documentation/reference/commands.md).

## Related

[`../../documentation/domain/data-model.md`](../../documentation/domain/data-model.md) — every table, grouped by aggregate.
