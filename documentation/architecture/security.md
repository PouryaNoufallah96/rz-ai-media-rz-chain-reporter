# Security

What is trusted, what is validated, and where secrets live. This is a
single-customer installation, so the threat model is not tenant isolation — it is
a small number of privileged users, a large amount of untrusted external content,
and credentials that can publish to a brand's public accounts.

## Authentication

Email and password, handled in-process. No external identity provider.

**There is no signup route.** Not hidden, not feature-flagged — it does not
exist. Operator accounts are created from the command line when the installation
is provisioned:

```bash
pnpm --filter web operator:create
pnpm --filter web operator:reset-password
```

This is the correct design for a product with one customer per deployment and a
handful of named users. It also removes the entire attack surface of a
self-service registration flow: no email enumeration, no verification bypass, no
invitation token handling.

**Sign-in throttling** is application-owned, in its own table, keyed by a bucket
string with a window start and an attempt count, and indexed on the window so old
buckets can be swept. It sits alongside the authentication library's own rate
limiting rather than replacing it.

**Sessions** are database-backed. Deleting a user cascades their sessions and
credentials.

## Authorization

Authorization is per read and per mutation, not a gate at the layout.

There is deliberately **no blocking session check in the application layout**. A
lightweight proxy adds an optimistic cookie-presence redirect for private pages —
enough to send a signed-out visitor to sign-in without a database round trip on
every navigation — but it is a convenience, not the control. The control is that
every read resolves the session and the installation itself, and every query
carries its predicate.

That distinction matters: a layout gate that is the only check becomes a single
point of failure the moment one route renders outside it.

### Operator-scoped versus installation-shared

Most reads are operator-scoped: the operator's own drafts, activity, saved cards,
history and usage. A few are deliberately shared across every operator in the
installation — the source catalogue, the import ledger, the item stream, and the
installation overview — because every operator is looking at the same desk.

The rule that keeps this safe: **a cache tag is an invalidation group, never a
visibility channel.** Isolation lives in the cache *key* and in the SQL
predicate. Inverting that — using tags to separate operators — would let one
operator's invalidation serve another operator's rows.

## Secrets

Every secret is an environment variable on the host. The database stores none, in
any form.

There is no credential vault, no encrypted-at-rest credential column, no
key-management service and no workload identity federation. With one customer per
deployment there is nothing to isolate one customer's key from, so all of that
would add attack surface and operational weight for no isolation benefit.

**Rotation** is an operational act: change the variable, restart the process.

### Binding a secret to a destination

A destination account is configuration data carrying a **stable key**. The
deployment environment binds that key to the actual credential. The domain never
contains a variable name, and a credential never contains a domain concept.

Because a missing secret would otherwise surface as a failed publish hours later,
it is checked twice at startup:

- **Preflight** verifies bindings before anything starts.
- **Prestart** runs as a container entrypoint gate. An unbound destination exits
  with a distinct code, so the container never reaches a state where an operator
  can press publish against a credential that is not there.

The same gate checks that the model backends the template selects are actually
bound, that the rendered-page fetcher key is present when a source selects that
mode, and that the market provider bindings the template needs are satisfied.

### What is not a secret

The customer template key names a committed directory. Template fingerprints are
hashes of reviewed configuration. Both appear in logs and startup output
deliberately, because diagnosing an identity mismatch requires seeing them.

## Untrusted input

Everything from outside the installation is data, never instruction — including
responses from services the system chose to call.

### Fetched content

Feeds are parsed with a real XML parser with entity expansion bounded on every
axis, and documents carrying a document type declaration are refused outright.
Article pages are parsed with a real HTML parser. Nothing is evaluated, and
nothing is matched with a regular expression where a parser exists.

### Outbound requests

Every untrusted outbound fetch goes through one guard, described in full in
[`../domain/source-ingestion.md`](../domain/source-ingestion.md). In summary:
protocol allowlist, no credentialed URLs, no non-default ports, a blocklist
covering loopback, private, link-local, carrier-grade NAT, documentation and
reserved ranges in both address families, **DNS pinned to the connection** so the
address that was validated is the address that is connected to, redirect
validation on every hop including a refusal of HTTPS-to-HTTP downgrade, layered
deadlines, size caps enforced three separate ways, and a content-type allowlist.

In production the guard has **no exemption list**. The probe entry point that
accepts exemptions is separate and is named as probe-only in the source.

The one path where socket pinning is impossible — fetching through the
third-party rendered-page service, where the request leaves from their
infrastructure — performs an explicit pre-flight instead, refusing if *any*
resolved address is blocked. That is weaker, and it is applied precisely because
the strong control does not reach there.

### Model input and output

**Every translation and generation prompt states that the supplied text is
untrusted data and that instructions inside it must not be followed.** That is
not decoration; source items are attacker-controlled text that reaches a model.

**Structured output is validated, not trusted.** Translation output is checked
for cardinality, ordering, script dominance, and preservation of protected tokens
— URLs, handles, hashtags, tickers and currency amounts must survive as a
multiset. A model that dropped a URL or invented a subject fails validation
rather than producing content that ships.

## Media access

The browser never talks to object storage. There are no presigned upload URLs
handed to the client and no direct reads.

- **Operator media** is served by an authenticated route that resolves the asset,
  checks the session and the installation, and streams the bytes.
- **Publishing media** — the case where a platform must fetch an image from us —
  uses an operation-scoped opaque grant. The route hashes the grant, streams only
  the one verified asset it maps to, and returns no object key, no redirect, no
  presigned URL and no cacheable response. The grant is short-lived and tied to
  the publishing operation that minted it.

## The internal cache-invalidation endpoint

The worker tells the web application which cache tags to expire, over HTTP.

Authenticated by HMAC-SHA256 over the timestamp and the raw body, with a
constant-time comparison and a maximum clock skew that makes a captured request
unreplayable outside its window.

Two things about it are worth stating plainly:

- **"Internal" is a deployment property, not a check the route performs.** The
  route verifies the signature. Keeping it off the public internet is the reverse
  proxy's job.
- **It is cache durability only, never business truth.** The worst case for a
  forged or lost invalidation is stale reads until the entries expire on their
  own. No business state is reachable through it.

## What is never logged or transmitted

- Secrets, in any form, anywhere.
- Prompts, article bodies, generated content, or any customer content — not in
  logs, traces, error reports or analytics.
- Raw provider errors. They routinely contain request URLs and occasionally
  credentials, so they are mapped to stable codes before anything is emitted.
- Object keys, presigned URLs or redirects on the publishing media route.

Failures log a host and an outcome code. Health failures return a generic status
that names no driver, host or cause — a readiness probe is reachable from more
places than a log is, and it should not describe the internals to whoever asks.

## Abuse protection

There is no third-party request-protection or product-analytics dependency in the
codebase. Abuse protection is the reverse proxy's per-address rate-limit zones —
one general, a much stricter one on the authentication paths — plus the sign-in
throttle and per-procedure authentication.

None of that is authorization truth. A rate limit reduces noise; it never decides
whether a request is permitted. That decision is made per procedure, against the
session and the row's ownership, every time.

If a protection or analytics vendor is ever added, it has to be optional per
installation and no module may assume it: a customer who did not buy the account
must still get a fully working deployment, not a degraded one.

## Data lifecycle

One installation holds one customer's data, which makes export and deletion a
whole-installation operation rather than a per-tenant query. Backup, restore and
teardown are in [`../operations/runbooks.md`](../operations/runbooks.md).
