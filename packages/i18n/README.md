# `@rz-chain-reporter/i18n`

Locale facts, and nothing else. This package answers "what is true about Persian
and English" for every consumer that needs to know — the web application, the
worker's rendering paths, and the chart package.

It has **no dependencies**. No `next`, no `next-intl`, no React. That is what
lets the worker import it while composing an image, and what keeps it from
becoming a home for translation machinery.

## What it exports

| Export | Value / shape |
|---|---|
| `LOCALES` | `["en", "fa"]` — the product's locale set, fixed and never customer configuration |
| `DEFAULT_LOCALE` | `"en"` |
| `Locale` | The union type derived from `LOCALES` |
| `DIRECTION` | `en → ltr`, `fa → rtl` |
| `SCRIPT` | `en → latn`, `fa → arab` |
| `CALENDAR` | `en → gregory`, `fa → persian` |
| `INTL_LOCALE` | The full BCP 47 tag with calendar and numbering extensions, used for every `Intl` call |
| `FONT_FAMILY` | `en → Geist`, `fa → Vazirmatn` |
| `UI_FONT` | The CSS custom property for each locale's font |
| `isLocale(value)` | A type guard, used to validate the locale route parameter |

## Two details that matter

**`INTL_LOCALE` is not the same as the locale.** Persian formatting here uses the
Gregorian calendar with extended-Arabic numerals (`fa-IR-u-ca-gregory-nu-arabext`),
not the Persian calendar. `CALENDAR` exposes the Persian calendar separately for
the surfaces that want it — date selection in particular. Format through
`INTL_LOCALE` and you will get the product's intended output; format through the
bare locale code and you will not.

**Direction is data, not a side effect.** Components take direction as a prop.
`packages/ui` is forbidden by lint rule from importing `next` or `next-intl`
precisely so that a primitive cannot decide its own direction — which would make
it impossible to render both directions on one page.

## Where the rest of localization lives

- Message catalogs: `apps/web/src/features/<feature>/messages/<locale>.json`
- `next-intl` wiring and catalog loading: `apps/web/src/i18n/`
- Content locale (the language an artifact is *written in*, distinct from the
  interface locale): [`../../documentation/domain/localization.md`](../../documentation/domain/localization.md)
