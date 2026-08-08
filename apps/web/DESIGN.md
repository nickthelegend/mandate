# Design System: Outcome — The Assay Office

## Overview

**The world: a hallmarking assay office.** Not a metaphor bolted on — the same
mechanism, seven centuries earlier.

A silversmith strikes a piece "STERLING". That is a claim, made by the party who
benefits from it. The assay office scrapes the metal, tests it, and only then
strikes **its own** punch beside the maker's. You read a hallmark right to left:
who made it, who *checked* it, what standard it met, when.

Maker's mark = the facilitator's `success: true`.
Assay mark = the receipt read.
Struck into the metal = written on chain.
"STERLING" with no assay punch = `status: 0x1` with no `Transfer`.

The surface is a **bench and a register**: cool sheet metal, iron-gall ink, and
marks struck into the ground rather than printed on it.

**What this refuses.** The incumbent site was near-black with an emerald accent,
glowing dots, and monospace everywhere — which is precisely the "near-black with
one neon accent and glowing edges" cluster Impeccable names as an AI default.
The predictable opposite, warm cream paper with a display serif and a terracotta
accent, is the same failure in different clothes. Neither is here. Sterling is
**cool**, not warm; the ground has blue in it, not yellow.

## Colors

Strategy: **Restrained, struck.** A metal ground, one ink, and a single
saturated punch colour that appears only where a verdict is struck. Colour never
carries a verdict alone — every state survives greyscale via its mark shape.

### Primary

`--ink: oklch(0.22 0.02 250)` — iron-gall, the register hand. Blue-black, and it
browns rather than greys as it lightens, exactly as the real ink ages.

### Secondary

`--assay: oklch(0.52 0.19 25)` — assay red. The wax seal, the crucible at heat,
and the ink a register uses to strike a rejection. The only saturated colour on
the surface; it marks a verdict, never decorates a section.

### Tertiary

`--struck: oklch(0.42 0.05 250)` — oxidised silver, the darkness that collects in
the recess of a punch. Used for the inside of struck marks and for proven state.

### Neutral

- `--sheet: oklch(0.94 0.004 250)` — sterling sheet, the page ground. Cool.
- `--bench: oklch(0.90 0.006 250)` — the bench beneath, for recessed fields.
- `--rule: oklch(0.80 0.008 250)` — register rules.
- `--quiet: oklch(0.52 0.012 250)` — secondary text.

### Named Rules

- **Assay red is a verdict, not an accent.** It appears on a struck mark, a
  rejection rule, or a refusal. It never fills a hero, a button row, or a
  section band.
- **The ground is cool.** Any warm cast means the palette drifted toward the
  cream default; correct it at the token, not per component.

## Typography

**Archivo** (variable, 400/500/600/700, and Expanded widths for marks) and
**Geist Mono** for every figure, hash and address.

Archivo is a high-pressure grotesque with flat sides and tight apertures — the
letterform of a punch struck into metal rather than drawn on paper. It is
deliberately none of the faces the model reaches for by default, and its
Expanded optical width is what makes a date-letter cartouche read as struck
rather than typeset.

### Hierarchy

- **Punch** — Archivo Expanded 700, tight tracking, small caps sizes. Used only
  inside cartouches and for the wordmark.
- **Display** — Archivo 600, `-0.02em`, 2.5–4rem. Statements the page will
  defend.
- **Body** — Archivo 400, 1rem/1.6.
- **Register** — Geist Mono 400, `0.8125rem`, tabular figures always on. Every
  hash, address, amount, and timestamp.
- **Rubric** — Archivo 500, `0.6875rem`, `0.08em` tracking, uppercase. Column
  heads and field labels only.

### Named Rules

- **Figures never change width.** `font-variant-numeric: tabular-nums` is on
  globally for mono. A number that reflows while loading is a number the reader
  cannot trust.
- **No numbered section labels.** "01 / 02 / 03" over headings is the device the
  incumbent used; a register numbers its *entries*, never its chapters.

## Layout

A **register page**: one column of ruled entries, generous outer margin, and a
hard left alignment that never centres body content. Max width `72rem`.

Spacing scale is a register's: `4 / 8 / 12 / 20 / 32 / 52 / 84` (px). More space
above a heading than below it, always.

Rules do the work borders would: a hairline `--rule` under every row, a 2px
`--ink` rule under a column head. **Containers do not nest.** A struck field sits
directly on the sheet; there is no card inside a card.

## Elevation & Depth

**Struck, not floated.** Depth here is displacement — metal pushed down by a
punch — so it reads as an inset, never a drop shadow.

### Shadow Vocabulary

- `--strike`: `inset 0 1px 0 var(--rule), inset 0 -1px 0 oklch(1 0 0 / 0.8)` —
  the recess and the burr of raised metal at its lower edge.
- Nothing else. No `box-shadow` that lifts an element off the page.

### Named Rules

- **Generic drop shadows are banned**, but the struck inset is this world's
  native depth and is required on cartouches. A prohibition that banned it would
  be banning the world's own material.

## Shapes

Radius `2px` everywhere — the softened corner of a punch, not a rounded card.
Cartouches are the exception: each mark sits in an authored SVG shield whose
silhouette encodes its meaning (see Signature Component).

## Components

### Buttons

Struck plates. `--bench` ground, `--ink` text, `--strike` inset, `2px` radius,
Rubric type. Primary carries a 2px `--ink` bottom rule. Active state deepens the
inset by 1px — the plate takes the blow. No fill animation, no gradient.

### Chips

Not used. A state is a cartouche, not a pill.

### Cards / Containers

A **field**: `--sheet` ground, hairline `--rule` border, `2px` radius, no shadow.
Fields never nest. A recessed field uses `--bench` and `--strike`.

### Inputs / Fields

A ruled blank in a register: no box, a 1px `--rule` underline that becomes 2px
`--ink` on focus. Mono type, because everything typed here is a hash.

### Navigation

A horizontal rule of Rubric labels with a 2px `--ink` underline on the current
entry. No pill, no side tab, no background fill.

### Signature Component — the Hallmark Strip

**The product's whole argument in one component.** A settlement renders as a row
of struck cartouches, read left to right:

1. **Maker's mark** — a lozenge carrying the facilitator's claim. Always struck,
   because a claim is always made.
2. **Assay mark** — a shield. Struck **only** when the receipt proved it.
   Its absence is the point: an unproven settlement shows an empty, incised
   outline where the assay mark should be.
3. **Standard** — the observed amount, in Register type.
4. **Date letter** — the timestamp, in an Expanded punch cartouche.

The empty assay shield is the strongest thing on the page. It is what a judge
remembers: the maker said sterling and nobody countersigned.

Motion: a mark is **struck**, never faded — 90ms deboss, 60ms settle, once, on
resolve. Respects `prefers-reduced-motion` by rendering the settled state.

## Do's and Don'ts

### Do:

- Put a claim and its proof in the same viewport.
- Render "not known yet" as an unstruck outline, distinct from zero.
- Keep hashes and addresses exact and copyable; abbreviate for the eye only.
- Draw marks as authored SVG in this world's grammar.

### Don't:

- Gradients, glassmorphism, blur backdrops, glowing edges, pulsing dots.
- Emerald-on-near-black. That is the incumbent and the category default.
- Nested cards, pill nav, side tabs, numbered section labels.
- Drop shadows that lift. Depth is struck.
- Colour as the only carrier of a verdict.
