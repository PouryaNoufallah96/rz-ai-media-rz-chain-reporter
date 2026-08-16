# ChainReporter Editorial Workspace

ChainReporter is a multi-brand editorial workspace that discovers source material, evaluates its relevance, turns it into brand-specific social content, and manages that content through approval, scheduling, and publishing.

## Target tenancy and access

These terms describe the Next.js target. The current Python/React system does not yet enforce this tenancy model.

**Workspace (Tenant)**:
The commercial, security, usage, and data-isolation boundary. Every tenant-owned resource, operation, provider connection, and usage record belongs to exactly one workspace.
_Avoid_: Media Brand, user account, deployment

**Membership**:
The relationship that grants a user access to one workspace and associates the user with role bundles and explicit permissions there.
_Avoid_: Session, global user role, entitlement

**Permission**:
A named authority to perform one class of action on workspace resources. Roles such as owner, admin, editor, publisher, and viewer are bundles of permissions, not authorization truth by themselves.
_Avoid_: Entitlement, feature flag, provider scope

## Brands and guidance

**Media Brand**:
One of the four editorial identities served by the workspace: RZ Prime, Coin Hall, ChainReporter, or Meta Coin Guard. A media brand defines an audience, editorial fit, voice, visual identity, and compliance boundaries.
_Avoid_: Channel, client, publication account

**Brand Bible**:
The authoritative product, audience, tone, and compliance material for a media brand. It governs promotional and brand-sensitive content.
_Avoid_: Image profile, prompt template, brand summary

**Image Profile**:
The authoritative visual-language contract for a media brand, including acceptable compositions, motifs, typography, colors, and prohibited elements.
_Avoid_: Brand Bible, theme, image prompt

**Brand Fit**:
The degree to which a source item belongs to a media brand's editorial identity and audience.
_Avoid_: Platform fit, general relevance

## Source discovery and selection

**Source Item**:
An imported RSS article or public Telegram post that can enter editorial evaluation. It retains attribution and a link to its origin.
_Avoid_: Card, post, publication

**News Run**:
An editorial run that discovers source items, filters and routes them, and asks selected editorial models to choose coverage for selected media brands.
_Avoid_: Promo Run, analysis report

**Promo Run**:
A run that creates brand-led promotional ideas from a user direction and brand guidance without using the news-discovery pipeline.
_Avoid_: News Run, sponsored source item

**Editorial Filter**:
A mechanism that rejects, scores, clusters, and routes source items before editorial selection.
_Avoid_: Editorial Model, platform routing

**Shortlist**:
The bounded set of source items sent to editorial models after filtering.
_Avoid_: Lane, saved items, final selections

**Editorial Model**:
An independently selected AI editor that evaluates a shortlist for the chosen media brands.
_Avoid_: Filter engine, image model, assistant

**Editorial Selection**:
A source item chosen by an editorial model for a media brand, together with its reasoning, scores, and suggested presentation.
_Avoid_: Approval, Routed Card, published post

**Filtering Report**:
The audit record of a news run's discovery, rejection, scoring, routing, and shortlist outcomes.
_Avoid_: Editorial Selection, account activity

## Content workspace

**Card**:
The editable workspace representation of a content idea or source item as it moves toward a social post.
_Avoid_: Source Item, scheduled record, published post

**Source Card**:
A card that preserves an editorial selection or Telegram source item before platform-specific copy is generated.
_Avoid_: Routed Card

**Routed Card**:
A platform-specific copy of a source card prepared for X, Telegram, or Instagram.
_Avoid_: Source Card, cross-brand reassignment

**Model Lane**:
A collection of editorial selections grouped by editorial model and media brand.
_Avoid_: Telegram Lane, Platform Lane

**Telegram Lane**:
A collection of public Telegram source cards grouped by media brand.
_Avoid_: Telegram publishing queue, Model Lane

**Platform Lane**:
A collection of routed cards grouped by media brand and destination platform.
_Avoid_: Model Lane, schedule

**Copy Variant**:
One of several alternative platform-specific treatments of the same routed card, each with its own prose and hashtags. Variants of one routed card share its content locale; a different content locale is a separate artifact, not a variant.
_Avoid_: Duplicate card, Content Locale, Message Catalog

**Locale**:
A supported application language, `en` or `fa`, carried as a root route parameter. It selects the operator's interface language and the interface text direction.
_Avoid_: Content Locale, region, timezone, currency

**Text Direction**:
The writing direction derived from a locale — `ltr` for `en`, `rtl` for `fa`. It is always derived, never stored or selected independently.
_Avoid_: Locale, layout preference, user setting

**Message Catalog**:
The per-feature set of translated interface strings for one locale. It contains interface text only, never article bodies, prompts, generated content, or secrets.
_Avoid_: Content Locale, Brand Bible, Reviewed Knowledge

**Content Locale**:
The language of an admitted source item, a draft revision, or a publish payload. It is workspace data attached to editorial artifacts and supplied explicitly to generation and publishing. It is a **different field** from the operator's Locale — a Persian interface may produce English content and the reverse.
_Avoid_: Locale, Message Catalog, translation

