# Design System: Outcome on Polaris

## Overview

**Outcome is a Polaris product and looks like one.** The system here is not
invented for this repo — it is Polaris's own, ported from `polaris-landing`:
brand blue `#1c6fd0`, the lime action colour `#a6f24a`, the near-black navy
surfaces, the Untitled-UI grey ramp, Poppins, generous radii, and the soft
low-opacity shadow.

This file records that port and the one thing Outcome adds.

**What Outcome adds, and only this:** a verdict pair. No payments UI ships with
the state this product exists to render — a settlement that *succeeded* and
still paid nobody. That is `--proven` / `--refused`, and everything else on this
page is Polaris's.

**What this replaced, and why it must not come back.** Three visual worlds were
built here before this one and all three were rejected: a near-black console
with an emerald accent, a struck-metal assay office in sterling greys, and a
ticker-tape world in violet on newsprint. They were coherent and they were not
the brand. Outcome does not get its own visual identity; it inherits Polaris's.
Any future change that starts by inventing a world has already gone wrong.

## Colors

Strategy: **Polaris's own.** A white product surface, navy for full-bleed
sections, brand blue for anything interactive, and the lime spent once per view
on the single action that matters.

### Primary

`--brand: #1c6fd0` — Polaris blue. Links, active nav, primary buttons, and the
*proven* verdict. `--brand-ink: #0a4f9e` for hover and small text;
`--brand-wash: #eef5fd` for tinted backgrounds.

### Action

`--lime: #a6f24a` on `--lime-ink: #05080f`. Polaris puts this in a pill, on
dark, on the one thing it wants pressed. **Once per view.** It is not a
success colour, not a status, and never a border.

### Surfaces

- `--navy: #0a0e16` / `--navy-raised: #0c111b` / `--navy-line: #1b2231`
- `--page: #ffffff`, `--surface: #f7f8fa`, `--panel: #fbfcff`

### Text ramp

`--ink: #101828` · `--ink-2: #475467` · `--ink-3: #667085` · `--ink-4: #98a2b3`,
and on navy: `#ffffff` · `--on-navy-2: #cbd0d8` · `--on-navy-3: #8a93a3`.

### Verdicts

`--proven: #1c6fd0` on `--proven-wash: #eef5fd`, and `--refused: #d92d20` on
`--refused-wash: #fef3f2`.

**Proven deliberately borrows the brand blue rather than inventing a green.** A
proof is not a success message. Green would make "proven" read as congratulation
when it is a finding, and it would collide with the lime, which is an action.

### Named Rules

- **Lime is an action, never a state.** If it is not a button the visitor should
  press, it is not lime.
- **Blue means both interactive and proven**, and that is intentional: in this
  product the thing you click and the thing that was verified are the same
  colour family because they are the same argument.
- **Red means refused, never "error".** A refund is the system working
  correctly. Copy around red must not apologise.

## Typography

**Poppins** (400/500/600/700) — Polaris's face, via `--font-poppins`. Headings
are 700 with `-0.03em` tracking, which is how Polaris sets its own.

**Geist Mono** for every hash, address, amount and timestamp, via `.figure`.
`tabular-nums` is on at `body`: a digit that reflows mid-read is a digit the
reader cannot trust.

### Hierarchy

- **Hero** — Poppins 700, `-0.035em`, `clamp(2.25rem, 1.5rem + 2.6vw, 3.75rem)`.
- **Page title** — Poppins 700, `-0.03em`, `clamp(1.75rem, 1.2rem + 2vw, 2.75rem)`.
- **Section** — Poppins 700, `-0.025em`, 1.5–1.875rem.
- **Body** — Poppins 400, 15–17px, measure capped around 68ch.
- **Eyebrow** (`.eyebrow`) — Poppins 600, 12px, with a lime dot. One per page,
  above the title. Never repeated over every section.

## Layout

`.shell` — `max-width: 76rem`, 1.25rem gutter rising to 2rem at 768px. Every
route uses it, so every surface shares one left edge.

Full-bleed navy sections (`.on-navy`) alternate with white and `--surface`
bands. `.dotfield` is Polaris's dotted paper texture for a light section that
needs to sit apart without a border.

Radii: 10px fields, 14px cards, `999px` buttons.

## Elevation & Depth

Polaris shadows are almost invisible and that is the point — they separate, they
do not lift.

- `--shadow-sm: 0 1px 6px rgba(16, 24, 40, 0.035)` — cards, buttons, fields.
- `--shadow-md`, `--shadow-lg` for the rare raised panel.

Buttons and links rise `translateY(-1px)` on hover. That 1px is Polaris's whole
interaction signature; do not replace it with a scale or a glow.

## Components

### Buttons (`.btn`)

Pills. `--brand` for ordinary primary actions, `--lime` for the one action per
view, `--outline` on white, `--ghost-navy` on dark.

### Cards (`.card-p`)

White, 1px `--line`, 14px radius, `--shadow-sm`. `--flat` drops to `--surface`
with no shadow; `--navy` is the dark-section variant.

### Fields (`.field`)

White, 1px `--line`, 10px radius. Focus is a `--brand` border plus a 4px
`--brand-wash` ring. Invalid swaps both to red.

### Verdict (`.verdict`)

A pill carrying a mark. The mark carries the state so it survives greyscale: a
filled disc for proven, a struck ring for refused, an open ring for awaiting.

### Settlement (`.settlement`)

The signature component. One settlement rendered as a statement line, with the
two facts that matter side by side and never moving: **what the facilitator
claimed** and **what the chain actually moved**. Putting them in one row is the
argument — the reader does not have to hold two numbers across a scroll to
notice they disagree.

### The mark

A ring in Polaris blue with a gap at the top right, and a check in the lime
entering *through* that gap. The claim is the circle; the proof comes from
outside it. Drawn as inline SVG (`components/logo.tsx`), also at
`public/outcome-mark.svg`.

## Do's and Don'ts

### Do:

- Put a claim and its proof in the same viewport.
- Spend the lime once per view, on the thing you want pressed.
- Keep hashes exact and copyable; abbreviate for the eye only.
- Render "not known yet" as an em dash, distinct from zero.

### Don't:

- Invent a visual world for Outcome. It is a Polaris product.
- Use green for proven, or lime for anything that is not an action.
- Add a fifth item to the header nav. Four is the demo path; the rest is footer.
- Gradients as decoration, glassmorphism, glowing edges, pulsing dots.
- Nested cards, or a coloured `border-left` on a callout.
- The hero-metric template: four cards of big-number-over-small-label.
