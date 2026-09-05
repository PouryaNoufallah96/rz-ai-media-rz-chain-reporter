# Runbooks

Backup, restore, rollback and the failures you are most likely to meet.

## Backup

```bash
./deploy/backup.sh create <config>
```

Every command requires an explicit instance configuration. There is no default
project, application root or environment directory — a backup command cannot
accidentally target another customer's installation.

What it does, in order:

1. Requires both data services to be running.
2. Creates a timestamped staging directory under the application root, owned by
   root, mode `700`.
3. Records which writers are running, installs an exit trap that will restart
   them, and **stops the writers** so the dump is consistent.
4. Dumps the database in custom format, without ownership, as the migration role.
   A zero-length dump fails the command.
5. Mirrors the object bucket into the staging directory.
6. Writes a release record: project, version, template key, bucket, timestamp.
7. Writes a SHA-256 manifest over every file and **immediately verifies it**.
8. Removes group and other permissions and prints the staging path.
9. The exit trap restarts the writers.

The artifact:

```
<timestamp>/
├── database.dump
├── objects/…
├── release.json
└── manifest.sha256
```

Verifying the manifest at creation time is the important detail. A backup that
was corrupt on write is worthless, and you find that out at the worst possible
moment otherwise.

**Not automated:** scheduling and retention. `create` only ever adds another
timestamped directory. Both belong to host configuration, and both are worth
setting up before you need them.

## Rehearsing a restore

```bash
./deploy/backup.sh rehearse <staging-directory> <config>
```

This proves a backup is restorable **without touching the live installation**.

Before anything starts, it validates that the directory exists, that it contains
a manifest, a release record and a non-empty dump, that the manifest verifies,
and that the release record names *this* project, *this* template key and *this*
bucket. A backup can never be replayed into another customer's installation.

Then, in a throwaway project with its own volumes and an exit trap that destroys
everything:

1. Start disposable data services.
2. Restore the dump.
3. Count the restored tables — zero fails.
4. Mirror the objects in.
5. Compare object **counts**.
6. Mirror them back out and compare sorted checksums — a byte-level comparison,
   not just a count.

It prints how many tables and how many byte-verified objects were restored, then
destroys the rehearsal project.

**Rehearse on a schedule.** An unrehearsed backup is a hypothesis.

## Restoring for real

**There is no `restore` command.** This is stated plainly rather than left to be
discovered during an incident.

The rehearsal path shows the mechanics — stop writers, restore the dump as the
migration role, mirror objects back into the bucket — but pointing them at a live
installation is a deliberate manual act, because it overwrites production data
and because the right sequence depends on what actually went wrong.

Before you do it:

1. **Take a fresh backup of the current state first**, however broken it looks.
   You cannot get back to it otherwise.
2. Rehearse the backup you intend to restore. Do not restore an unverified one.
3. Stop the writers.
4. Restore the database, then the objects. In that order — object metadata and
   lifecycle state live in the database, so restoring objects against an older
   database leaves rows pointing at objects that do not exist yet.
5. Run the template reconcile check before starting anything.
6. Start the writers and confirm both readiness endpoints.

## Rollback

```bash
./deploy.sh rollback <previous-app-version> <config>
```

An **image-level** rollback. It re-points the installation at an older tag,
re-runs the full assertion contract, verifies template identity against the
*current* schema, and records a new release manifest naming the version it rolled
away from.

**No database migration is run or reverted.** Schema is forward-only. That is why
migrations must stay backward compatible with the previously deployed code — see
[`database-migrations.md`](database-migrations.md). If a rollback needs a schema
change undone, that is a data restore, not a rollback.

The target version's images must already be on the host. Check first:

```bash
./deploy.sh check <config>
```

## Health checks

| Endpoint | Meaning |
|---|---|
| Web `GET /api/health` | Liveness. The process answers. Use for a restart probe. |
| Web `GET /api/health/ready` | Database reachable within a bounded time, exactly one installation row, and its template identity matches this process. |
| Worker `GET /health` | Liveness. |
| Worker `GET /health/ready` | The above, plus the object store answers, the durable connection is active, and the outbox relay is accepting. |

Both are reachable on loopback only — the reverse proxy returns `404` for the
health path from the internet.

The worker distinguishes **draining** from **starting**, so a load balancer can
drain a process before it exits rather than seeing it as merely unhealthy.

### Reading a readiness failure

The web readiness endpoint returns a reason. It names the mismatch and never the
fingerprints.

