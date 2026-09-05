# `@rz-chain-reporter/config`

The shared TypeScript compiler base. Every app and package extends
`tsconfig.base.json` from here, so there is exactly one place to change a
compiler option workspace-wide.

## What it sets

| Option | Value | Why |
|---|---|---|
| `target`, `module`, `lib` | `ESNext` | The pinned Node release and modern bundlers; no downlevelling. |
| `moduleResolution` | `bundler` | Matches how both Next.js and esbuild actually resolve. |
| `verbatimModuleSyntax` | `true` | Type-only imports must say so. Removes a class of accidental runtime imports of type-only modules. |
| `strict` | `true` | The baseline. |
| `noUncheckedIndexedAccess` | `true` | `array[i]` is `T \| undefined`. Catches the most common source of runtime `undefined` in this codebase. |
| `noUnusedLocals`, `noUnusedParameters` | `true` | Dead code fails the type check rather than accumulating. |
| `noFallthroughCasesInSwitch` | `true` | Exhaustive `switch` over the closed enums this codebase uses heavily. |
| `isolatedModules` | `true` | Required by the transpile-only build paths. |
| `resolveJsonModule` | `true` | Customer templates and message catalogs are JSON. |
| `types` | `[]` | No ambient global types are pulled in implicitly. Each package opts into what it needs. |
| `skipLibCheck` | `true` | Declaration files in `node_modules` are not this repository's problem. |

## Using it

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@rz-chain-reporter/config/tsconfig.base.json",
  "compilerOptions": { /* only what differs */ },
  "include": ["src"]
}
```

Add an override in the consuming package, not here, unless the change genuinely
applies to everything.

## Scripts

`check` and `fix` only — there is no source to compile.
