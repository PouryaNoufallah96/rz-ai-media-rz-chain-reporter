# Local development

From a fresh clone to a working desk.

## Prerequisites

| | Where the version comes from |
|---|---|
| Node.js | `.node-version`, enforced by the root `package.json` `engines` block. Use a version manager and it will read the file for you. |
| pnpm | the `packageManager` field in the root `package.json`. `corepack enable` will do it. |
| Docker | any recent release with Compose v2 — the database and object storage run in containers |

## Setup

```bash
pnpm install --frozen-lockfile

cp .env.example .env                        # set POSTGRES_PASSWORD
cp .env.migration.example .env.migration    # set MIGRATION_DATABASE_URL
cp apps/web/.env.example apps/web/.env
cp apps/worker/.env.example apps/worker/.env
```

The example files carry working local defaults for object storage and the
template key. Fill in the passwords and, if you intend to generate anything, a
model provider key.

The database password variable has **no default** and Compose uses the
fail-if-unset form, so the stack refuses to start rather than quietly coming up
with a blank password.

## Start the stack

```bash
pnpm dev:stack
```

That starts the database and object storage, waits for them to be healthy, runs
the bucket initialiser, then starts both applications through Turborepo.

On a machine where the services are already up:

```bash
pnpm dev            # both applications
pnpm dev:web        # web only
```

| Service | Address |
|---|---|
| Operator application | <http://localhost:3001> |
| PostgreSQL | `127.0.0.1:5432` |
| Object storage API | `127.0.0.1:9000` |
| Object storage console | `127.0.0.1:9001` |
| Worker health | `127.0.0.1:3002` |

Every published port binds to loopback. Nothing is exposed to your network.

The worker's dev task starts the local durable-execution server alongside it, and
watches `customer-templates/` as well as its own source — so editing a template
restarts the worker with the new configuration.

## First run: apply a template

**The first startup will fail**, and the message will say `NOT_PROVISIONED`.

That is correct behaviour, not a bug. No startup path ever seeds the database, so
until a customer template has been applied there is no installation for the
process to serve. Apply one:

```bash
pnpm db:migrate                    # if the migrate container has not already run
pnpm template:reconcile            # apply the template named by CUSTOMER_TEMPLATE_KEY
```

Then create an account. There is no signup screen:

```bash
pnpm --filter web operator:create
```

It prompts for the password interactively and refuses to run without a terminal —
passwords are never read from arguments or environment variables, because both
persist in shell history and in the process list.

Sign in at <http://localhost:3001>.

## Switching customers

`CUSTOMER_TEMPLATE_KEY` selects the installation. Changing it means changing the
data too:

```bash
# in .env, apps/web/.env and apps/worker/.env
CUSTOMER_TEMPLATE_KEY=rzwire
```

Then reconcile again. If the database still holds the previous customer's
installation row, startup fails with `INSTALLATION_KEY_MISMATCH` — the identity
gate is doing its job. On a local database you are willing to lose, the simplest
fix is to drop the volume and start over:

```bash
pnpm docker:down
docker volume rm rz-chain-reporter_rz-chain-reporter_postgres_data
pnpm dev:stack
```

Confirm you are pointed at the local database before running that.

The three available keys are `chainreporter`, `rzwire` and `demo-sports`. The
last is a synthetic sports desk that exercises Instagram publishing and proves the
product code carries no crypto assumptions.

## Verifying a change

```bash
pnpm validate
```

Lint and format, types, message catalogs, the API snapshot and the React
diagnostic pass — with `--continue=always`, so you see every failure in one run
rather than fixing them one at a time.

Individually:

```bash
pnpm check          # lint and format
pnpm fix            # and write fixes
pnpm check-types    # types
pnpm i18n:check     # both locale catalogs agree, every message parses
pnpm openapi:check  # the API snapshot has not drifted
```

A production build additionally requires the template key, because it validates
and embeds one installation's template:

```bash
CUSTOMER_TEMPLATE_KEY=chainreporter pnpm build
```

Every command in the repository is catalogued in
[`../reference/commands.md`](../reference/commands.md).

## Database work

```bash
pnpm db:studio                     # browse the schema
pnpm db:generate                   # after a schema change
pnpm db:migrate                    # apply reviewed migrations
```

`pnpm db:push` exists and is fine on a scratch local database, but it applies the
schema with no migration and no history — read
[`database-migrations.md`](database-migrations.md) before using it, and never
point it at anything with data you cannot recreate.

## Container lifecycle

```bash
pnpm db:start / db:stop / db:down  # database only
pnpm docker:up                     # build and start everything
pnpm docker:down
pnpm docker:logs
```

The worker sits behind a Compose profile in the local file, so `docker:up` does
not start it unless you ask for that profile. In development the worker usually
runs on the host, where restarts are faster.

## What differs from production

Worth knowing so a local success is not read as more than it is.

| | Local | Production |
|---|---|---|
| Database identities | One superuser for everything | Three roles: bootstrap, migration, application |
| Reverse proxy | None | TLS, rate limits, path restrictions |
| Template reconcile | Manual | Part of the deploy sequence |
| Durable execution | Local development server | Cloud mode |
| Object storage access | Anonymous access as configured | Anonymous access explicitly removed |
| Version | `dev` | An immutable tag; `dev` is refused |

The role split is the one most likely to hide a bug: locally, migrations and the
application run as the same superuser, so a query needing a privilege the
application role does not have will pass locally and fail in production. The
example environment files model the split by name, but nothing creates those
roles on a local machine.

## Common problems

**`NOT_PROVISIONED` on first start.** Expected. Run the template reconcile.

**`TEMPLATE_NOT_APPLIED`.** You edited the template. Reconcile again — the
fingerprint changed.

**`INSTALLATION_KEY_MISMATCH`.** The database holds a different customer than the
one you are running. Either switch back, or reset the local volume.

**`UNBOUND_SERVICE`.** Something is missing from the environment: the object
storage set, the durable keys, or a model backend. Prestart exits with code 2 and
names the category.

**The worker starts but nothing happens.** Check that the local durable-execution
server is running — the worker's dev task starts it, but only if that task is the
one you ran.

**Generation fails immediately.** The model provider key is probably unset. It is
required, not optional.

## Where to go next

- [`../reference/conventions.md`](../reference/conventions.md) — the boundaries
  `pnpm check` enforces, and why each exists
- [`../architecture/README.md`](../architecture/README.md) — how the pieces fit
- [`../domain/README.md`](../domain/README.md) — what the product actually does
