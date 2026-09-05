# Key decisions

Each entry states a constraint as a fact, then the reasoning behind it. They are
recorded because they are expensive to reverse, and because a rule whose reason
has been lost gets deleted by the next person who finds it inconvenient.

If you are about to work against one of these, that is a decision to make
deliberately — not a bug to route around.

---

## One deployment serves exactly one customer

**The decision.** ChainReporter is one reusable product, deployed and configured
as a separate installation per customer. Each installation has its own host,
database, object storage and provider credentials. It is not a multi-tenant
service.

**Why.** The customers are few, their configurations differ substantially, and
their content is commercially sensitive to each other. Physical separation gives
stronger isolation than any row-level scheme, for less code. It also removes an
entire class of problems — cross-tenant leakage, noisy neighbours, per-tenant
quota — that would otherwise dominate the design.

**What it rules out.** Public signup. Customer-entered provider credentials.
Billing, plans, entitlements and quota enforcement. Row-level security as tenant
isolation. Organisation and membership models.

**What survives.** `workspace_id` stays on every customer-owned row. It
identifies the installation and keeps queries honest; it is not defending a
security boundary.

---

## Secrets live only in the deployment environment

**The decision.** Every provider credential is an environment variable on the
host. The database never stores a secret, in any form.

**Why.** With one customer per deployment there is nothing to isolate one
customer's key from, so an application-level credential store would add a vault
to attack, a key-management dependency, and a migration path — in exchange for
nothing. Rotation becomes an operational act: change the variable, restart the
process.

**What it rules out.** A credential vault, database-stored ciphertext, a
key-management service, and workload identity federation.

**The consequence to design around.** A missing secret must fail loudly at
startup, not at first publish. That is what the destination-binding preflight and
prestart checks exist for.

---

## Long or effectful work never runs in a request

**The decision.** Fetching a source, calling a model, writing object bytes and
publishing to a platform all run in `apps/worker` as durable, retryable
functions. A request-bound route hands work off; it does not do it.

**Why.** These operations fail, take seconds to minutes, and have side effects
that must survive a process restart. A request handler cannot retry after the
connection is gone, cannot reconcile an ambiguous outcome, and cannot be observed
after the fact.

**The single exception.** The assistant's streaming turn in `apps/web` calls a
model inside the request, because streaming a reply to the operator *is* the
product behaviour and there is nothing durable to preserve. It is named here so
that it stays the only one.

---

## Every model call goes through one gateway

**The decision.** All model access goes through the application-owned
`ModelGateway`. Feature code names a task, never a provider or a model.

**Why.** Backend and model selection is a per-customer configuration decision, so
it must live in one resolvable place rather than scattered across call sites. It
also gives one place to validate structured output, apply a deterministic
fallback order, and record what every attempt cost.

**What it rules out.** Direct provider SDK calls from feature code, a second
remote provider, and provider names appearing anywhere in the domain.

**The remote backend is OpenRouter.** A task may instead be routed to an on-host
model backend when the customer template selects it — currently image template
selection, which prefers it, and embeddings, which may use it. That is a per-task
choice, not a general migration away from the remote provider.

---

## Usage is reported, never enforced

**The decision.** Every model attempt records the provider's generation
identifier, the model, the backend, token counts, the authoritative returned cost
and the task context. An operator screen reports on it. Nothing is ever blocked
because a number was reached.

**Why.** There is no commercial relationship inside the product to enforce
against — a customer's spend is their own, on their own installation. Building
allowances and quota stops would add a failure mode (work refused for the wrong
reason) with no corresponding benefit.

**What it rules out.** Plans, tariffs, entitlements, allowances, reservations,
settlement and quota stops.

---

## PostgreSQL owns business state; object storage owns bytes

**The decision.** Business state lives in PostgreSQL. Binary objects live in
object storage behind one seam. The database owns every object's lifecycle
state — pending, verified, promoted, expired — and the browser never talks to
object storage directly.

**Why.** Two systems that both believe they own the truth will disagree, usually
during an incident. Making the database authoritative over lifecycle means an
orphaned object is detectable and reconcilable, and an object reference in a row
always has a state you can query.

**What it rules out.** Presigned upload URLs handed to the browser, direct
browser reads, and object metadata that exists only in storage.

---

## Spreadsheets and external documents are not the record

