# Design System: Outcome — The Tape

## Overview

**The world: a ticker tape coming off the wire.** Not a metaphor bolted on — the
same argument, a century earlier.

A stock ticker never summarised the wire. It *printed* it, and the paper tape
was the thing brokers settled arguments with. If someone told you the trade had
cleared, the tape either carried the line or it did not, and no amount of
insisting changed what the print head had struck.

The facilitator's `success: true` = what somebody says came over the wire.
The receipt's logs = the tape.
`status: 0x1` with no `Transfer` = a run of tape with the line missing.
Reading the receipt = reading the tape instead of the summary of it.

The absent line is the product. A settlement that mined and moved nothing prints
as a run whose `TRANSFER` line is **reserved and ruled through** rather than
quietly omitted — an omitted line reads as an oversight; a struck one reads as a
finding.

**What this refuses.** Three things, and the third is the one that keeps
resurfacing.

1. Near-black with a neon accent and glowing edges — the category's console.
2. Cream paper with an editorial serif and a terracotta accent — the category's
   predictable opposite.
3. **The struck-metal assay office this project shipped twice before it.** Cool
   sterling greys, iron-gall ink, punched shields, Archivo. It was a coherent
   world and it is not this one; nothing from it survives here. A replacement
   world replaces, and polishing the discarded look is the failure mode this
   file exists to prevent.

## Colors

Strategy: **Full palette, four roles.** Cold stock, one ink that is emphatically
not black, a second ribbon reserved for absence, and the machine's own iron as a
band. Colour never carries a verdict alone — a struck-through line and a
doubled stamp border survive greyscale.

### Primary

`--ribbon: oklch(0.245 0.075 305)` — aniline violet. The ink an early ticker and
a telegraph actually printed in, and the single decision that stops this surface
reading as grey. `--ribbon-soft` (0.455) is secondary text; `--ribbon-ghost`
(0.635) is disabled and unread.

### Secondary

`--iron: oklch(0.205 0.028 300)` — japanned iron, the machine's body. A **band**,
never the page: it carries the masthead, the first viewport and the close, and
text inside it flips to `--stock-inv`. Ruled by `--iron-rule`.

### Tertiary

`--ribbon-red: oklch(0.505 0.195 25)` — the second half of the spool. An impact
head carried black and red on one ribbon, and red was for the line you were
meant to stop at. It marks an **absence or a refusal**, never a section, a
heading or a button row. `--ribbon-red-ink` (0.435) carries small type on stock;
`--ribbon-red-lit` (0.68) carries it on iron.

### Neutral

- `--stock: oklch(0.962 0.004 250)` — tape stock. **Cold, never cream.**
- `--stock-edge: oklch(0.925 0.006 250)` — recessed fields and banded regions.
- `--perf: oklch(0.80 0.008 250)` — perforations, feed holes, dashed tears.
- `--stock-inv` / `--ribbon-inv` — the same pair read against iron.

### Named Rules

- **The ink is violet, not black.** If a new value lands at chroma 0 it is grey,
  and grey is the previous world. Tint from `--ribbon`.
- **The stock is cold.** Any warm cast is drift toward the paper-and-serif
  default; correct it at the token, not per component.
- **Red is an absence.** It appears on a struck-through line, a refused stamp, or
  a rejected field. It never fills a heading, a band, or a primary action.

## Typography

**Martian Mono** for the machine — headlines, labels, prose, everything the page
itself says — and **Courier Prime** for the tape, which is everything the wire
sent.

A printout has one advance width because one mechanism made it, so monospace
here is the world's material rather than a costume for "technical". Two faces,
not one, because a tape came off a lighter and older mechanism than the machine's
engraved label plates, and that difference is what makes an impression read as
something the page *received* rather than something it wrote.

`body` runs `font-stretch: 87.5%` and `letter-spacing: -0.02em`: Martian Mono is
wide by default and the wire ran narrow.

### Hierarchy

- **Headline** — Martian Mono 700, `-0.05em`, `clamp(2rem, 1.1rem + 3.4vw, 4rem)`.
  Two or three words per line; a wide mono at display size needs the break.
- **Page title** — Martian Mono 600, `-0.03em`, `clamp(1.875rem, 1.2rem + 2.4vw, 3.25rem)`.
- **Body** — Martian Mono 400, 1rem/1.6, measure capped at 68ch.
- **Impression** (`.impression`) — Courier Prime 400, `0.8125rem`/1.75, tabular.
  Every hash, address, amount, timestamp, and every line of tape.
- **Label plate** (`.plate-label`) — Martian Mono 500, `0.625rem`, `0.14em`
  tracking, uppercase. Channel names and field labels only.

### Named Rules

- **Figures never change width.** `tabular-nums` is on at `body`. A digit that
  reflows mid-read is a digit the reader cannot trust.
