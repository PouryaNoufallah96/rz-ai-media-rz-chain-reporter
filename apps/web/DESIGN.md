---
name: ChainReporter
description: Prepress job-ticket workspace — every operation is a pressed mark on a proof sheet, never a vibe.
colors:
  ground: "#1a1916"
  surface: "#211f1b"
  surface-2: "#262420"
  ink: "#e9e2d3"
  ink-muted: "#a89f8d"
  hairline: "rgba(233,226,211,.14)"
  press-red: "#c73a2e"
  press-red-text: "#ea6a5d"
  proof-blue-text: "#7aa5cf"
  proof-blue-mark: "#4a7fb5"
  working-amber: "#c9992e"
  cream-on-red: "#f4efe4"
  ground-light: "#efe9dc"
  surface-light: "#f7f3e9"
  surface-2-light: "#efe9db"
  ink-light: "#26221c"
  ink-muted-light: "#6f6656"
  hairline-light: "rgba(38,34,28,.18)"
  press-red-light: "#b53226"
  proof-blue-light: "#2f5d8a"
  working-amber-light: "#7d5c14"
typography:
  display:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  title:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  caption:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  label:
    fontFamily: "Geist, Vazirmatn, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 500
    letterSpacing: "0.08em"
  mono-meta:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  none: "0px"
  tag: "3px"
  control: "4px"
  overlay: "6px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "12px"
  lg: "18px"
  xl: "22px"
  2xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.press-red}"
    textColor: "{colors.cream-on-red}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  ticket-block:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.none}"
    padding: "18px"
  nav-item-active:
    backgroundColor: "color-mix(in srgb, #c73a2e 8%, transparent)"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
---

# Design System: ChainReporter

## Overview

**Creative North Star: "The Press-Room Proof Sheet"**

Every operation in ChainReporter is a job ticket moving through a press room, and every
state is a pressed mark — never a glow, never a vibe. The interface is a proof sheet:
graphite (or cream) paper divided by hairline ticket rules, perforated tear-lines, and
registration corners, read at desk density by professional operators. It deliberately
refuses the glowing dark-SaaS dashboard arrangement: no gradients, no blurred halos, no
colored badges standing in for truth. State is carried by a drawn mark plus a state-owned
color, stamped onto the sheet.

The system is dual-theme (press graphite dark by default, ticket cream light), bilingual
English/Persian with per-locale direction, and built for density with legibility: a
hierarchy that survives 360px widths and RTL without redesign. Ambiguity is a first-class
citizen — `delivery_unknown` gets its own mark and its own explanation, never optimistic
green or silent retry.

This document records the system from the approved Phase 1 prototype
(`docs/plans/platform-foundation/design/prototype/shell.html`). The prototype is design
truth, not code truth: production re-expresses every rule here through semantic tokens in
`packages/ui/src/styles/globals.css`, owned shadcn/Base UI components, CSS logical
properties, and next-intl catalogs. Never copy prototype markup, class names, or JS.

**Key Characteristics:**
- Job-ticket materiality: hairline rules, dashed secondary rules, tear-line perforations, registration corners, floating ticket labels.
- One interactive accent (press red); proof blue and working amber exist only inside the state-mark system.
- Drawn SVG state marks on a 16px grid at 1.5px stroke — a mark+color pairing per state, never hue alone.
- Flat, border-declared elevation; a single soft shadow reserved for overlays.
- The read plane never moves; the stamp-press is the only state-transition motion.
- Bilingual en/fa with direction derived from locale and logical-properties-only geometry.

## Colors

A two-theme paper-and-ink palette — press graphite with cream ink (dark, default) and
ticket cream with graphite ink (light) — carrying exactly one interactive accent and two
state-only hues.

