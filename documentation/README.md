# ChainReporter documentation

Everything a developer, an operator or someone new to the team needs to
understand and run this system. The codebase is the implementation truth; this
set explains what it does, why it is shaped that way, and how to work on it
without breaking something you could not see.

## Start here

New to the project? Read these three, in order — about thirty minutes.

1. [**What ChainReporter is**](overview/product.md) — the product, the
   per-customer deployment model, and what an operator actually does
2. [**Repository layout**](overview/repository-layout.md) — where everything lives
   and why the boundaries are where they are
3. [**System context**](architecture/system-context.md) — the system and
   everything it talks to, on one page

Then pick the track that matches your work.

| You are… | Read |
|---|---|
| Adding a feature to the operator interface | [Web application](architecture/web-application.md) → [Caching and realtime](architecture/caching-and-realtime.md) → [Conventions](reference/conventions.md) |
| Working on a pipeline or a provider | [Worker application](architecture/worker-application.md) → the relevant page under [`domain/`](domain/README.md) |
| Touching the database | [Data model](domain/data-model.md) → [Migrations](operations/database-migrations.md) |
| Deploying or operating an installation | [Deployment](operations/deployment.md) → [Environment variables](operations/environment-variables.md) → [Runbooks](operations/runbooks.md) |
| Onboarding a new customer | [Customer template](domain/customer-template.md) → [Customer onboarding](operations/customer-onboarding.md) |
| Calling the API | [API reference](reference/api.md) |

## Contents

### Overview

| Page | Covers |
|---|---|
| [Product](overview/product.md) | What the product does, the deployment model, the configured installations |
| [Glossary](overview/glossary.md) | Domain vocabulary, used consistently in code and here |
| [Technology stack](overview/technology-stack.md) | Every pinned version and why it was chosen |
| [Repository layout](overview/repository-layout.md) | The workspace, the boundaries, the dependency direction |

### Architecture

| Page | Covers |
|---|---|
| [Overview](architecture/README.md) | How the architecture pages fit together |
| [System context](architecture/system-context.md) | The system, its users, and every external service |
| [Containers](architecture/containers.md) | The deployable pieces and how they communicate |
| [Web application](architecture/web-application.md) | Routes, feature slices, rendering, server actions |
| [Worker application](architecture/worker-application.md) | Durable functions, ports and adapters, the outbox |
| [Caching and realtime](architecture/caching-and-realtime.md) | Cached reads, invalidation, live updates |
| [Security](architecture/security.md) | Authentication, secrets, outbound request safety, media access |
| [Observability](architecture/observability.md) | Tracing, errors, structured logs, and what is never logged |
| [Key decisions](architecture/key-decisions.md) | The constraints that would be expensive to reverse, and why |

### Domain

| Page | Covers |
|---|---|
| [Overview](domain/README.md) | The editorial lifecycle end to end |
| [Source ingestion](domain/source-ingestion.md) | Fetching sources and articles, safely |
| [Editorial pipeline](domain/editorial-pipeline.md) | Filtering, scoring, selection, the report |
| [Content generation](domain/content-generation.md) | Copy variants, images, the model gateway |
| [Publishing](domain/publishing.md) | Approval, scheduling, provider effects, reconciliation |
| [Market analysis](domain/market-analysis.md) | The optional market capability, its stages and data sources |
| [Localization](domain/localization.md) | Interface locale, content locale, translation |
| [Usage reporting](domain/usage-reporting.md) | What every model call records, and why nothing is enforced |
| [Customer template](domain/customer-template.md) | Every configuration field and what it changes |
| [Data model](domain/data-model.md) | Every table, grouped by aggregate |

### Operations

| Page | Covers |
|---|---|
| [Overview](operations/README.md) | What an operator or DevOps engineer needs first |
| [Local development](operations/local-development.md) | Getting a working machine |
| [Environment variables](operations/environment-variables.md) | Every variable, per surface |
| [Deployment](operations/deployment.md) | Images, Compose, Nginx, startup order |
| [Database migrations](operations/database-migrations.md) | Generating, reviewing and applying schema change |
| [Customer onboarding](operations/customer-onboarding.md) | Standing up a new installation |
| [Runbooks](operations/runbooks.md) | Backup, restore, rollback, incident response |

### Reference

| Page | Covers |
|---|---|
| [API](reference/api.md) | Every procedure and every route handler |
| [Commands](reference/commands.md) | Every script in the repository |
| [Conventions](reference/conventions.md) | Enforced boundaries, naming, comments, types |

### Diagrams

[`diagrams/`](diagrams/) holds standalone, explorable versions of the main
architecture views. The Mermaid source inline in the architecture pages is
canonical; those files mirror it in a form that is easier to present.

## Keeping this true

[`CONTRIBUTING.md`](CONTRIBUTING.md) states what to update when, what may never
appear in these pages, and the check that enforces it:

```bash
./documentation/.docscan.sh
```
