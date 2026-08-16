# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Day-one primary operators are the owner's internal editorial team, running the four media
brands in long desk sessions — power users who value density and speed. The tenancy model
(workspaces, roles: owner/admin/editor/publisher/viewer) is built so external SaaS
customers — third-party social-media teams, roughly 200–500 active users — onboard in
later phases without a redesign. Desktop-primary, mobile-capable: editorial runs,
drafting, and scheduling happen at a desk; mobile (360px minimum, full touch parity) must
handle review, approval, and status checks well, but layouts optimize desktop density
first. Confirmed by owner 2026-08-16.

## Product Purpose

ChainReporter is a multi-brand editorial workspace that discovers source material (RSS,
public Telegram), evaluates its relevance with editorial AI models, turns it into
brand-specific social content (X, Telegram, Instagram), and manages that content through
approval, scheduling, and publishing. Success is a small team reliably producing on-brand,
compliant social output across four distinct media brands with visible operation state,
honest failure reporting, and auditable cost.

## Positioning

Brand-governed AI editorial: every generation is constrained by a versioned per-brand
policy (Brand Bible, Image Profile) across four editorial identities — RZ Prime, Coin
Hall, ChainReporter, Meta Coin Guard — with provenance, cost accounting, and explicit
ambiguous-outcome handling (`delivery_unknown`) that generic AI-posting tools do not
carry. Bilingual English/Persian operator UI with per-locale text direction, while
content carries its own separate content locale.

## Operating Context

Operators configure a News Run or Promo Run, watch progressive model lanes fill, inspect
filtering reports, route cards to platforms, edit copy variants, generate images, then
save/approve/schedule/publish. Long-running provider work is durable and survives
refresh; operators return to check operation state. External destinations: X, Telegram,
Instagram (manual), Google Sheets/Drive projections. Terminology is canonical in
`CONTEXT.md` at the repo root (Workspace, Media Brand, News Run, Card, Lane, Operation,
Attempt, Reservation, `delivery_unknown`, …).

## Capabilities and Constraints

- Stack (locked elsewhere; not re-decidable in design): Next.js 16.3 App Router, React
  19.2, Cache Components/PPR + Partial Prefetching + React Compiler always on, Tailwind 4,
  owned shadcn source + Base UI in `packages/ui`, RHF 7 + Zod 4 forms, TanStack Table 9
  grids, oRPC contracts, Better Auth.
- Bilingual `en`/`fa` with per-locale direction (ADR 0001): the prerendered static shell
  is never traded for a translation; UI locale and content locale are separate fields.
- The prerendered static shell is a hard constraint on every surface: private data lives
  in Suspense holes; `<html lang dir>` renders outside Suspense.
- Phase roadmap: docs/researches/21 — Phase 1 owns only the platform shell and global
  state language; feature surfaces (lanes, drafts, scheduling) arrive in Phases 5–9.
- No testing frameworks; verification is type/static checks, runtime diagnostics, and
  manual evidence.
- Undecided product facts live in research 21's future-grill list (brand-policy
  hierarchy, cross-brand retarget, Sheets role, approval semantics, …); design must not
  silently decide them.

## Brand Commitments

No binding ChainReporter product identity exists yet — no committed logo, palette, or
wordmark; the design phase may propose the app's visual identity fresh (confirmed by
owner 2026-08-16). The four media brands keep their own identities inside the content
and are never restyled by the app. Product name: ChainReporter (working name `RZ
ChainReporter` in tracker systems).

## Evidence on Hand

- Canonical domain glossary: `CONTEXT.md` (repo root).
- Legacy behavior evidence: docs/researches/01–07 at a pinned legacy checkout; the legacy
  UI is evidence and anti-reference, not carried identity.
- Approved Phase 1 plan: docs/plans/platform-foundation/PLAN.md (+ review log).
- Existing scaffold UI: `[locale]` shell, header, auth panel, dashboard placeholder,
  owned primitives in `packages/ui/src/components`, semantic tokens in
  `packages/ui/src/styles/globals.css`.
- No real testimonials, customer logos, or usage metrics exist yet — never fabricate any.

## Product Principles

1. Operation truth over optimism: queued/running/retrying/unknown states are first-class
   UI; a lost provider response is shown as ambiguous, never as success or silent retry.
2. Brand governance is visible: which brand policy and revision produced an artifact is
   inspectable, not implied.
3. Density with legibility: professional operators get information-dense desktop layouts
   whose hierarchy survives 360px and RTL.
4. Bilingual parity: Persian is a first-class operator language, not a translated
   afterthought; every state reads correctly in both directions.
5. Cost and quota are product surfaces: operators see allowance, reservation, and why an
   action was denied, in product units.

## Accessibility & Inclusion

WCAG 2.2 AA committed (owner decision 2026-08-16): keyboard operability, visible focus,
live regions for async state, `prefers-reduced-motion` honored, 4.5:1 text contrast,
touch-target sizes, dragging alternatives when lanes arrive. Baseline browsers: current
and previous major of Chrome/Edge/Firefox/Safari, floor never below Tailwind 4's.
