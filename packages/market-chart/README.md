# `@rz-chain-reporter/market-chart`

Deterministic market chart geometry and SVG serialisation.

**No chart library, no React, no framework.** Its only dependencies are the shared
contracts and the locale facts.

## Why it exists

The browser renders a preview so the operator can see what they are approving. The
worker renders the canonical image that gets published. **Those two must agree.**

If each had its own implementation they would diverge — over a rounded axis label,
a tick position, a label collision — and an operator would approve one chart and
publish a different one. So the geometry lives here, once, and both sides call it.

A probe verifies the two paths produce identical output.

## What it does

- Normalises and materialises a chart specification.
- Applies presets.
- Computes scene geometry: axes, ticks, series paths, labels.
- Serialises to SVG.
- Formats values, percentages and timestamps **per locale**, through the
  internationalisation APIs with the locale's full tag.

It carries a **render contract version**. A change to geometry that would alter an
already-approved chart is a version change, so a stored approval is not silently
reinterpreted.

## Fonts

Font family names come from the locale facts and are emitted as SVG attributes.
The worker image ships both faces with recorded provenance and licences, which is
what makes bilingual rendering work inside the container.

## The probe

```bash
pnpm --filter @rz-chain-reporter/market-chart probe:market-chart
```

Verifies render-contract parity between the preview and the canonical render. Run
it after any change to geometry, formatting or serialisation.

## Related

[`../../documentation/domain/market-analysis.md`](../../documentation/domain/market-analysis.md)
