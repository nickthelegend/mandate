# Design System: Outcome — The Assay Office

## Overview

**The world: a hallmarking assay office.** Not a metaphor bolted on — the same
mechanism, seven centuries earlier.

A silversmith strikes a piece "STERLING". That is a claim, made by the party who
benefits from it. The assay office scrapes the metal, tests it against a
touchstone, and only then strikes **its own** punch beside the maker's. You read
a hallmark right to left: who made it, who *checked* it, what standard it met,
when.

Maker's mark = the facilitator's `success: true`.
Assay mark = the receipt read.
Struck into the metal = written on chain.
"STERLING" with no assay punch = `status: 0x1` with no `Transfer`.

The surface is **sterling against touchstone**: bright polished sheet for the
register, basalt black for the bench where specimens are tested. Marks are cut
into the ground rather than printed on it.

**What this refuses.** Two things, and the second one matters more.

The first is the incumbent that came before this world: near-black with an
emerald accent, glowing dots, monospace as costume — the "near-black plus one
neon accent" cluster.

The second is the *first rendition of this world*, which is the failure this
system was rewritten to correct. It kept the concept and shipped it as flat
mid-grey: `--sheet`, `--bench` and `--rule` all sat inside 14% lightness, so a
form, a summary figure and a table carried identical weight and the page read as
a wireframe. **A pinned world pins the world, not its softest rendition.** The
material range between polished sterling and touchstone black is the design; a
palette that collapses it has not built this world, only named it.

## Colors

Strategy: **Full palette, four roles.** A bright metal ground, a genuinely dark
stone ground that owns whole regions, one ink, and one saturated punch colour
that appears only where a verdict is struck. Colour never carries a verdict
alone — every state survives greyscale via its mark shape.

### Primary

`--ink: oklch(0.17 0.022 250)` — iron-gall, the register hand. Blue-black, and
it browns rather than greys as it lightens, exactly as the real ink ages.

### Secondary

`--touchstone: oklch(0.232 0.018 250)` — the basalt slab a streak is drawn on.
A **ground**, not a tinted card: it owns the masthead, the first viewport and the
close, and text inside it flips to sterling. `--touchstone-rule: oklch(0.34 0.02 250)`
rules it.

### Tertiary

`--assay: oklch(0.505 0.205 27)` — assay red. The wax seal, the crucible at heat,
the ink a register uses to strike a rejection. Three values exist because one
cannot clear 4.5:1 against both grounds: `--assay-ink` (0.44) carries small type
on sterling, `--assay-lit` (0.66) carries it on touchstone.

### Neutral

- `--sheet: oklch(0.965 0.003 240)` — polished sterling, the page ground. Cool.
- `--bench: oklch(0.905 0.007 240)` — the bench beneath, for recessed fields.
- `--rule: oklch(0.775 0.012 240)` — register rules.
- `--quiet: oklch(0.468 0.016 240)` — secondary text on sterling.
- `--sheet-inv` / `--quiet-inv` — the same pair read against touchstone.
- `--struck: oklch(0.38 0.032 250)` — oxidised silver, inside a punch recess.

### Named Rules

- **Assay red is a verdict, not an accent.** It appears on a struck mark, a
  rejection rule, or a refusal. It never fills a hero, a button row, or a
  section band.
- **The ground is cool.** Any warm cast means the palette drifted toward the
  cream default; correct it at the token, not per component.
- **Keep the range.** Sterling and touchstone must stay far apart in lightness.
  If a new neutral lands between `--bench` and `--rule`, ask what it is for; the
  previous rendition died of exactly that crowding.

## Typography

**Archivo** (variable, 400/500/600/700, Expanded widths for marks) and
**Geist Mono** for every figure, hash and address. `--font-sans` is Archivo, so
body copy is the same voice as the display — a system stack here would leave the
page half-dressed.

Archivo is a high-pressure grotesque with flat sides and tight apertures — the
letterform of a punch struck into metal rather than drawn on paper. Its Expanded
optical width is what makes a cartouche read as struck rather than typeset.

### Hierarchy

- **Punch** — Archivo Expanded 700, `0.1em` tracking, uppercase, 10–11px. Inside
  cartouches and the wordmark only.
- **Display** — Archivo 600, `-0.035em`, `clamp(2.5rem, 1.4rem + 4.2vw, 5rem)`.
  Statements the page will defend. The landing headline is the only 5rem on the
  site.
- **Page title** — Archivo 600, `-0.03em`, `clamp(1.875rem, 1.2rem + 2.4vw, 3.25rem)`.
- **Body** — Archivo 400, 1rem/1.6, measure capped at 68ch.
- **Register** — Geist Mono 400, `0.8125rem`, tabular figures always on. Every
  hash, address, amount, and timestamp.
- **Rubric** — Archivo 500, `0.6875rem`, `0.09em` tracking, uppercase. Column
  heads and field labels only.

### Named Rules

- **Figures never change width.** `font-variant-numeric: tabular-nums` is on at
  `body`. A number that reflows while loading is a number the reader cannot
  trust.
- **No numbered section labels.** "01 / 02 / 03" over headings is the device the
  incumbent used; a register numbers its *entries*, never its chapters.
- **One kicker, not an eyebrow everywhere.** The rubric above a page title is a
  named device. It does not get repeated over every section on the page.

## Layout