### Primary
- **Press Red** (`press-red` #c73a2e dark / `press-red-light` #b53226 light): the single interactive accent. Primary buttons, active-nav edge and tint, selection background, error borders, and the failed state. On dark ground, red used *as text or caret* lifts to **Press Red Text** (`press-red-text` #ea6a5d) for contrast; in light theme text-red and surface-red are the same value.
- **Cream On Red** (`cream-on-red` #f4efe4): the only text/foreground permitted on a press-red surface (primary buttons, skip link, selection).

### Secondary (state system only)
- **Proof Blue** (`proof-blue-text` #7aa5cf for state labels, `proof-blue-mark` #4a7fb5 for mark strokes, dark; `proof-blue-light` #2f5d8a for both, light): succeeded/done. Appears nowhere else.
- **Working Amber** (`working-amber` #c9992e dark / `working-amber-light` #7d5c14 light): running, retrying, delivery-unknown, and the reconnect band. Appears nowhere else.

### Neutral
- **Ground** (`ground` #1a1916 / `ground-light` #efe9dc): page ground and input wells.
- **Surface** (`surface` #211f1b / `surface-light` #f7f3e9): ticket blocks, sidebar, panels, dialogs.
- **Surface-2** (`surface-2` #262420 / `surface-2-light` #efe9db): toasts and utility strips one step above surface.
- **Ink** (`ink` #e9e2d3 / `ink-light` #26221c): primary text and the drawn brand plate.
- **Ink Muted** (`ink-muted` #a89f8d / `ink-muted-light` #6f6656): secondary text, idle nav, registration corners, mark strokes for neutral states, scrollbar thumb.
- **Hairline** (`hairline` rgba(233,226,211,.14) / `hairline-light` rgba(38,34,28,.18)): every rule and border. The rule *is* ink at reduced alpha — 14% on dark, 18% on light — never a third gray.

### Named Rules
**The One Accent Rule.** Press red is the only accent an operator can interact with. If a colored element is not a state mark or state label, it is red or it is neutral.

**The State-Owned Hue Rule.** Proof blue and working amber belong to the state-mark system exclusively. They never decorate chrome, charts, links, or emphasis. Conversely, a state is never communicated by hue alone — see The Pressed Mark Rule (Components).

**The AA Floor Rule.** WCAG 2.2 AA is the floor in both themes: 4.5:1 for text, 3:1 for meaningful graphics (marks, patches, focus ring). A state color that fails the floor on its theme's surfaces gets a darker/lighter theme variant, never an opacity trick.

## Typography

**UI Font:** Geist (falling back to Vazirmatn, system-ui)
**Persian UI Font:** Vazirmatn (leads the stack when locale is `fa`)
**Mono Font:** Geist Mono (ui-monospace) with `font-variant-numeric: tabular-nums`

**Character:** A neutral, workmanlike grotesque set at desk density — the voice of a
ticket header, not a landing page. The mono face is the press ledger: every timestamp,
ticket id, count, and version string is mono with tabular numerals.

### Hierarchy
The ramp is 10.5 / 12.5 / 14 / 16 / 20 / 28 px, plus a 12px mono metadata size.

- **Display** (650, 28px, −0.02em): the page title (h1). One per surface. Tracking resets to 0 under `data-script="arab"`; compose the `tracking-display` utility over `--tracking-display`.
- **Headline** (600, 20px): major section headings on feature surfaces (barely exercised in the Phase 1 shell; reserved for Phases 5–9).
- **Title** (600, 16px): block and panel titles above body scale.
- **Body** (400, 14px, 1.55): default reading size. Prose blocks cap near 72ch.
- **Caption** (400, 12.5px): secondary metadata — platform names, state labels, field labels (500), inline actions.
- **Label** (500, 10.5px, uppercase, +0.08em): the ticket label — block labels floating over the top border, table headers. Ships as the `ticket-label` utility over the `--text-size-label` / `--font-weight-label` / `--tracking-label` / `--text-transform-label` script tokens in `packages/ui/src/styles/globals.css`; compose that utility rather than re-typing the four values, which is how the Arabic-script branch gets lost. Latin only; see The Latin Case Rule.
- **Mono Meta** (Geist Mono 400, 12px, tabular): timestamps, ticket/job ids, counts, pager readouts, attempt counters (11px when nested inside a state label).

### Named Rules
**The Latin Case Rule.** Uppercase transform and +0.08em tracking are Latin-script devices. Arabic-script UI (`data-script="arab"`) ticket labels take no case transform, zero letter-spacing, weight 600, and one step more size (~11px); display tracking is 0. Never letter-space Arabic-script text.

**The Ledger Numeral Rule.** Anything an operator might scan down a column — time, id, count, attempt — is mono with tabular numerals, and renders locale digits (Persian-Indic in `fa`) via `Intl` formatting.

## Layout

The shell is a fixed press-room arrangement: a 48px ticket-header top bar (workspace
nameplate at start, color-bar ops indicator + utilities at end), a job-bag index sidebar
at inline-start (232px, collapsible to a 56px mark-only rail), and a scrolling proof-sheet
main region. The sheet centers at max 1200px with inline padding `clamp(16px, 4vw, 40px)`,
28px block-start padding, and 22px gaps between ticket blocks. Two-up block grids collapse
to one column at 900px.

At 768px and below the sidebar becomes an off-canvas overlay (`min(280px, 85vw)`) behind a
scrim; the shell is a single column under the 48px bar. The layout holds at 360px. Density
is deliberate: 8–10px row rhythm inside blocks, 18px block padding, hairline separation
instead of whitespace inflation.

Spacing rhythm: 6 / 10 / 12 / 18 / 22 / 28 px (frontmatter `spacing`); 2px only as a
hairline gap inside composed indicators (color-bar patches, nav list).

### Named Rules
**The Logical Geometry Rule.** Direction derives from locale (`fa` → RTL), and every
geometric property is logical: `inset-inline-start`, `border-block-end`,
`margin-inline-start`, `padding-inline` — never left/right physicals. Off-canvas surfaces
(sidebar, ops panel) enter from their inline edge with direction-aware transforms.
Mixed-script content (handles, tickers) is isolated with `<bdi>`. Dates in Persian render
the Persian calendar; digits follow locale.

**The Still Read Plane Rule.** The proof sheet never moves. Motion is permitted only in
the periphery — overlay entry, the reconnect band, a mark being stamped — and every
animation is removed (not merely shortened) under `prefers-reduced-motion`. Content
regions dim in place while refetching; they never swap to skeletons after first paint.

## Elevation & Depth

Elevation is declared once, as borders. Surfaces step `ground → surface → surface-2` with
hairline rules doing all structural separation; nothing at rest casts a shadow. Exactly
one soft shadow exists and only true overlays carry it — the ops panel, dialogs, toasts,
and the mobile off-canvas sidebar — because those genuinely float above the sheet. Modal
overlays sit behind a plain dark scrim (rgba(0,0,0,.4–.45)).

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 6px 24px rgba(0,0,0,.45)` dark / `0 6px 24px rgba(38,34,28,.18)` light): panels, dialogs, toasts, off-canvas sidebar. Nothing else.

### Named Rules
**The Border Elevation Rule.** If it is part of the sheet, it is separated by a hairline,
not lifted by a shadow. The overlay shadow is the single exception and marks "floating
above the proof sheet," never emphasis.

## Shapes

The form language is the cut ticket: square-cornered blocks (radius 0) with 1px hairline
borders, 10px registration corners drawn at 1.5px stroke in muted ink at ~60% opacity, and
a floating ticket label that sits on the top border, knocked out by a surface-colored
plug. Solid hairlines are primary rules (block borders, table row rules, top-bar rule);
dashed hairlines are secondary separations (ticket-row dividers, sidebar footer, dialog
action rail, "soon" tags). Perforated tear-lines — a 10px-tall repeating punched-dot band
on a 16px period — divide major zones of the sheet.

Radius is reserved for handling, not paper: interactive controls 4px, small mono tags 3px,
floating overlays (dialog, toast) 6px, focus ring 2px. Content containers never round.

### Named Rules
**The Square Ticket Rule.** Ticket blocks, tables, and every content container are
square-cornered with registration corners. Rounding marks something you press or grab
(buttons, inputs, tags, overlays) — never something you read.

## Components

### Buttons
- **Shape:** control radius (4px); caption scale (12.5px), padding ~6px 12px.
- **Primary:** press red fill, cream-on-red text, weight 500. Hover deepens the red (~12% toward black). One primary per view region.
- **Secondary (default `btn`):** transparent fill, hairline border, ink text; hover raises the border to muted ink. Disabled: 40% opacity.
- **Link action** (`Retry`-style inline): press-red-text, 12.5px, underlined with 3px offset. Used inside ticket rows where a button would be too heavy.
- **Icon button:** 32px square hit target, transparent with hover hairline border, muted-ink glyph warming to ink.

### Inputs / Fields
- **Style:** ground-colored well one step below its surface, hairline border, control radius (4px), 8px 10px padding; placeholder in muted ink.
- **Focus:** the global focus ring — 2px press-red-text outline, 2px offset (no glow, no border swap). Caret is press-red-text.
- **Error:** border turns press red, message in press-red-text at 12.5px below the field, `aria-invalid` + described-by wiring. Field label 12.5px/500; helper text 12px muted.

### Cards / Containers (Ticket Blocks)
- **Corner Style:** square (0px) with four registration corners.
- **Background:** surface on ground; hairline border.
- **Label:** 10.5px uppercase ticket label floating over the top border on a surface-colored plug.
- **Internal Padding:** 18px.
- **Shadow:** none (see Elevation).

### Ticket Row (signature)
The atomic operation row, everywhere operations are listed. Fixed anatomy, in order:
**mark · brand · platform · state · time** — a 16px state mark, brand name (600), platform
in muted 12.5px, state label in its state color, mono time. Rows separate with dashed
hairlines; an inline link action (Retry) may follow the time. A `delivery_unknown` row may
carry a one-line muted explanation beneath, indented past the mark.

**The Ticket Anatomy Rule.** brand · platform · state · time, always in that order (flipped
visually by direction, never reordered). No row invents its own metadata arrangement.

### State Marks (signature)
Drawn SVG marks on a 16px grid, 1.5px stroke, one mark **and** one color per state:
- **Queued:** hollow square patch, neutral (currentColor).
- **Running:** square patch, bottom half filled, working amber.
- **Retrying:** running patch plus a small return tick, working amber (+ mono attempt counter `(n/m)` in the label).
- **Succeeded:** circle with check stamp, proof blue (mark stroke #4a7fb5 dark; #2f5d8a light).
- **Failed:** grease-pencil cross (1.8px stroke), press red.
- **Cancelled:** hollow square with a punched corner, neutral muted.
- **Delivery unknown:** folded flag on a post, working amber — deliberately distinct in shape from running, and always accompanied by its explanation text when space allows.

**The Pressed Mark Rule.** Every state is a mark+color pairing. Hue alone never carries
state; shape alone is legal (marks stay legible in forced-colors/grayscale). New states
get a new drawn mark on the same grid — never a dot, badge, or pill.

**The Drawn Mark Rule.** State marks are drawn in-house on the 16px/1.5px grid. No stock
icon sets (Lucide, Heroicons, emoji) for state. Generic chrome glyphs (menu, close, sun)
are drawn on the same stroke grammar.

**The Stamp Rule.** The stamp-press is the only state-transition motion: scale 1.5 → 1
with a fade-in, 260ms on a hard-settle ease (cubic-bezier(.16,1,.3,1)), applied to the
mark only. Nothing else animates a state change; removed entirely under reduced motion.

### Ops Color-Bar (signature)
The top-bar operations indicator: a press color-bar strip of 8×12px patches, one per
tracked operation — hollow neutral for queued, amber fill running, blue fill done, red
fill failed — followed by a mono count. It is a button opening the operations panel and
the shell's always-visible answer to "what is running right now."

### Navigation
- **Style:** job-bag index — 14px items with a 16px mark, muted ink at rest, control radius.
- **Hover:** ink text + hairline border. **Active:** ink text, press-red border, 8% press-red tint.
- **Future/disabled:** `aria-disabled` with a dashed mono phase tag (e.g. `P6`) at inline-end.
- **Collapsed rail (56px):** marks only, centered. **Mobile:** off-canvas overlay with scrim, inline-start entry.
- **Brand plate:** wordmark in a 1.5px ink-stroked plate — drawn type, not a logo image.

### Data Table
Hairline ledger: uppercase 10.5px ticket-label headers, 12.5px cells, start-aligned in both
directions, row hover at 3% ink tint, sortable headers with a drawn 1.5px sort arrow,
mono id/time columns. Toolbar above (search well + filter buttons); mono pager below.
Refetch dims the mounted rows to 45% with `aria-busy` + a polite live region — skeleton
rows (pulsing hairline bars) appear only before first data.

### Overlays
- **Ops panel:** inline-end sheet, `min(420px, 95vw)`, surface background, hairline start-border, overlay shadow; slides in 220ms ease-out from the inline edge (direction-aware), instant under reduced motion. Focus is trapped; Escape and scrim close; focus returns to the opener.
- **Dialog:** native `<dialog>` grammar — surface, hairline border, 6px radius, overlay shadow, max 400px; dashed hairline rail above end-aligned actions; destructive confirm is the primary red button.
- **Toast:** surface-2, hairline border, 6px radius, overlay shadow, anchored inset-block-end/inset-inline-end, carrying a stamped mark + short message, `role="status"`.
- **Reconnect band:** periphery status strip under the top bar — 18% amber tint over ground, amber block-end rule, flag mark; may slide in (250ms) because it is periphery, not read plane.

### Browser Surfaces
The world themes the browser itself: selection is press red with cream-on-red text; caret
is press-red-text; focus ring is the global 2px press-red-text outline at 2px offset;
scrollbars are thin, muted-ink on transparent. Skip link is a press-red plate at
inline-start.

## Do's and Don'ts

### Do:
- **Do** carry every state as its drawn mark + owned color pairing (16px grid, 1.5px stroke) with a text label; shape must survive grayscale.
- **Do** keep press red the only interactive accent, and reach for `press-red-text` (#ea6a5d) whenever red is text or caret on dark ground.
- **Do** separate with hairlines (ink at 14%/18%) — solid for primary rules, dashed for secondary — and reserve the one overlay shadow for true overlays.
- **Do** write all geometry in logical properties, derive direction from locale, isolate mixed-script runs with `<bdi>`, and format digits/dates per locale (Persian calendar in `fa`).
- **Do** show `delivery_unknown` as its own flagged state with its explanation — ambiguous is a first-class outcome.
- **Do** keep the ticket-row anatomy fixed: brand · platform · state · time.
- **Do** dim mounted content (45%, `aria-busy`, live region) on refetch; skeletons only before first data.

### Don't:
- **Don't** use proof blue or working amber outside the state-mark system, or communicate state by hue alone.
- **Don't** use stock icon sets, emoji, dots, badges, or pills for state — marks are drawn on the house grid.
- **Don't** round, shadow, or float content containers; ticket blocks are square with registration corners.
- **Don't** animate the read plane. The stamp-press (260ms, mark only) is the sole state-transition motion; periphery motion stills completely under `prefers-reduced-motion`.
- **Don't** uppercase or letter-space Arabic-script UI (`data-script="arab"`), or ship a physical left/right property in anything that renders under `dir="rtl"`.
- **Don't** copy prototype markup, class names, hardcoded mark hexes, or its JS — re-express through `packages/ui` semantic tokens and owned components.
- **Don't** add gradients, glows, blur, or glass; the world is paper, ink, and pressed marks.
