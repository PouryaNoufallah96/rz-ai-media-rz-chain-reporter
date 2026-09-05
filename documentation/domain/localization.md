# Localization

English and Persian, with per-locale text direction. Two locales, fixed
product-wide, never customer configuration.

## Two locales that are easy to confuse

**Interface locale** — the language the operator is reading the application in. It
is a **route parameter**, so `/en/dashboard` and `/fa/dashboard` are different
URLs and both prerender.

**Content locale** — the language a generated artifact is *written in*. It is a
**field on the artifact**, chosen per generation.

They are deliberately separate. An operator working in Persian can produce English
copy, and the reverse. Conflating them would make the interface language decide
what gets published, which is not a decision the interface language should make.

## Locale facts live in one place

`packages/i18n` holds the facts and nothing else — no framework, no React, no
translation machinery. That is what lets the worker import it while composing a
poster.

| Locale | Direction | Script | Calendar | Font |
|---|---|---|---|---|
| `en` | Left to right | Latin | Gregorian | Geist |
| `fa` | Right to left | Arabic | Persian | Vazirmatn |

Two details that matter in practice:

**Formatting locale is not the locale code.** Persian formatting uses the
Gregorian calendar with extended-Arabic-Indic numerals, expressed as a full
locale tag. The Persian *calendar* is exposed separately for the surfaces that
want it — date selection in particular. Format through the tag and you get the
product's intended output; format through the bare code and you do not.

**Direction is a prop, never a decision a component makes.** The shared component
package is forbidden by lint rule from importing the framework or the intl
library, precisely so a primitive cannot read the locale itself — which would make
it impossible to render both directions on one page.

## Routing

The locale is a **root route parameter**, read through the framework's root-params
API and never from cookies or headers. Both locales are enumerated for static
generation.

That is what lets `<html lang dir>` render outside any Suspense boundary while the
shell still prerenders. **The prerendered static shell is never traded for a
translation.**

The locale cookie is disabled — a cookie would make the shell uncacheable, and the
locale is already in the URL.

The locale switch preserves the query string, so changing language does not
discard a filter or a page position.

## Message catalogs

Per feature, at `features/<name>/messages/<locale>.json`.

The root provider deliberately passes **no messages**. A client island renders
inside a wrapper naming exactly the namespaces it needs. An island without one
throws rather than silently leaking key paths into the interface.

A missing key throws loudly outside production and is swallowed in production.

### The catalog check

`pnpm i18n:check` verifies three things per slice:

1. No key missing from a non-default locale.
2. No extra key that the default locale does not have.
3. **Argument-signature parity.** Each message is parsed as an ICU message and a
   signature built from its arguments, number and date formats with their styles,
   plural and select options including their names and nested contents, and rich
   tags. A mismatch is reported concretely — a key that takes a plural in one
   locale and a bare argument in the other fails.

The third check is the valuable one. Two catalogs can have identical keys and
still break at runtime, because Persian plural rules differ and a message written
without a plural block will render wrongly rather than throw.

## Formatting

All formatting goes through the platform's internationalisation APIs with the
locale's full tag. No hand-rolled number or date formatting anywhere.

A **fixed `now`** is passed to the intl provider, because the library's default is
build time — and a build-time timestamp under prerendering produces relative
formatting that is stale on arrival. Callers that need real relative time pass
their own.

The Persian font is loaded with preloading **off**, because preload links are
keyed by layout path rather than by locale — leaving it on would ship the Persian
font to every English page.

## Content translation

Three subjects can be translated, each with the same durable rails: an
authenticated command, an operation, an attempt, a usage row, cache invalidation,
and a live message. No separate lifecycle, no separate channel.

| Subject | What it translates |
|---|---|
| Topics | The operator's run topics into the run's content locale |
| Card presentation | A card's operator-facing display text |
| Copy variants | A full platform copy bundle: headline, body, hashtags |

