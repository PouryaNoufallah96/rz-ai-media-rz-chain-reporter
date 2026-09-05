# `@rz-chain-reporter/ui`

Owned components and design tokens. The component source lives in `src/`, not in
`node_modules`, so it is reviewable and editable like any other code.

## The rule that shapes everything

**This package may not import the framework or the intl library.** It is a lint
rule, and it is not stylistic.

Every string and the text direction arrive as **props**. A primitive that read the
locale itself could not be rendered in the other direction on the same page, and
could not be used outside the web application at all.

If you find yourself wanting a translation hook here, the string belongs to the
caller.

## What is inside

| Path | Contents |
|---|---|
| `src/components/` | The owned component set, including icon components |
| `src/styles/globals.css` | Tokens, base layer, theme definitions |
| `src/lib/` | Class-name utilities |
| `src/hooks/` | Framework-free hooks |

Built on unstyled accessible primitives, with variant handling and class merging.
Tailwind CSS through PostCSS — tokens live in the stylesheet, and there is no
JavaScript configuration file.

Date selection ships both calendars the product supports.

## Consuming it

```ts
import { Button } from "@rz-chain-reporter/ui/components/button";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
```

`@rz-chain-reporter/ui/globals.css` is imported once by the web application.

## Adding a component

Add one here only when **every string and the direction can be props**. If it needs
to know about a brand, a draft or a platform, it is application composition and
belongs in `apps/web/src/components/`.

The component tool is configured for this workspace, including right-to-left
support, and writes into `src/components/`. Review the generated diff like any
other code — that is the point of owning the source.

## Related

- [`../../documentation/domain/localization.md`](../../documentation/domain/localization.md) — direction, script and fonts
- [`../../documentation/reference/conventions.md`](../../documentation/reference/conventions.md) — the enforced boundaries
