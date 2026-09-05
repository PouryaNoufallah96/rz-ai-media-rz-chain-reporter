# `@rz-chain-reporter/env`

Environment validation, split by surface.

## Why it is split

The surfaces genuinely differ. The browser must never see a database URL. The
worker is not a framework process. Migrations use a different identity from the
running application. One combined object would either over-expose or over-require.

| Subpath | Exports | Consumed by |
|---|---|---|
| `./server` | An eagerly validated object | The web server runtime |
| `./web` | The client object | The browser |
| `./worker` | A validation function | The worker and its startup gate |
| `./build` | A validation function | The web build |
| `./migration` | Migration and reconcile validators | The database package |
| `./destination-bindings` | Per-destination credential resolution | Binding checks and the publishers |

Every server and worker subpath resolves to a module that **throws on import**
under the browser condition.

## Conventions

**An empty string is absent.** `VARIABLE=` and an unset variable behave
identically, which is what makes a commented-out example safe to uncomment and
leave blank.

**Origins are validated strictly** — a URL with credentials, a path, a query or a
fragment is rejected, not trimmed.

**Individually optional, collectively required.** The object-storage values are
optional in the schema and enforced *as a set* by the startup gate. Four of five
present is the same as none.

## Destination bindings

A destination account's **stable key** becomes an environment variable prefix: the
key with hyphens replaced by underscores, upper-cased.

| Platform | Per account | Deployment-wide |
|---|---|---|
| Telegram | Bot token | — |
| X | Access token and secret | Application key and secret |
| Instagram | — | One system-user token |

Instagram uses one deployment-wide token rather than a per-account secret, which
is why it has no per-account variables.

**Non-secret values come from the customer template**, not the environment — a
Telegram channel, an Instagram account identifier. Only the secret is a variable.

A **whitespace-only value counts as unset**.

The binding report names the missing credential **category, never the variable**,
so a report can be pasted into an issue without disclosing a live deployment's
naming.

## Adding a variable

1. Add it to the right surface with a real validator — an origin as an origin, a
   bounded integer as a bounded integer.
2. Add it to the matching `.env.example` **only if a process already reads it**.
3. Document it in
   [`../../documentation/operations/environment-variables.md`](../../documentation/operations/environment-variables.md).
4. If it must agree with another file's value, add the assertion to the deploy
   script. A mismatch caught only at runtime is a mismatch caught during an
   incident.
