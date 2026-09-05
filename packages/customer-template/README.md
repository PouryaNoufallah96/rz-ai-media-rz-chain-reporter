# `@rz-chain-reporter/customer-template`

The schema, loader and fingerprint for a customer installation's configuration.

Framework-free — Zod plus Node's filesystem and crypto. That is what lets the web
application, the worker, the seed command and the build scripts all import it.

## Exports

| Subpath | Contains |
|---|---|
| `./schema` | The template schema and every value type |
| `./load` | The loader, the declared-file boundary and the rejection codes |
| `./fingerprint` | The canonical fingerprint |
| `./stable-key` | The key grammar |
| `./build-metadata` | The byte-identical build-metadata writer and reader |

`./stable-key` is its own subpath because `packages/env` validates
destination-binding variable names against **the same grammar**. One grammar for
template validation, the loader and environment validation.

## The declared-file boundary

**A customer directory may contain `template.json` and nothing else except the
files that template fields explicitly declare.** The loader walks the directory
and rejects anything it does not recognise. Dotfiles are exempt.

Packaging globs cannot compute the declared set, so without this rule the reviewed
set and what actually ships would drift.

It is also why `customer-templates/authoring/` is a **sibling** rather than a
subdirectory: reviewed source material the loader must never see lives there, and
no build copies it.

## Loading

Key validation → real-path resolution (so a symlink cannot escape the tree) →
parse → **schema-version check before full validation** → validate → directory-name
match → read and verify every declared reference, sorted by path → refuse
undeclared files → fingerprint.

Checking the version first means a template written against an older version
reports that cleanly instead of producing a wall of schema errors.

Seventeen rejection codes, each naming exactly what is wrong. See
[`../../documentation/domain/customer-template.md`](../../documentation/domain/customer-template.md).

## Rasters are verified, not trusted

A template declares each image's byte length, pixel dimensions and digest. The
loader checks the PNG signature, reads the dimensions **out of the header itself**,
and requires all three declarations to match.

It goes further for brand logos: it mirrors the image assembler's arithmetic to
check the resized logo plus its inset fits inside the output canvas. A geometry
error surfaces at load time rather than as a clipped logo on a published post.

## The fingerprint

A hash over a canonical serialisation of the validated template **plus the path
and digest of every declared reference**.

Canonicalisation sorts object keys and **preserves authored array order**.
Reformatting the JSON does not move the hash; reordering an array does, because
order is meaningful. Changing one pixel of a logo changes the fingerprint.

That fingerprint is what the build embeds, what the reconcile writes to the
database, and what both applications compare at startup and on every readiness
check.

A second fingerprint covers one brand's editorial block alone, so scoring drift is
detectable per brand.

## Cross-field validation

Individual fields are easy; the rules **between** them are where the constraints
live. Completeness (every model option fully routed), orphan detection (a route
naming an option that does not exist), arithmetic (weights sum to one, the
freshness ladder increases, embedding capacity fits), platform reality (a caption
ceiling, not a message ceiling), and duplicates everywhere.

Each exists because its absence produced a confusing failure downstream. The full
list is in the documentation page above.

## Commands

```bash
pnpm --filter @rz-chain-reporter/customer-template validate [key...]
```

With no arguments it validates every template directory. It prints the schema
version, the fingerprint and the number of verified references per template.

It also runs as part of this package's `check` task, so a broken template fails
the ordinary verification pass.