**The decision.** PostgreSQL is the record for approved, scheduled and published
content. Operator screens are the report.

**Why.** An external document is not transactional, not queryable and not
reconcilable against what a platform actually did. Anything that treats one as
authoritative reintroduces a second source of truth.

---

## Both locales are a product invariant

**The decision.** The application is English and Persian with per-locale text
direction. The locale is a route parameter, both locales are prerendered, and the
set is fixed product-wide — it is never customer-template configuration.

**Why.** Locale-as-configuration would mean the static shell, the routing table
and the message catalogs all vary per installation, which trades away
prerendering and makes every catalog check installation-specific.

**Kept separate.** The operator's interface locale and an artifact's content
locale are different fields. Conflating them would prevent an operator working in
one language from producing content in another.

---

## Cached reads are the default for customer-owned data

**The decision.** A read of customer-owned data is a cached kernel by default.
Authentication and workspace resolution happen outside the cache; the cache key
carries the installation and, for operator-owned data, the operator. Leaving a
read uncached is the choice that needs a stated reason.

**Why.** Almost every screen re-reads the same rows across navigations. The
default has to be the fast path, or the fast path never gets applied
consistently.

**The rule that makes it safe.** A cache tag is an invalidation group, never a
visibility channel. Operator isolation lives in the cache *key* and in the SQL
predicate. Getting this backwards would let one operator's tag invalidation serve
another operator's rows.

---

## Import boundaries are enforced by the linter

**The decision.** Feature privacy, the direction of dependencies and the
framework-free packages are all expressed as restricted-import rules in
`biome.json`, not as review conventions.

**Why.** A boundary that is only written down erodes. A boundary that fails
`pnpm check` does not, and the error message can carry its own reason — which is
where a new contributor actually reads it.

**The visible cost, accepted deliberately.** Adding a legitimate cross-feature
edge requires editing `biome.json`. That is the point: the edge shows up in the
diff and gets a decision.

---

## No test framework; probes and static analysis instead

**The decision.** There is no test framework in the repository. Verification is
type checking, static analysis, and deterministic probe commands that drive one
pipeline or boundary end to end and print an explicit outcome.

**Why.** The risk in this system concentrates in effectful paths against real
providers, where a mocked test proves very little. A probe that runs the real
adapter against a disposable database catches what matters.

**The trade being made.** Pure-logic regressions are less protected than they
would be with unit tests. That is a known cost of the current scope, not an
oversight — and the probes are catalogued in
[`../reference/commands.md`](../reference/commands.md) so the coverage that does
exist is legible.

---

## Request protection lives in the proxy, not in a vendor module

**The decision.** There is no third-party request-protection or product-analytics
dependency anywhere in the codebase. Abuse protection is the reverse proxy's
per-address rate-limit zones — 20 requests a second for the application, 2 a
second for the authentication paths — together with the sign-in throttle in
`packages/auth` and per-procedure authentication. Nothing is emitted to an
analytics vendor.

**Why.** One installation serves one customer behind one proxy that we configure,
so the layer that already terminates TLS is also the cheapest correct place to
shed abusive traffic, and it keeps working when the application is down.

**If either is ever added**, it has to be optional per installation and no module
may treat it as an assumed dependency — a customer who has not bought the account
must still get a fully working deployment, not a degraded one. Analytics would
additionally be limited to explicit events, never automatic capture.

---

## The customer template is versioned data, not runtime configuration

**The decision.** Values that differ between customers live in a reviewed
template directory under version control, are validated at build time, and are
applied to the database by an explicit reconcile command. No startup path ever
seeds.

**Why.** These values change how the product behaves — which sources are read,
which model runs which task, what the thresholds are. They deserve review and a
diff. A configuration screen would make them unreviewable and untraceable; a
startup seed would make them apply at an unpredictable moment.

**The boundary that keeps it honest.** A template directory may contain only
`template.json` and the files that template fields explicitly declare. Anything
else is rejected at load time, so the reviewed set and what actually ships cannot
diverge.

---

## One market data path is prohibited

**The decision.** The market capability uses documented endpoints only: the keyed
professional quotes API, the documented keyless public K-line API, the public
market-data endpoints of the two exchanges, and the on-chain variant. The
undocumented internal data path of the same vendor is prohibited.

**Why.** An undocumented endpoint has no stability contract and no terms
permitting this use. Depending on one means the product breaks without notice and
without recourse.
