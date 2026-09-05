# `@rz-chain-reporter/auth`

Authentication and operator provisioning. Email and password, in process. No
external identity provider.

Every file begins with `import "server-only"`.

## Configuration

| Setting | Value |
|---|---|
| Method | Email and password |
| **Public signup** | **Disabled** |
| Minimum password length | 8 |
| Storage | The workspace database, through the schema adapter |
| Plugins | Exactly one — cookie handling for the framework |

No organisation plugin, no membership, no invitations. One installation serves one
customer, so there is nothing to model.

Client addresses are read from the forwarded header with **an explicit trusted-proxy
list**. Without it, a multi-value forwarded header resolves to nothing and every
request shares one throttle bucket.

Session expiry, refresh and cookie behaviour are library defaults. There is no
custom session block, and consumers derive the session type structurally rather
than redeclaring it.

## Sign-in throttling

Two layers. The library's own limiter is a looser backup; **the application's
throttle is the atomic policy.**

It runs as a hook guarded to the sign-in path only — the library matches a single
hook against every request, so without the guard every session check would pay the
cost.

Three buckets are consumed per attempt, in **one** multi-row upsert:

| Bucket | Limit per window |
|---|---|
| Per client address | 5 |
| Per identifier | 5 |
| Per deployment | 50 |

Fixed five-minute windows. The statement restarts a window that has expired and
otherwise increments, returning the retry-after seconds in the same round trip.

Two details:

- **The email is never persisted.** The identifier bucket is keyed by a hash of the
  normalised address.
- **It fails closed.** If no client address can be resolved, the attempt is
  rejected rather than sharing one bucket with everyone.

Lockout returns `429` with a `retry-after` header, and the sign-in procedure maps
it to a declared rate-limited error carrying the seconds.

Each attempt also prunes a bounded batch of expired rows, so the table does not
grow.

## Operator provisioning

Because public signup is closed, accounts are created through the library's
internal adapter.

| Command | Behaviour |
|---|---|
| `createOperatorAccount` | Creates the user and links a credential |
| `resetOperatorPassword` | Updates the password **and signs out every session** |

The password policy is read back from the live configuration rather than
hard-coded, so the two cannot disagree. Validation is **length only** — no
complexity rules.

There is a deliberate repair path: a user row that exists *without* a credential
gets one linked. Provisioning that failed between creating the user and linking
the account leaves exactly that state, and with signup disabled this command is
its only repair.

The command-line entry points live in `apps/web/scripts/`. They prompt
interactively and refuse to run without a terminal — passwords are never read from
arguments or environment variables, because both persist in shell history and in
the process list.

## Related

[`../../documentation/architecture/security.md`](../../documentation/architecture/security.md)
