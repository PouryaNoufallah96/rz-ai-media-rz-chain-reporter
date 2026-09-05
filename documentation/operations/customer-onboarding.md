# Onboarding a customer

Standing up a new installation, end to end. Each customer gets their own server,
database, object storage and credentials.

## Before you start

You need, from the customer:

- Their media brands, with names and editorial identity.
- The sources they want read.
- The accounts they publish to, per brand and per platform.
- Credentials for each of those accounts.
- A hostname and a TLS certificate.

And a decision, for every value: **who owns it?**

| Owner | Example |
|---|---|
| Code | *How* to publish to a platform |
| Customer template | Which brands, which sources, which model runs which task |
| Deployment environment | Every secret |
| Database | The template applied as rows, plus all runtime state |
| Operator interface | Only what changes while the product is running |

Getting this wrong once is how a product like this rots — either into a fork per
customer, or into a configuration screen nobody asked for.

## 1 · Author the customer template

Create `customer-templates/<key>/`. The key is lowercase and hyphenated, and it
must equal `customer.key` inside the template.

The whole field reference is in
[`../domain/customer-template.md`](../domain/customer-template.md). The shape:

```
customer-templates/<key>/
├── template.json
├── brand-bibles/          declared per brand
├── brand-logos/           declared per brand
├── image-profiles/        declared per brand
└── reviewed-knowledge/    optional
```

**Only declared files may exist in that directory.** Anything the template does
not reference is rejected at load time. Add a file *and* the field that declares
it, together.

The fastest way in is to copy an existing template and work through it. Start
with `demo-sports` if the customer is not in the same domain as the others — it
exists precisely to show that nothing in the product code assumes one.

Validate as you go:

```bash
pnpm --filter @rz-chain-reporter/customer-template validate <key>
```

It prints the schema version, the fingerprint and the number of verified
references, and it rejects an undeclared file, a mismatched raster digest, a logo
that would not fit its canvas, and every cross-field rule.

Expect the cross-field rules to catch things. They are the point:

- Every editorial model option needs **all three** routes.
- Every required task must be routed, plus the conditional ones.
- Weights must sum to one. The freshness ladder must increase. Embedding capacity
  must fit.
- Every declared platform needs a drafting policy, and vice versa.
- A brand with an image profile needs a logo, and vice versa.

### Getting the editorial configuration right

This is the part that takes iterations, and it is worth budgeting for.

Media fit thresholds, keyword weights, the value gate, the freshness ladder and
the policy weights decide what publishes. There is no way to know the right
numbers in advance for a new domain.

Start deliberately loose, run against real sources, and read the **filtering
report** — it names, per item and per brand, exactly which threshold was missed.
Then tighten. A brand getting nothing is almost always its fit threshold or its
value gate.

## 2 · Provision the host

- A server sized for PostgreSQL, object storage, the web application and the
  worker, above the configured memory floor.
- A hostname resolving to the server's address. The deploy script checks this.
- TLS certificate and key at known paths.
- Docker with Compose.

## 3 · Write the instance configuration

Copy an example from `deploy/instance-examples/` or
`deploy/production.env.example`.

It carries public identity and paths only — never credentials: the project name,
an **immutable** version tag, the template key, the image prefix, the application
root and user, the environment directory, the hostname and address, four distinct
loopback ports, the TLS paths, the proxy site paths and the memory floor.

`APP_VERSION` may not be `dev`, `latest`, empty, or contain a placeholder marker.

## 4 · Create the environment files

Seven files in the environment directory, all mode `600`. Copy from
`deploy/env-examples/` and fill them in.

The full reference is
[`environment-variables.md`](environment-variables.md). The properties the deploy
script will check:

- **Identity separation** — the migration file has the migration connection string
  and *not* the runtime one; the runtime files have the reverse.
- **Role separation** — three distinct database roles, and each connection string
  uses the right one.
- **Cross-file agreement** — the object-storage values, the cache-invalidation
  secret, the durable signing key and the model provider key must be *identical*
  where they appear more than once.
- **Forbidden keys** — the development durable flag, the error-upload token and the
  on-host model URL each have files they may not appear in.
- **No leftover placeholders.**

### Binding destination credentials

Each destination account's stable key becomes an environment variable prefix: the
key with hyphens replaced by underscores, upper-cased.

| Platform | Per account | Deployment-wide |
|---|---|---|
| Telegram | `DEST_<PREFIX>_BOT_TOKEN` | — |
| X | `DEST_<PREFIX>_ACCESS_TOKEN`, `DEST_<PREFIX>_ACCESS_TOKEN_SECRET` | `X_API_KEY`, `X_API_SECRET` |
| Instagram | — | `META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN` |

Non-secret values — a Telegram channel, an Instagram account identifier — belong to
the **template**, not the environment.

> Instagram's deployment-wide token ships commented out in the starter worker
> environment. Uncomment it if the installation has an Instagram destination —
> one value covers every Instagram account.

Verify before deploying:

```bash
pnpm bindings:preflight
```

It is database-free, so it runs before anything else exists. It names the missing
credential *category*, never the variable — safe to paste into an issue.

## 5 · Check, then deploy

```bash
./deploy.sh check <config>     # validates everything, changes nothing
./deploy.sh deploy <config>    # builds and releases
```

`check` runs every static assertion and reports the host checks it *would* run.
Run it until it is clean before deploying.

The deploy sequence is in [`deployment.md`](deployment.md). What it does, in
short: assertions, build, image verification, binding preflight, host
preparation, install the proxy site, stop the writers, start the data services,
migrate, reconcile the template, record the binding projection, run the worker's
startup gate, start the writers, wait for both readiness endpoints, record the
release.

If anything from starting the data services through the startup gate fails, the
previously running writers are restarted and the deploy fails. A failed deploy
leaves the old version serving.

## 6 · Create the first operator account

```bash
compose run --rm admin      # with OPERATOR_EMAIL and OPERATOR_NAME set
```

Interactive only. It prompts for the password and refuses to run without a
terminal — arguments and environment variables both persist in shell history and
in the process list.

No script ever invokes this automatically. It is a deliberate human step.

## 7 · Verify

- Both readiness endpoints return ready.
- Sign in.
- **Installation** shows the brands, sources and destinations you configured.
- Start an import. Watch the source ledger for per-source outcomes.
- Start a run. Read the filtering report.
- Generate copy and an image on one card.
- Publish one post to one destination, and confirm it arrived.

That last step is the one that matters, and it is the one people skip. It is the
only thing that proves the credentials, the destination mapping, the media path
and the reconciliation all work together.

## Changing configuration later

```bash
# 1. Edit the template
# 2. Validate
pnpm --filter @rz-chain-reporter/customer-template validate <key>
# 3. See what would change
pnpm template:reconcile --check
# 4. Apply
pnpm template:reconcile
# 5. Rebuild and redeploy
```

Step 5 is the one people forget. **The template is embedded in the image.**
Editing the file on a host changes nothing until the artifact is rebuilt — and a
running process whose fingerprint no longer matches the database will report
itself unready.

Only one change is refused rather than applied: changing an existing destination
account's platform. Everything else is applied, and retiring is a soft delete that
a later re-enable restores.

## A second installation on the same host

Supported. Each installation owns its own project, application root, image prefix,
template key, loopback ports, TLS paths, environment directory, volumes, backups
and release pointer.

The deploy script enforces the separation: no fixed container names, distinct
proxy rate-limit zones derived from the project name, and four distinct loopback
ports per installation.

Two installations on *different* hosts may use identical loopback ports, since
nothing is published beyond loopback.