### Complete or absent, never partial

Localizations are **immutable** and written only on success. A read selects either
a complete translation or the complete authoritative original.

There is no state in which a card shows half a translation. That is enforced in
the schema with partial unique indexes and exactly-one-of constraints, not by
application convention.

A failed translation affects only that operation. Analysis does not wait for it,
and the card stays readable in its original language.

### Output is validated hard

A translation is checked before it is stored:

| Check | What it catches |
|---|---|
| **Cardinality** | The result must have exactly as many entries as the input |
| **Ordering** | Entries must come back in the same order, by index |
| **Script dominance** | The target script must actually dominate the result — a "translation" that came back in the source language fails |
| **Protected tokens** | URLs, handles, hashtags and tickers must survive as a multiset |
| **Currency and percentage** | A figure in the source must survive as a symbol, a code, or the target locale's word — and must not appear if the source had none |
| **Hashtag rules** | Exact count, the canonical brand hashtag first, all unique after case folding |

Localized digit glyphs and localized currency wording are **accepted** — a Persian
rendering of a dollar amount is correct, not a lost token. Numeric glyphs are
normalised before comparison so a correctly localized number is not read as a
missing one.

A token that simply vanished is a failure.

### Fallback is recorded, never silent

When topic translation is unavailable, the original topics are used and the record
carries an explicit flag saying so. A downstream reader can tell the difference
between "translated" and "we used the original".

### Prompts state that the input is untrusted

**Every translation prompt says plainly that the supplied text is untrusted data
and that instructions inside it must not be followed.**

Source items are attacker-controlled text that reaches a model. That sentence is
in every prompt in this codebase for that reason.

The prompts also specify exactly what may and may not change: preserve meaning and
facts; keep URLs, handles, hashtags and tickers unchanged; format numbers,
currencies, percentages and dates naturally for the target; translate or
transliterate names and acronyms; and do not add, omit, summarise, explain or
interpret.

## Persian specifics

**Digit folding at the lowest level.** Text normalisation folds Arabic-Indic and
extended Arabic-Indic digits to ASCII before any comparison. A Persian article
writing a figure in Persian digits and an English article writing the same figure
in ASCII match the same keyword rule — otherwise every numeric term would need two
configurations.

**Bilingual identity in SQL.** The workspace name key is computed by a database
function that normalises, strips zero-width and bidirectional control characters,
folds Arabic letter forms to their Persian canon, folds digits, collapses
whitespace and applies a deterministic collation. It deliberately preserves alef
with madda as meaning-bearing rather than folding it away.

That function is declared **frozen once applied** — a rule change ships as a new
version plus a column and index rebuild, never as an edit, because editing it
would silently change the identity of rows already stored.

**Logical properties throughout.** Layouts use start and end rather than left and
right, so direction is a data attribute and not a second stylesheet.

**Both fonts ship in the worker image**, with recorded provenance, upstream
commits, checksums and licences. That is what makes bilingual chart and poster
rendering work inside the container.

## Where the code is

| Concern | Path |
|---|---|
| Locale facts | `packages/i18n/src/index.ts` |
| Routing, catalogs, providers | `apps/web/src/i18n/` |
| Message catalogs | `apps/web/src/features/*/messages/` |
| The catalog check | `apps/web/scripts/check-messages.ts` |
| Topic projection | `apps/worker/src/sources/effective-topics.ts` |
| Presentation translation | `apps/worker/src/editorial/presentation-localization.ts` |
| Copy variant translation | `apps/worker/src/editorial/copy-variant-localization.ts` |
| Validation primitives | `apps/worker/src/translation-output.ts` |

## Adding a message

1. Add the key to **both** locale files in the owning feature.
2. Run `pnpm i18n:check`.
3. Use logical properties in any layout you touch.
4. Format through the internationalisation APIs — never by hand.
5. If the string is inside a shared primitive, it is a **prop**, not a lookup.