- **Courier is reserved for received content.** If the page is asserting it, it
  is Martian; if the wire sent it, it is Courier. Blurring that erases the only
  distinction the two faces exist to make.
- **No numbered section labels, no eyebrow over every section.** One named plate
  above a page title is a system; repeating it is grammar you did not choose.

## Layout

One column: `.shell`, `max-width: 74rem`, 1.25rem gutter rising to 2rem at 768px.
Every route uses it, so nine surfaces share one left edge.

**Hard left alignment; body content is never centred.** A narrow measure is a
`max-w-*` wrapper *inside* the shell, left-aligned — not a narrower centred
shell, which visibly indents a page's body away from its own masthead.

**Nothing is boxed.** Division is by perforation (`.perforation`, a dashed rule),
by feed margin, or by the operator's double rule at the head of a run
(`.run`, `3px double`). A card is a container this world does not have.

`--radius: 0` everywhere. Nothing in this world was moulded.

### The machine band

Every interior route opens with `PageHead`: a band of iron naming the channel,
with the tape it produced running below on stock. That split is what makes nine
routes read as one product without giving a working surface a dark ground it has
no use for.

## Elevation & Depth

**Impression, not elevation.** Ink pressed into stock leaves a slight dish, and a
key sits above its own hard shadow — nothing floats and nothing glows.

### Shadow Vocabulary

- `--impress`: `inset 0 1px 0 oklch(1 0 0 / 0.85), inset 0 -1px 0 var(--stock-edge)`
  — the dish a print head leaves.
- `--impress-deep`: a violet-tinted inset for a pressed field.
- `2px 2px 0 0` hard offset — a key's own side. No blur, because a keycap does
  not cast a soft shadow at arm's length; pressing collapses it to `0 0`.

### Named Rules

- **No blurred drop shadows.** The hard offset is the world's native depth and is
  required on keys; a prohibition banning it would ban the world's own material.
- **A field's rule is an inset, not a border.** `.field` draws its underline with
  `inset 0 -2px 0` so the rule belongs to the same impression that dishes it.

## Components

### Buttons — keys

Square, bordered in `--ribbon`, carrying a `2px 2px 0` hard offset. Pressing
translates the cap `2px 2px` into its own shadow and closes it: the travel *is*
the feedback, so no colour change announces it. `--lit` is a bone keycap on
iron with a red shadow; `--ghost` is an outline cut into the machine;
`--quiet` drops the shadow entirely.

### Chips

Not used. A state is a stamp, not a pill.

### Cards / Containers

None. A region is a `.tape` (feed margins, impressed stock), a `.run` of rows
parted by perforations, or a band of `.iron`. Containers never nest.

### Inputs / Fields

`.field` on `--stock-edge`: no box, no radius, an inset rule beneath that
darkens to `--ribbon` on focus and `--ribbon-red` when invalid.

### Navigation

A row of label-plate legends on iron, the current one underscored. No pill, no
side tab, no background fill.

### Signature Component — the tape

**The product's whole argument as one run of stationery.** A settlement renders
as a strip of tape with feed holes down both margins, carrying fixed-width
lines:

```
CLAIM      SUCCESS: TRUE
TRANSFER   1000000 RECEIVED        ← or, struck through, NO SUCH LINE ON THIS TAPE
MOVED      1000000                 ← red when zero
AT         09:22:16
```

The struck `TRANSFER` line is the strongest thing on the page and the one a
judge remembers: the machine reserved the space, and nothing printed in it.

Motion: the head advances one line on resolve — a 160ms travel, not a fade. Not
an entrance: a run already on screen does not re-print on scroll, and
`prefers-reduced-motion` renders the settled tape.

### Verdict stamps

Pressed by hand, so set at `-1.5deg` and never quite square to the line. Three
silhouettes, not three colours: a filled disc (`on tape`), an open ring struck
through in a doubled border (`not on tape`), and a dashed open ring (`unread`).

## Do's and Don'ts

### Do:

- Put a claim and its proof in the same viewport.
- Reserve and strike through a line that did not print; never omit it.
- Render "not known yet" as an em dash, distinct from zero.
- Keep hashes and addresses exact and copyable; abbreviate for the eye only.
- Let iron own whole bands — masthead, first viewport, close.

### Don't:

- Gradients, glassmorphism, blur backdrops, glowing edges, pulsing dots.
- Any grey with zero chroma standing in for the ink. The ink is violet.
- Cards, nested containers, pill nav, side tabs, numbered section labels.
- **A coloured `border-left` on a panel, callout or alert.** It is the single
  most recognisable tell of a generated interface. A run is opened by a rule
  across its *head*, never down its margin.
- The hero-metric template: four cards of big-number-over-small-label. Standing
  totals are one printed line at the foot of the run.
- Blurred drop shadows. Depth is impression and hard offset.
- Colour as the only carrier of a verdict.
- A descendant rule like `.iron a { color }` that outranks the single-class
  controls inside it. That once rendered a primary action invisible.
