# Code conventions

Most of what follows is enforced by `biome.json` rather than by review. Where a
rule is machine-checked, the check is named.

## Formatting and linting

One tool, `biome`, does both. It covers `apps/**`, `packages/**` and the root
configuration files; `node_modules`, `.next`, `dist` and `.turbo` are excluded.

- Two-space indentation, double-quoted strings in JavaScript and TypeScript.
- Imports are sorted automatically by the organize-imports assist.
- Tailwind class lists are sorted automatically, including inside `clsx`, `cva`
  and `cn` calls.
- The recommended rule preset, plus a stricter `style` group: no parameter
  reassignment, `as const` where it applies, default parameters last, initialised
  enum members, self-closing elements, one declarator per `var`, no useless
  template literals, the `Number` namespace over globals, no inferrable type
  annotations, and no `else` after a `return`.
- `useExhaustiveDependencies` is informational by default and a warning inside
  `apps/web` and `packages/ui`. It is never an error, because the React compiler
  changes when a dependency array actually matters.

Run `pnpm check` to verify and `pnpm fix` to apply.

## Import boundaries

The architecture is expressed as restricted-import rules, so a boundary violation
fails `pnpm check` instead of surviving until someone notices it in review. Each
rule prevents a specific, named failure.

### A feature's `actions/` and `db/` are private

No file under `apps/web/src` may import `@/features/*/actions/**` or
`@/features/*/db/**` from outside the owning feature. Within a feature, import
relatively; across features, go through `api/server/`, `schemas/` or `lib/`.

Importing another feature's `actions/` couples two cache-invalidation graphs, so
the blast radius of a mutation stops being readable. Importing another feature's
`db/` bypasses that feature's authorization checks and its cache tagging.

### A feature's `components/` are private

Components are private to their own feature and its routes. Shared user-interface
code belongs in `apps/web/src/components`; shared primitives belong in
`packages/ui`.

A small number of cross-feature compositions are genuinely required, and each one
is allowed by an explicit exception naming exactly the one component it may
import. Nothing is granted a blanket exemption:

| This file | may import only |
|---|---|
| `features/editorial/components/card-sheet.tsx` | the publishing ticket |
| `features/market-analysis/components/market-analysis-report.tsx` | the publishing freshness island |
| `features/market-analysis/components/report-publishing.tsx` | the editorial card sheet |
| `features/market-analysis/components/draft-workspace.tsx` | the editorial copy-variant editor and the publishing ticket |
| `features/account/components/**` | the card sheet, the market-analysis and publishing freshness islands, and the scheduled-publication actions |

Adding a cross-feature edge therefore means editing `biome.json` — which makes
the edge visible in the diff and forces a decision about whether the component
should have been shared instead.

### `features/shared` imports nothing

It is a hub with no leaves. It may not import any other feature. That is what
keeps it usable from everywhere without creating a cycle.

### A feature's `lib/` may not import `next`

Framework cache helpers live at the `features/shared` root, not inside a
feature's helpers. This keeps `lib/` modules plain functions that can be reasoned
about — and probed — without a framework request context.

### `server/rpc` may not import components

The router may reach into a feature's `schemas/`, `db/` and `lib/`. It may never
import a component, from a feature or from the shared component directory.

### `packages/ui` may not import `next` or `next-intl`

Every string and the text direction arrive as props. A primitive that read the
locale itself could not be rendered in a different direction on the same page,
and could not be used outside the Next.js application at all.

## Naming and file layout

- No `index.ts` barrel files under `apps/web/src/features`. A barrel defeats
  tree-shaking and hides exactly the cross-feature edge the import rules are
  meant to make visible.
- No `constants/` or `types/` directories inside a feature. A feature has a
  single `constants.ts`; types live next to what they describe.
- Cached reads are named `api/server/get-*.ts`.
- Feature message catalogs live at `features/<name>/messages/<locale>.json`.
  `pnpm i18n:check` verifies both locales carry identical keys.

## Comments

Comments are the exception, not the default. Code should read as its own
explanation; a comment earns its place when it records *why* something is done a
non-obvious way — a provider quirk, an ordering constraint, a deliberate
deviation. Narration of what the next line does, section banners and restated
type signatures are noise and are removed.

## Server-only boundaries

- Modules in `apps/web` that must never reach the browser import `server-only`.
- Packages the worker imports must **not** import `server-only` and must not
  depend on `next`. `packages/db` and `packages/env` instead ship a browser stub
  through the `"browser"` export condition, so an accidental browser import fails
  clearly rather than bundling a database driver.

## Types

Types flow from the database schema through Zod contracts to the oRPC surface and
on to the browser. Where the stack can derive a type, it derives it: there are no
hand-written data-transfer objects mirroring a table, no parallel schemas for the
same shape, and no broad casts at a transport boundary. When you find yourself
writing a second definition of a shape that already exists, the fix is almost
always to export the first one.