| Reason | Meaning | Fix |
|---|---|---|
| `database-unavailable` | The database did not answer within the probe deadline | Check the database service and connection limits |
| `not-provisioned` | No installation row exists | Run the template reconcile |
| `multiple-installations` | More than one installation row | Serious. Investigate before starting anything — one deployment serves exactly one customer |
| `template-not-applied` | The template applied to the database does not match this process | Run the template reconcile, or confirm the right version is deployed |

The worker's readiness response additionally reports its mode and a capability
breakdown — event dispatch, function execution, model backends, object store —
which is usually enough to identify which dependency is missing without opening a
log.

## Startup failures

Both containers run an identity gate before their application command, under
`set -e`, so a failed gate means the container never starts. Messages are shaped
`prestart:<stage> failed [CODE]: message`.

Exit code **1** is a failure. Exit code **2** specifically means *something is
unbound*.

| Code | Meaning | Fix |
|---|---|---|
| `MISSING_TEMPLATE_KEY` | The template key is not set | Set it in the service environment |
| `MISSING_DATABASE_URL` | No connection string | Set it |
| `KEY_MISMATCH` | The image was built for a different template | Deploy the right image, or fix the environment |
| `FINGERPRINT_MISMATCH` | The template on disk differs from what was built | Rebuild — this means the image and its template diverged |
| `NOT_PROVISIONED` | No installation row | Run the template reconcile |
| `MULTIPLE_INSTALLATIONS` | More than one installation row | Investigate |
| `INSTALLATION_KEY_MISMATCH` | The database holds a different customer's template key | You are pointed at the wrong database |
| `TEMPLATE_NOT_APPLIED` | The template changed but was not reconciled | Run the template reconcile |
| `UNBOUND_SERVICE` | Object store, durable keys, or a model backend is missing | Check the environment file; exit code 2 |

An unbound *destination* prints a report naming the missing credential category —
never the variable name — and exits 2.

## The outbox relay is stuck

Symptom: work is enqueued but nothing happens, and the operator interface shows a
dispatch as exhausted.

The relay stops retrying an event after its attempt budget, or immediately if the
row is malformed — a schema or payload error is terminal rather than consuming
eight attempts on something that will never parse.

```bash
pnpm --filter worker relay:rearm <operationId>
```

It refuses unless it finds **exactly one** exhausted, undispatched event for that
operation, and refuses again if the row changed underneath it. Both refusals are
intentional: re-arming the wrong row, or a row someone else just fixed, is worse
than doing nothing.

## A publication is stuck in delivery-unknown

This is expected behaviour, not a bug. The system performed an effect and does
not know whether it took.

Reconciliation runs automatically and tries to resolve it against provider
evidence. Three outcomes:

- **Delivered** — recorded, nothing to do.
- **Not delivered** — recorded, and the draft can be republished.
- **Still unknown** — recorded as still unknown, and surfaced to the operator.

Telegram always resolves to *still unknown*: it exposes no way for a bot to look
up a message it may have sent. Those cases need an operator to look at the
channel and attest to what is actually there. That path exists in the interface.

Do not resolve one by republishing on a hunch. That is exactly how a duplicate
reaches the audience.

## Emergency stop

```
PUBLISHING_EMERGENCY_PAUSED=1
```

Checked inside the publish effect, so it stops **new** provider effects without a
deployment. Only `1` or `true` pauses.

It does not cancel work already in flight, and it does not stop ingestion or
generation. It is a brake on the irreversible step.

## Rotating a secret

1. Change the value in the environment file on the host.
2. Restart the affected service.

That is the whole procedure, and it is deliberate — there is no vault to update
and no ciphertext to re-encrypt.

Two cautions. If the secret is one the deploy script requires to be **identical
across files** — the cache-invalidation secret, the durable signing key, the model
provider key, the object-storage values — change every copy, or the next deploy
will refuse. And run `./deploy.sh check <config>` afterwards, which re-validates
the whole environment contract without changing anything.

## Something is publicly exposed

The deploy script asserts against this before every release: no `0.0.0.0`
binding, no fixed container names, nothing proxying the worker port, the
database, or object storage, and `404` for both the internal and health paths.

If you suspect exposure, `./deploy.sh render-nginx <config>` prints the rendered
site to standard output without installing it, so you can read exactly what the
proxy is configured to do.

## Diagnosing without a test suite

There is no test framework. Probes are how a specific boundary gets exercised
against real inputs — the outbound request guard, each market adapter, the
editorial pipeline against frozen fixtures, each generation path, the publishing
lifecycle. The full catalogue is in
[`../reference/commands.md`](../reference/commands.md).

For a suspected regression in filtering or ranking, the editorial fixture command
is the fastest signal: it runs the whole deterministic pipeline over committed
inputs, so any drift shows up as a diff.
