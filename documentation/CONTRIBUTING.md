# Keeping this documentation true

Documentation that drifts is worse than no documentation, because it is believed.
This page states what has to be updated when, and the automated gate that runs
over the result.

## The rule

**A change to the codebase and the documentation change it requires belong in the
same commit.** Not a follow-up commit, not a ticket. If the change is not worth
one line of documentation, it probably did not change anything a reader needs to
know — and if it is, that line is cheapest to write while the change is still in
your head.

## What to update when

| When you change this | Update this |
|---|---|
| Add, rename, or repurpose an app or package | That package's `README.md`, [`overview/repository-layout.md`](overview/repository-layout.md), and the container view in [`architecture/containers.md`](architecture/containers.md) |
| Change a package's public exports | That package's `README.md` |
| Add or change a database table, column or enum | [`domain/data-model.md`](domain/data-model.md), including its diagram |
| Add or change a durable worker function or event | [`architecture/worker-application.md`](architecture/worker-application.md) and the pipeline page under `domain/` that owns it |
| Add or change an oRPC procedure or a route handler | [`reference/api.md`](reference/api.md) |
| Add or change a cached read, cache tag, or invalidation path | [`architecture/caching-and-realtime.md`](architecture/caching-and-realtime.md) |
| Add or rename an environment variable | [`operations/environment-variables.md`](operations/environment-variables.md), and the matching `.env.example` only if a process already reads the variable |
| Add or change a customer-template field | [`domain/customer-template.md`](domain/customer-template.md) |
| Change a provider adapter, its endpoints, or its failure handling | [`domain/publishing.md`](domain/publishing.md) or [`domain/source-ingestion.md`](domain/source-ingestion.md), whichever owns it |
| Change Compose, Nginx, a Dockerfile, or the deployment script | [`operations/deployment.md`](operations/deployment.md) and, if the order changed, its startup-order section |
| Add or change a `package.json` script | [`reference/commands.md`](reference/commands.md) |
| Change an import boundary or a naming convention | [`reference/conventions.md`](reference/conventions.md) |
| Make a decision that would be expensive to reverse | [`architecture/key-decisions.md`](architecture/key-decisions.md) — state it as a fact plus the reasoning, so the next person can tell a deliberate constraint from an accident |

## What must never appear here

This documentation set is public and permanent. It describes the product and the
codebase, and nothing else.

- **Only files another clone will have may be cited.** A path that does not exist,
  or that is git-ignored, cannot be referenced — the gate checks both. Local working notes, personal tooling configuration and
  operator runbooks with host commands are all untracked for good reason, and a
  reference to one is a broken link for every other reader.
- **No secrets, ever.** Variable *names* and placeholder examples are fine. A
  connection string, key, token or hostname belonging to a real installation is
  not, including in an example block.
- **No local environment assumptions.** Write what the repository does, not what
  one machine happens to have installed.
- **No version numbers.** Name the tool and say where its version is declared —
  `.node-version`, the root `package.json`, or the `catalog:` section of
  `pnpm-workspace.yaml`. A version written into prose is wrong the first time
  someone runs an upgrade, and nobody notices until a reader trusts it. Pinning a
  major onto a framework's name also dates the page in a way "the Next.js App
  Router" never does.

  There is **one exception**, and it is the shape of a real exception: a version
  that is itself the fact. Primary keys use PostgreSQL's built-in time-ordered
  UUID function, which arrived in version 18, so 18 is a genuine floor rather
  than a snapshot of what happens to be installed. State a version only when
  you can write a sentence like that one — where the number carries the
  reasoning, not just the current state.

## The gate

`documentation/.docscan.sh` enforces the rules above. It fails on a reference to
a cited path that is missing or git-ignored, a broken relative link, anything
shaped like a credential, and any version number outside the single documented
exception. Loopback addresses
and port numbers are masked before the version check runs, so `127.0.0.1:5432`
is not mistaken for one.

```bash
./documentation/.docscan.sh
```

Run it before you push. It exits non-zero with the offending file and line.

## Style

- Write for a competent engineer who has not seen this repository. Explain *why*,
  not only *what* — a rule without its reason gets deleted by the next person who
  finds it inconvenient.
- Prefer a table or a diagram to a paragraph when the content is structured.
- Diagrams are Mermaid, inline in the markdown, so they render on the source host
  and diff cleanly. **Use `flowchart` and `sequenceDiagram` only.** Mermaid's C4
  diagram types are documented as experimental and place elements in declaration
  order with no layout pass; past a handful of nodes they overprint edge labels
  onto boxes and route edges straight through unrelated ones. A `flowchart` with
  `subgraph` boundaries expresses the same containment and is laid out properly.
- **Render a diagram before committing it**, and look at the picture — a diagram
  that parses can still lay out badly, which is worse than one that fails,
  because it looks deliberate. See [`diagrams/README.md`](diagrams/README.md) for
  the command. The standalone HTML overviews under [`diagrams/`](diagrams/) are
  generated from the same facts; regenerate them when the Mermaid source they
  mirror changes.
- Keep counts out of prose where a reader could instead be pointed at the file
  that holds them. Where a count genuinely helps — "64 tables" tells you
  something "many tables" does not — re-derive it rather than copying it forward.
  Stale counts are the most common form of drift, and the second most common is a
  count that was right when someone wrote it and has been repeated ever since.
