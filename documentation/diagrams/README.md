# Diagrams

Two kinds live in this documentation set, and they have different jobs.

## Inline Mermaid — canonical

Most diagrams are Mermaid, written directly into the page that explains them.
They render on the source host, diff cleanly in review, and cannot drift from
their surrounding prose because they sit in the same file.

| Diagram | Page |
|---|---|
| System context, with every external dependency | [`../architecture/system-context.md`](../architecture/system-context.md) |
| Containers and the work-handoff sequence | [`../architecture/containers.md`](../architecture/containers.md) |
| The three cache-refresh paths, and a generation end to end | [`../architecture/caching-and-realtime.md`](../architecture/caching-and-realtime.md) |
| Worker startup and readiness | [`../architecture/worker-application.md`](../architecture/worker-application.md) |
| The editorial lifecycle, end to end | [`../domain/README.md`](../domain/README.md) |
| Source import, and the article fetch decision | [`../domain/source-ingestion.md`](../domain/source-ingestion.md) |
| The two filtering phases | [`../domain/editorial-pipeline.md`](../domain/editorial-pipeline.md) |
| The model gateway, and image generation stages | [`../domain/content-generation.md`](../domain/content-generation.md) |
| The Instagram container workflow | [`../domain/publishing.md`](../domain/publishing.md) |
| The six market stages | [`../domain/market-analysis.md`](../domain/market-analysis.md) |
| Aggregates and their relationships | [`../domain/data-model.md`](../domain/data-model.md) |
| Template loading, and the customer-template flow | [`../domain/customer-template.md`](../domain/customer-template.md) |
| The deploy sequence, and the identity chain | [`../operations/deployment.md`](../operations/deployment.md) |
| Migration ordering | [`../operations/database-migrations.md`](../operations/database-migrations.md) |
| The startup order that matters | [`../operations/README.md`](../operations/README.md) |

## Standalone HTML — for presenting

One explorable artifact, for the times a static picture is not enough: a review
session, an onboarding walkthrough, a conversation with someone who does not read
the repository.

| File | Contents |
|---|---|
| [`system-overview.html`](system-overview.html) | The whole system on one canvas, with three guided views — the request path, durable work, and the outside world |

It opens in a browser with no build step and no network access: pan and zoom,
search, click a component to trace its relationships, step through the guided
views, switch light and dark, and export.

Its source is [`system-overview.architecture.json`](system-overview.architecture.json) —
a small typed specification. **Edit the JSON, never the HTML**, and regenerate.

The specification is deliberately narrower than the Mermaid set: eleven components
and the relationships between them. Optional capabilities and per-pipeline detail
belong on the pages that own them, not on an overview that has to stay readable at
a glance.

## Keeping them true

A diagram is a claim about the system, and a wrong one is worse than none.

- Update the diagram in the same commit as the change it draws.
- **Render it before you commit it.** A Mermaid diagram that does not parse
  shows as a red error box on the source host, and one that parses but lays out
  badly is worse — it looks deliberate. Extract the fenced block and run it
  through the Mermaid CLI:

  ```bash
  pnpm dlx @mermaid-js/mermaid-cli -i diagram.mmd -o diagram.png -b white
  ```

  Then look at the picture. Every diagram in this set has been through that.
- **Prefer `flowchart` and `sequenceDiagram`.** They have real automatic layout
  and are supported everywhere Mermaid is. Mermaid's C4 diagram types place
  elements in declaration order with no layout pass, which produces overlapping
  boxes and overflowing labels as soon as a diagram has more than a handful of
  nodes — a `flowchart` with `subgraph` boundaries expresses the same containment
  and actually renders.
- Prefer editing an inline Mermaid diagram — it is right next to the prose that
  has to agree with it.
- After changing the standalone specification, regenerate the HTML and commit
  both.
- Do not add a fourth format of the same picture. Every additional copy is another
  thing to keep in sync, and the one that drifts is the one someone shows a
  customer.