**Legacy Translation (retired)**:
The legacy Python/React mechanism that rewrote reader-facing card content into Persian at runtime through whole-document DOM mutation and a translation route. The bilingual target replaces it with locale-routed interface catalogs and an explicit content locale; the legacy mechanism is not revived.
_Avoid_: Locale, Message Catalog, Content Locale, copy variant

**Image Brief**:
A structured visual concept created for a card within a media brand's image profile and safety constraints.
_Avoid_: Final image, image prompt, Brand Bible

**Platform Draft**:
The stable, workspace-scoped content identity prepared for one media brand and destination platform. It owns a sequence of immutable draft revisions while retaining its identity across edits, generation attempts, and workflow transitions.
_Avoid_: Draft Revision, Routed Card, Saved Card, Scheduled Post

**Draft Revision**:
An immutable version of a platform draft's edited content, inputs, policy, prompt provenance, and media references. User edits create a new revision instead of mutating workflow history.
_Avoid_: Platform Draft identity, Saved Card, operation attempt

**Media Asset**:
The provider-neutral identity and metadata for an uploaded or generated binary and its derivations. Object-storage keys are implementation details of the asset.
_Avoid_: Base64 payload, image URL, Draft Revision

**Upload**:
A direct browser-to-object-storage transfer registered as a pending media asset, then verified, promoted, or cleaned up by server-owned state transitions.
_Avoid_: Media Asset identity, database blob, final publication

## Content lifecycle

**Saved Card**:
A private snapshot retained by a user for later editing, retargeting, approval, or scheduling.
_Avoid_: Approved Card, Scheduled Post, draft lane

**Approval**:
The domain decision to accept one exact draft revision for its next allowed workflow step. Approval does not itself publish content or synchronize an external projection. The current legacy UI sometimes combines these effects; the target records them as separate operations.
_Avoid_: Publishing, projection synchronization, saving, image generation

**Scheduled Post**:
An immutable publishable snapshot queued for a future attempt on X or Telegram.
_Avoid_: Saved Card, Sheet schedule marker

**Publishing**:
The act of sending finalized content to an external social destination. X and Telegram support direct publishing; Instagram remains manual.
_Avoid_: Approval, scheduling, synchronization

**Account Activity**:
A user's recorded approvals, schedules, and publishing outcomes used for dashboard history and statistics.
_Avoid_: Filtering Report, chat history

## Target operations and integrations

**Operation**:
A durable, workspace-scoped command intent and idempotency/correlation root, with an explicit lifecycle independent of any single execution.
_Avoid_: HTTP request, background job attempt, provider response

**Attempt**:
One recorded execution of an operation against a model, worker step, or external provider, including timing, metered usage, outcome classification, and provider result identity when available.
_Avoid_: Operation, automatic retry policy, account activity

**Provider Connection**:
A workspace-scoped relationship to an external account, including provider metadata, status, scopes, credential version, and a reference to encrypted credentials. Plaintext credentials are never part of the domain record.
_Avoid_: Provider client, user session, published destination

**Projection**:
A derived representation of canonical PostgreSQL state in an external system such as Google Sheets or Drive. Projection synchronization and publishing are separately observable effects. The current system may rely on Sheets more directly; the target treats it as a projection unless the product explicitly decides otherwise.
_Avoid_: System of record, Approval, backup

**Entitlement**:
A versioned workspace right to use a capability, assigned independently of feature flags and request-rate protection.
_Avoid_: Permission, Allowance, role

**Allowance**:
A granted quantity of a metered resource within a defined bucket and validity period.
_Avoid_: Entitlement, Reservation, concurrency limit

**Reservation**:
A transactional hold against one or more allowances created before costly work is enqueued.
_Avoid_: Settlement, provider estimate, rate limit

**Settlement**:
The final accounting step that consumes, adjusts, or releases a reservation from actual recorded attempts and outcome policy.
_Avoid_: Payment capture, Reservation, analytics event

**Outbox**:
A durable effect record committed in the same database transaction as domain state, then dispatched asynchronously with idempotency and attempt tracking.
_Avoid_: Worker queue as source of truth, activity log, webhook inbox

**Reconciliation**:
A durable process that resolves stale, partial, or ambiguous operations by comparing local intent, attempts, and provider evidence before retrying or finalizing them.
_Avoid_: Blind retry, polling-only UI, manual data correction

**`delivery_unknown`**:
An explicit outcome where an external delivery may have succeeded but the response was lost or inconclusive. It blocks blind retry until reconciliation or an authorized operator decision prevents a likely duplicate.
_Avoid_: Failed, retryable, published

## Assistant knowledge

**Assistant**:
The scoped, read-only helper that answers questions about the workspace, its current card context, and reviewed brand or product knowledge.
_Avoid_: Editorial Model, autonomous operator

**Reviewed Knowledge**:
The approved brand and workspace material from which the assistant may answer.
_Avoid_: Live web data, model knowledge, user-generated chat

**Active Workspace Context**:
The bounded current-card and selected-brand information supplied to the assistant for context-aware answers.
_Avoid_: Full application state, conversation history
