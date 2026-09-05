# `@rz-chain-reporter/contracts`

The shared vocabulary. Every closed value set, every wire schema, and the shapes
that cross a boundary between the web application, the worker and the database.

Framework-free — Zod and the locale facts only. That is what lets the worker, the
database package and the browser all import it.

## Subpath exports

| Subpath | Contains |
|---|---|
| `.` | The common surface |
| `./operation` | Operation lifecycles and the guards over them |
| `./error` | Error codes, including every publication failure code |
| `./events` | Durable event names and payload schemas |
| `./cache` | The cache-tag builder, the entity union and the invalidation wire contract |
| `./editorial` | Platform copy limits, copy assembly and the publish-payload assembler |
| `./publishing` | The publishing command and result contracts |
| `./schedule` | Schedule lifecycles |
| `./platform` | The platform capability set |
| `./source` | Source origins and content locales |
| `./media` | Media lifecycles and size budgets |
| `./usage` | Usage kinds, statuses and cost authorities |
| `./list` | Cross-entity list, ok, id and reorder shapes |
| `./realtime` | Channel and topic definitions — pure Zod, browser-safe |
| `./realtime-channels` | The same, bound to the durable-execution SDK |

## Two things worth knowing

**`realtime` and `realtime-channels` are deliberately split**, and the second is
**not** re-exported from the index. Binding the wire schemas to the durable SDK
must not follow a browser import of the message schemas — a browser needs the
shapes, not the SDK.

**Copy assembly lives here, not in a feature.** Platform copy length, `assembleCopy`
and the single `assemblePublishPayload` are exported from `editorial.ts`. The
publishing ticket in the interface and all three platform adapters import the same
assembler, so what an operator previews is exactly what gets sent.

## Closed sets

Enums are declared here and consumed as PostgreSQL enum types by
`packages/db/src/schema/enums.ts`. The TypeScript union and the database type are
built from the same constant, so they cannot drift.

The content locale set is itself re-exported from `packages/i18n`, so the interface
locale and the content locale share one closed set by construction.

## Cache tags

`workspaceCacheTag(workspaceId, entity)` over a closed entity union. There is no
global tag.

A tag is an **invalidation group scoped to the installation, never a visibility
channel**. Isolation lives in the cache key and the SQL predicate — see
[`../../documentation/architecture/caching-and-realtime.md`](../../documentation/architecture/caching-and-realtime.md).

## Adding to it

A value set belongs here when more than one app or package needs to agree on it.
A shape belongs here when it crosses a process boundary.

Anything used by exactly one feature belongs in that feature.
