# Glossary

The vocabulary used in this documentation is the same vocabulary used in table
names, type names and screen labels. Where a term has a precise meaning, using a
near-synonym instead is how two people end up building different things.

## Installation and configuration

**Installation** — one deployment serving one customer. Its own host, database,
object storage and credentials. Represented in the database by exactly one
workspace row.

**Workspace** — the database representation of the installation. `workspace_id`
sits on every customer-owned row. It identifies the installation; it is not a
security boundary between customers, because there is only ever one.

**Customer template** — the reviewed, version-controlled directory that holds
everything differing between customers. Selected at build time by
`CUSTOMER_TEMPLATE_KEY`. See [`../domain/customer-template.md`](../domain/customer-template.md).

**Template fingerprint** — a hash of the applied template, stored on the
workspace row. The readiness check compares the running process's loaded template
against it, so a deployment that is serving one template while the database holds
another reports itself unready rather than behaving inconsistently.

**Stable key** — a human-readable identifier on a template entity (a brand, a
source, a destination account) that survives edits to the entity's name. It is
what deployment environment variables and database rows both refer to.

**Operator** — a person who uses the product. The only kind of user account.
Accounts are provisioned from the command line; there is no signup.

## Publishing identity

**Media brand** — a publishing identity within the installation: its own
editorial voice, image style and set of destination accounts. A customer runs
several.

**Destination account** — a named account on a platform, such as one brand's
Telegram channel. It carries a stable key; the deployment environment binds that
key to the actual credential. Whether the binding is present is projected onto
the row so an unbound account is visible before anyone tries to publish.

**Platform** — a capability in code: Telegram, X, or Instagram. Adding a platform
is a code change; adding an account on an existing platform is configuration.

**Brand destination** — the many-to-many mapping between a media brand and the
destination accounts it publishes to.

## Ingestion

**Source** — a configured place to fetch items from. Two kinds today: an RSS or
Atom feed, and a public Telegram channel.

**Source import** — one acquisition run across the configured sources. At most
one may be in flight per installation, enforced by a partial unique index rather
than by application logic.

**Source item** — the identity of one fetched item, keyed by its source and
external identifier. Its content is stored as revisions, so a refetch that
changed nothing is a no-op rather than a new row.

**Enrichment** — fetching and extracting the body of an article page behind a
feed item. Optional per source, and it records which adapter produced the result.

**Admission** — whether a fetched item entered the import, and if not, why:
outside the time window, undated, wrong language, or past the per-source cap.

## Editorial

**Analysis run** — one editorial pass over an import's items. Either a *news* run
or a *promo* run.

**Eligibility** — an item's standing within a run: a candidate, out of the window,
undated, or a duplicate.

**Duplicate detection** — by canonical URL, by title, or semantically. The method
is recorded.

**Semantic stage** — the embedding pass that supports semantic ranking. It can
succeed, be skipped, or *degrade* — and when it degrades, the reason is recorded
rather than the run failing.

**Disposition** — the outcome of brand filtering for an item: shortlisted, routed
to a lane, no media fit, below the score threshold, or past the cap.

**Shortlist** and **selection caps** — configured limits on how many items reach
review and how many are selected.

**Filtering report** — the operator-facing explanation of a run: what came in,
what was dropped, and under which reason.

## Drafting

**Platform draft** — a selected story routed to one platform's lane, where copy
and imagery are produced and reviewed.

**Copy variant** — one generated version of the post text for a platform.
Platform-specific length limits are applied when the payload is assembled.

**Draft revision** — an operator-edited version of a draft's content. Revisions
are commands with kinds — apply a copy variant, submit content, adopt or remove
an image, select a revision — so an edit history is queryable rather than a diff.

**Image brief** — the normalised creative instruction an image is generated from,
derived from an image profile and the story.

**Image profile** — the per-brand, template-owned document that describes how that
brand's imagery should look and what output size it uses.

**Branded final** — the composed output: the generated image resized to the
profile's output format with the brand's logo composited in.

**Card** — the operator-facing unit of work on the board: a story with its
drafts, copy and imagery.

**Card sheet** — the overlay for editing one card in place.

## Durable execution

**Operation** — the unit of durable work. Carries a lifecycle
(`queued`, `running`, `settling`, then `succeeded`, `failed`, `cancelled` or
`unknown`), an idempotency key, and its attempts.

**Attempt** — one execution of an operation, with its own outcome: succeeded,
retryable failure, terminal failure, or **ambiguous**.

**Ambiguous** — the system performed an effect and does not know whether it took.
A first-class outcome, not an error. It routes to reconciliation.

**Outbox** — the table where an intent and its work item are written in the same
transaction as the state change that caused them, so the two cannot diverge.

**Relay** — the worker component that claims outbox rows under a lease and
dispatches them.

## Publishing

**Publication** — the record of sending a draft to a destination account.

**Publication lifecycle** — `available`, `reserved`, `effect_claimed`,
`delivery_unknown`, `confirmed`.

**Effect claim** — the marker that a provider call is about to happen or has
happened, taken so that a retry cannot produce a second post.

**Checkpoint** — a provider-side partial effect recorded before confirmation: a
Telegram message, an uploaded X media object, an Instagram container. It is what
makes a resumed publish resume rather than restart.

**Schedule** — a publication planned for a future time. It can be cancelled,
rescheduled, or found *missed* and require operator confirmation.

**Reconciliation** — resolving an ambiguous publication into delivered or not
delivered, on the authority of either provider evidence or an operator's
attestation.

**Attestation** — an operator asserting what actually happened, where the provider
cannot tell us.

## Market analysis

**Instrument** — a controlled tradeable asset the template declares, with its
per-provider mappings.

**Comparison** — a live market symbol charted alongside the primaries.

**Snapshot** — one verified fetch of price series, recorded as verified, partial,
or unverified.

**Period** and **scale** — the chart's time window and whether series are plotted
relative or absolute.

**Output format** — portrait, square, story, or landscape.

## Localization

**Interface locale** — the language the operator is reading the application in.
It is a route parameter.

**Content locale** — the language a generated artifact is written in. A separate
field on the artifact.

**Presentation localization** — a translated bundle of a card's display text.
Immutable, stored only on success, and complete or absent — never partial.

**Copy variant localization** — the same idea for a copy variant: one immutable
complete child per base variant and target locale.

## Infrastructure

**Model gateway** — the application-owned component every model call goes
through. Feature code names a task; the gateway resolves the backend and model
from the template.

**Backend** — where a model call is executed: the remote provider, or an on-host
model runtime.

**Task** — a named model job in the template, such as copy generation for a
particular model family or image template selection. The unit at which backend
and model are configured.

**Media asset** — a row owning an object in storage, with its lifecycle:
`pending`, `uploaded`, `validating`, `verified`, `rejected`, `expired`.

**Cache tag** — an invalidation group scoped to the installation. A tag is never
a visibility channel; isolation lives in the cache key and the SQL predicate.

**Probe** — a deterministic command-line driver for one pipeline or boundary,
used to prove behaviour in the absence of a test framework.