A **register page**: `.shell` is the single column — `max-width: 72rem`, 1.25rem
gutter rising to 2rem at 768px. Every route uses it, so nine surfaces share one
left edge.

**Hard left alignment; body content is never centred.** A narrow measure is a
`max-w-*` wrapper *inside* the shell, left-aligned — not a narrower centred
shell, which visibly indents a page's body away from its own masthead.

Spacing is a register's: `4 / 8 / 12 / 20 / 32 / 52 / 84` (px). More space above
a heading than below it, always.

Rules do the work borders would: a hairline `--rule` under every row, a 2px
`--ink` rule under a column head. **Containers do not nest.** A struck field sits
directly on the sheet; there is no card inside a card.

### The masthead band

Every interior route opens with `PageHead`: a band of touchstone carrying rubric
and title, with the work itself below on sterling. That split is what makes nine
routes read as one product without giving a working surface a dark ground it has
no use for.

## Elevation & Depth

**Struck, not floated.** Depth here is displacement — metal pushed down by a
punch — so it reads as an inset, never a drop shadow.

### Shadow Vocabulary

- `--strike`: `inset 0 1px 0 var(--rule), inset 0 -1px 0 oklch(1 0 0 / 0.75)` —
  the recess and the burr of raised metal at its lower edge.
- `--strike-deep`: the same, deeper. Pressed state.
- `--strike-dark`: the touchstone equivalent, for marks on the stone.
- Nothing else. No `box-shadow` that lifts an element off the page.

### Named Rules

- **Generic drop shadows are banned**, but the struck inset is this world's
  native depth and is required on cartouches, plates and fields. A prohibition
  that banned it would be banning the world's own material.
- **A field's rule is an inset, not a border.** `.field` draws its underline with
  `inset 0 -2px 0` so the rule belongs to the same strike that recesses it — a
  2px bottom border on a radiused box fights its own corners.

## Shapes

Radius `2px` everywhere — the softened corner of a punch, not a rounded card.
Cartouches are the exception: each mark sits in an authored SVG shield whose
silhouette encodes its meaning (see Signature Component).

## Components

### Buttons

Struck plates. `--bench` ground, `--ink` text, `--strike` inset, `2px` radius,
Rubric type. The primary carries a 2px `--ink` bottom rule — the burr the punch
throws up. Active deepens the inset by 1px and moves the plate 1px down: the
plate takes the blow. No fill animation, no gradient. On touchstone, `--lit` is
polished metal and `--ghost` is an outline cut into the stone.

### Chips

Not used. A state is a cartouche, not a pill.

### Cards / Containers

A **field**: `--sheet` ground, hairline `--rule` border, `2px` radius, no shadow.
Fields never nest. A recessed field uses `--bench` and `--strike`. On the stone,
a **specimen** is metal laid out for testing: a brushed graduation with
`--strike-dark`, carrying a `.streak` — the drawn metal itself, silver when
proven and assay red when refused.

### Inputs / Fields

A ruled blank in a register: `.field` on `--bench`, no box outline, an inset rule
beneath that darkens to `--ink` on focus and `--assay` when invalid. Mono type,
because everything typed here is a hash.

### Navigation

A horizontal rule of Rubric labels on touchstone, with a 2px `--sheet-inv`
underline on the current entry. No pill, no side tab, no background fill.

### Signature Component — the Hallmark Strip

**The product's whole argument in one component.** A settlement renders as a row
of struck cartouches, read left to right:

1. **Maker's mark** — a lozenge carrying the facilitator's claim. Always struck,
   because a claim is always made.
2. **Assay mark** — a shield. Struck **only** when the receipt proved it. Its
   absence is the point: an unproven settlement shows an empty, incised outline
   in assay red where the assay mark should be.
3. **Standard** — the observed amount, in Register type.
4. **Date letter** — the timestamp, in an Expanded punch cartouche.

The empty assay shield is the strongest thing on the page. It is what a judge
remembers: the maker said sterling and nobody countersigned.

Motion: a mark is **struck**, never faded — one 150ms blow on resolve, easing
`--ease-strike`. Not an entrance: a strip already on screen does not re-strike on
scroll, and `prefers-reduced-motion` renders the settled state.

## Do's and Don'ts

### Do:

- Put a claim and its proof in the same viewport.
- Render "not known yet" as an unstruck outline or an em dash, distinct from zero.
- Keep hashes and addresses exact and copyable; abbreviate for the eye only.
- Draw marks as authored SVG in this world's grammar.
- Let touchstone own whole regions — masthead, first viewport, close.

### Don't:

- Gradients as decoration, glassmorphism, blur backdrops, glowing edges, pulsing
  dots. (A brushed-metal graduation on a specimen is material, not decoration.)
- Emerald-on-near-black. That is the incumbent and the category default.
- Nested cards, pill nav, side tabs, numbered section labels.
- **A coloured `border-left` on a panel, callout or alert.** It is the single
  most recognisable tell of a generated interface. A register rules the *head* of
  a refused entry in the other ink; it does not paint the margin.
- The hero-metric template: four cards of big-number-over-small-label. Standing
  totals are one ruled line at the foot of the record.
- Drop shadows that lift. Depth is struck.
- Colour as the only carrier of a verdict.
- A `.plate a { color }`-style descendant rule that outranks the controls inside
  it. It once rendered the primary action as sterling on sterling, invisible.
