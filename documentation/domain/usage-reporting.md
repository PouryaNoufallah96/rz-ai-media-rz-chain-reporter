# Usage reporting

What every model call cost, and why nothing is ever blocked because of it.

## Reporting, not enforcement

**Usage is recorded and reported. It is never enforced.**

There are no plans, tariffs, entitlements, allowances, reservations, settlement,
or quota stops. Nothing is refused because a number was reached.

The reason follows from the deployment model: there is no commercial relationship
*inside* the product. One installation serves one customer, on their own
infrastructure, with their own provider credentials. Their spend is their own.

Building enforcement would add a failure mode — work refused for the wrong reason,
at the worst time — with no corresponding benefit. So the operator gets a screen
that answers "where did the money go", and nothing that stands between them and
their own work.

## What is recorded

One row per model invocation attempt:

| Field | Purpose |
|---|---|
| Provider generation identifier | Correlates with the provider's own billing record |
| Requested and resolved model | What was asked for, and what actually served it |
| Backend and gateway | Remote or on-host |
| API kind | Chat, embedding, or image |
| Token counts | Prompt, completion, reasoning, cache read, cache write, total |
| Cost | The authoritative returned figure, stored as a decimal string |
| Cost authority | Where that figure came from |
| Status | Pending, succeeded, failed, cancelled, unknown |
| Task context | The task key, the invocation key, the operation and attempt |
| Timestamps | When it happened |

The row is keyed to an **operation attempt**, so every cost is traceable to the
work that incurred it — which run, which draft, which brand, which operator.

## The three properties that make it trustworthy

### It is written before the call

A pending row is inserted, then the provider is called, then the row is
finalised.

If the process dies mid-call, the row exists in `pending` and is visible. A row
written afterwards would simply not exist, and the spend would be invisible.

### It commits with the work

The domain write and the ledger finalisation happen in **one transaction**. There
is no window in which content exists without its cost, or a cost exists for
content that was not saved.

If that transaction fails, the outcome is `ambiguous` with a specific reason —
not a guess in either direction.

### Cost carries its provenance

| Authority | Meaning |
|---|---|
| Billed | The provider returned a cost. This is the real figure. |
| Estimated | Present in the vocabulary; the gateway does not produce it. |
| Local | An on-host call, with no external cost |
| Unknown | The call happened and no cost came back |

**The gateway never estimates.** An estimate that looks like a bill is worse than
no number, because it invites decisions based on false precision.

Cost is stored as a decimal string rather than a float, because summing floating
point currency over thousands of rows produces answers that do not reconcile.

## Reconciliation

Some providers return a final cost after the fact. A partial unique index on the
generation identifier ensures one row per generation, so a later correction
**updates** the row rather than adding a second.

Rows record whether they were written inline or reconciled afterwards, so a
correction is visible as a correction.

## Ambiguity here too

A usage row can be `unknown`, and that is a real state rather than a bookkeeping
gap:

- A timeout — the provider may well have completed and charged for it.
- An abandoned stream, if it had already produced output.
- A failed finalising transaction where ownership could not be resolved.

An unknown row means "this may have cost something, and we cannot confirm how
much". Reporting it as zero would understate spend; reporting it as the requested
maximum would overstate it. So it is reported as unknown.

A stale pending row older than its deadline is force-finalised to unknown rather
than being left pending forever.

## The operator screen

`/usage` reports across the operator's own attempts, filterable by model,
provider, task and period, with cursor-based pagination.

It is **operator-scoped**: an operator sees the cost of the work they ran. The
read is cached and keyed to both the installation and the operator, and it is
invalidated by the worker after every settlement — so the screen reflects a run
that finished seconds ago.

A live message on the operator's own usage channel triggers the refresh.

## What is deliberately absent

- No budgets, no alerts, no thresholds.
- No per-brand or per-customer allocation beyond what a query can compute.
- No forecasting.
- No enforcement of any kind.

If any of these are wanted later, the ledger has the data. What it does not have —
and should not gain without a deliberate decision — is a code path that refuses
work.

## Where the code is

| Concern | Path |
|---|---|
| The ledger table | `packages/db/src/schema/ai-usage-event.ts` |
| Normalisation and diagnosis | `packages/model-gateway/src/usage.ts` |
| Write and finalisation | `packages/model-gateway/src/gateway.ts` |
| The operator screen | `apps/web/src/features/usage/` |

Related: [`content-generation.md`](content-generation.md) for how a call is made,
and [`../architecture/observability.md`](../architecture/observability.md) for how
the ledger fits alongside the other diagnostic surfaces.
