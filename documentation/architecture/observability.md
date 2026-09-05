# Observability

What is recorded when something goes wrong, and — just as important — what is
never recorded.

## The constraint that shapes everything

This system handles a customer's editorial content: source articles, generated
copy, model prompts, images. **None of it may appear in a log, a trace, an error
report or an analytics event.**

That is not a preference. Telemetry leaves the installation, and a system that
ships article bodies to an error tracker has quietly built a second, unmanaged
copy of the customer's data somewhere else.

So the guiding rule is: **record identifiers and outcomes, never content.**

## What is recorded

| Signal | Carries |
|---|---|
| Structured logs | An event name, an outcome, a request identifier, a user identifier |
| Traces | Metadata-only spans with sanitised routes |
| Errors | A stable code and a sanitised route |
| Operation ledger | Every durable operation and attempt, with its outcome |
| Usage ledger | Model, backend, tokens, cost, task context |
| Activity events | The operator-visible audit trail |

The last three are **database tables, not telemetry** — they are product surfaces,
queryable, and they never leave the installation. That is deliberate: the
questions an operator actually asks ("what did this cost", "who approved this",
"why did that publish fail") are answered from PostgreSQL, not from a
dashboard.

## Structured logging

One logger per application. Two things constrain it:

**A field allowlist.** Only outcome, request identifier and user identifier may be
logged as structured attributes. There is no path for an arbitrary field.

**Redaction on every value.** Authorization headers, cookies, passwords, secrets,
tokens and keys are rewritten; query strings are stripped from URLs; values are
truncated.

Two independent controls, because the allowlist is the design and redaction is
the safety net for when someone widens it.

Event names are stable dotted identifiers — `worker.relay.dispatched`,
`worker.fetch.blocked`, `auth.sign_in` — so a log can be filtered without
matching on prose.

**When no error collector is configured, logs go to standard output** as
single-line JSON. That is a fully supported configuration, not a degraded one.

## Error reporting

Error reporting is optional per installation. When it is present, events are
scrubbed hard before they leave:

- Breadcrumbs, extra data, request data, tags and user data are **blanked**.
- **Every exception value and message is replaced with a fixed string.** Not
  truncated, not filtered — replaced. An exception message is arbitrary text from
  somewhere, and that is exactly what must not be shipped.
- Routes are sanitised: query strings dropped, numeric and identifier path
  segments replaced with placeholders, and the publishing-media token path
  collapsed to a placeholder.
- Span attribute bags are emptied, because they carry raw request paths.

What is left is a stable code plus a shape. That is enough to know *which* failure
happened and how often, which is what an error tracker is for.

## Provider errors never propagate verbatim

A provider error routinely contains the request URL and occasionally a credential.
Every adapter maps them to stable codes before anything is logged or returned.

The outbound request guard logs exactly a host and an outcome. Not the URL, not
the body, not the provider's text.

Health failures return a generic status naming no driver, host or cause — a
readiness probe is reachable from more places than a log is, and it should not
describe the internals to whoever asks. The web readiness endpoint names *which*
check failed, but never the fingerprints being compared.

## Tracing

Metadata-only spans. Model calls carry task context — which task, which backend,
which model, how many tokens — and no prompt or completion.

Correlation runs on the request identifier: accepted from an inbound header when
it matches a strict format, generated otherwise, attached to every declared error
payload, and returned in the response header. That is the identifier a support
conversation is built on.

## The operation ledger

Every durable operation is a row, with a lifecycle, an idempotency key, an actor
and a version. Every execution is an attempt row with its own outcome — including
`ambiguous`.

This is the most useful diagnostic surface in the system and it is worth
understanding as such. "Did this run?", "how many times?", "what happened on
attempt three?", "is it still in flight or did it settle?" are all single queries.
No log correlation required.

## The usage ledger

Every model attempt records the provider's generation identifier, the model, the
backend, token counts, the **authoritative returned cost**, a timestamp and the
task context.

The cost carries its own provenance: billed by the provider, estimated, local, or
unknown. A number without its provenance invites false precision.

A partial unique index on the generation identifier means a later cost correction
**updates** the row rather than adding a second one — so a reconciliation cannot
double-count.

See [`../domain/usage-reporting.md`](../domain/usage-reporting.md).

## The activity trail

Operator-visible events with a vocabulary of eighteen types covering saves,
approvals, schedules, publications, reconciliations, attestations and pauses.

This is the audit trail. It is a product surface, not telemetry, and it lives in
the database where it can be queried alongside the rows it describes.

## Web vitals

Reported only when an error collector is enabled — the reporter returns early
otherwise — as a metric name with its value, delta, rating and navigation type.
No page content, no user data, no identifiers.

## Product analytics

**There is none today.** No analytics vendor, module or environment variable
exists in the codebase, and nothing about operator behaviour leaves the
customer's host.

If analytics is ever added, the constraint it has to meet is already fixed: it
must be optional per installation, and limited to explicit events and temporary
release flags. Automatic capture is the specific thing ruled out — it is designed
to collect everything, which is the opposite of how the rest of this system
treats customer content.

## Diagnosing a problem

Roughly in order of usefulness:

1. **The readiness endpoint.** It names which dependency failed, and the worker's
   response breaks readiness down by capability.
2. **The operation ledger.** Query the operation and its attempts. This answers
   most "why didn't this happen" questions outright.
3. **The activity trail**, for anything an operator did or should have seen.
4. **Structured logs**, filtered by event name and request identifier.
5. **A probe.** Deterministic drivers exist for the request guard, each market
   adapter, the editorial pipeline against frozen fixtures, each generation path,
   and the publishing lifecycle. They exercise the real code against real inputs —
   which, without a test framework, is the most direct evidence available. The
   catalogue is in [`../reference/commands.md`](../reference/commands.md).

## Adding instrumentation

- Log an **event name and an allowlisted field**. If you need a new field, widen
  the allowlist deliberately and think about what could end up in it.
- Never log content: no prompts, no article text, no generated copy, no operator
  input, no provider error text.
- Map provider errors to a stable code first.
- For anything an operator needs to *see*, the answer is usually a database row —
  an operation, an attempt, a usage event, an activity event — not a log line.
  Telemetry is for engineers; the ledgers are for the product.
