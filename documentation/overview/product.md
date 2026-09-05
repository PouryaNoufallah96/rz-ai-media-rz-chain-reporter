# What ChainReporter is

ChainReporter is an editorial desk. It watches a set of news sources, decides
which stories are worth publishing for a given media brand, writes the posts,
makes the images, and publishes them to that brand's social accounts — with a
human operator in the loop at every point where judgement matters.

The operator's day looks like this:

1. Start a run. The system pulls fresh items from the configured sources.
2. It filters and scores them, and shortlists what fits the brand.
3. For each selected story it drafts platform-specific copy and generates a
   branded image.
4. The operator reviews the drafts on a board, edits what needs editing, and
   approves.
5. Approved content publishes immediately or on a schedule, and the result is
   reconciled against what the platform actually did.

Everything the system produces is a draft until an operator approves it. Nothing
publishes on its own.

## One product, deployed per customer

This is the single most load-bearing fact about the architecture, and almost
every other design decision follows from it.

ChainReporter is **one reusable product that is deployed and configured as a
separate installation per customer**. Each customer gets their own server, their
own database, their own object storage and their own provider credentials. What
differs between customers — their media brands, their sources, their destination
accounts, their models, their editorial thresholds — is configuration, not code.

It is **not** a multi-tenant SaaS. There is no public signup. There is no
customer-entered provider credential. There is no cross-tenant isolation problem,
because a deployment contains exactly one customer's data. There is no billing,
no plan, no quota and no entitlement system.

### What follows from that

- **No signup route exists.** Operator accounts are created from the command line
  when the installation is provisioned.
- **Provider secrets live in the deployment environment**, never in the database.
  There is no credential vault, no stored ciphertext and no key-management
  service, because there is nothing to isolate one customer's key from.
- **`workspace_id` is on every customer-owned row**, but it identifies the
  installation rather than defending a security boundary. Row-level security as
  tenant isolation is not part of the design.
- **Usage tracking is reporting, not enforcement.** Every model call records what
  it cost so an operator can see where the money went. Nothing stops a call
  because a limit was reached, because there is no limit to reach.

## The configured installations

Three template directories exist in `customer-templates/`.

| | `chainreporter` | `rzwire` | `demo-sports` |
|---|---|---|---|
| Product name | RZ ChainReporter | RZWire | Demo Sports Desk |
| Media brands | 4 | 7 | 3 |
| Configured sources | 45 | 45 | 4 |
| Destination accounts | Telegram, X | Telegram, X | Telegram, X, Instagram |
| Brand → account mappings | 8 | 14 | 4 |
| Market Analysis | Disabled | Enabled | Disabled |
| Time zone | Asia/Tehran | Asia/Tehran | UTC |

`chainreporter` and `rzwire` are the two real customer installations.
`demo-sports` is a synthetic template in an unrelated domain, and it exists to
prove the point: nothing in the product code assumes crypto. It carries a sports
desk with three brands and an Instagram destination, and it validates against the
same schema.

Market Analysis — the capability that charts market instruments and produces
market posters — is switched on by the template. When a template disables it, the
navigation entry does not appear, the routes are not reachable, and the template
carries no market configuration at all rather than dummy values.

## Where a value is allowed to live

Every customer-varying value has exactly one owner. Getting this wrong is how a
product like this rots into either a hard-coded fork per customer or a
configuration screen nobody asked for.

| Owner | Holds | Example |
|---|---|---|
| **Code** | Platform capabilities and adapters | *How* to publish to Telegram |
| **Customer template** | What differs between customers, reviewed in version control | Which brands exist, which sources to read, which model runs which task |
| **Deployment environment** | Every secret | The Telegram bot token for this installation |
| **Database** | Entities seeded from the template, plus all runtime state | The brands as rows; every run, draft and publication |
| **Operator interface** | Only what a customer changes while the product is running | Editing a draft, scheduling a post |

Two rules keep the boundary honest. Reusable code never learns one customer's
domain assumptions — the editorial pipeline knows about brands and sources, not
about coins. And those assumptions are never replaced by a runtime configuration
screen either: a table existing is not a reason to build create-read-update-delete
for it.

## Bilingual by construction

The product is English and Persian, with per-locale text direction. Two things
that look similar are deliberately kept apart:

- **Interface locale** — the language the operator is reading the application in.
  It is a route parameter, so `/en/dashboard` and `/fa/dashboard` are different
  URLs and both prerender.
- **Content locale** — the language a generated post is written in. It is a field
  on the editorial artifact, chosen per generation.

An operator working in Persian can produce English copy, and the reverse. The
locale set is fixed product-wide; it is not something a customer template
configures.

## What an operator sees

| Screen | Purpose |
|---|---|
| Dashboard | The editorial workspace: start a run, watch it, work the platform lanes, open a card |
| Sources | The source catalog and the import ledger |
| Saved | Cards kept for later |
| Schedule | The publishing desk — what is queued, what went out, what needs attention |
| Account | The operator's own activity, metrics and scheduled work |
| Usage | What the models cost, by model, provider, task and period |
| Installation | A read-only view of how this deployment is configured |
| Market Analysis | Only when the template enables it |

## Reading further

- [`glossary.md`](glossary.md) — the vocabulary used throughout the codebase
- [`../architecture/README.md`](../architecture/README.md) — how it is built
- [`../domain/README.md`](../domain/README.md) — how each part behaves
- [`../operations/README.md`](../operations/README.md) — running it
