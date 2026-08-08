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

Strategy: **Polaris's own, dark-first.** Polaris runs a dark shell with light
dashboard panels inside it. Outcome is all shell — there is no dashboard here,
only argument and evidence — so the light panels went and the navy carries the
whole product. Brand blue for anything interactive, and the lime spent once per
view on the single action that matters.

Three levels of navy give sections rhythm without a white slab between them:
`--deep #070a11` for hero and closing bands, `--page #0d121c` for the run of the
page, `--surface #121926` for cards and raised bands.

### Primary

`--brand: #1c6fd0` — Polaris blue. Links, active nav, primary buttons, and the
*proven* verdict. `--brand-ink: #4b95e8` for hover; `--brand-lit: #7db4f2` for links and
small text; `--brand-wash` is a translucent blue for tinted backgrounds.

### Action

`--lime: #a6f24a` on `--lime-ink: #05080f`. Polaris puts this in a pill, on
dark, on the one thing it wants pressed. **Once per view.** It is not a
success colour, not a status, and never a border.

### Surfaces

- `--deep: #070a11` · `--page: #0d121c` · `--surface: #121926` · `--panel: #161e2c`
- Lines: `--line: #202939`, `--line-2: #2a3446`

### Text ramp

`--ink: #ffffff` · `--ink-2: #ccd3de` · `--ink-3: #98a2b3` · `--ink-4: #6b7482`.

**Blue at full saturation is unreadable as text on navy.** `--brand #1c6fd0` is
for fills only; `--brand-lit #7db4f2` carries links and small type.

### Verdicts

`--proven: #7db4f2` on a translucent blue wash, and `--refused: #fda29b` on a
translucent red one. Both washes are `rgba` so a settlement card tints the
surface beneath it rather than punching a flat block into the page.

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

`.on-navy` drops a section to `--deep` — it no longer flips colour, it drops a
step, which is what still makes a hero or a closing band read as separate.
`.dotfield` is Polaris's dotted texture, dimmed for the dark ground, for a
section that needs to sit apart without a border.

Radii: 10px fields, 14px cards, `999px` buttons.

## Elevation & Depth

On a dark ground a cast shadow does nothing — separation comes from a lighter
top edge instead.

- `--shadow-sm: inset 0 1px 0 rgba(255,255,255,0.04)` — cards, buttons, fields.
- `--shadow-md`, `--shadow-lg` are real cast shadows, for the rare floating panel.

Buttons and links rise `translateY(-1px)` on hover. That 1px is Polaris's whole
interaction signature; do not replace it with a scale or a glow.

## Components

### Buttons (`.btn`)

Pills. `--brand` for ordinary primary actions, `--lime` for the one action per
view, `--outline` for a raised secondary, `--ghost-navy` for a translucent one.

### Cards (`.card-p`)

`--surface`, 1px `--line`, 14px radius, `--shadow-sm`. `--flat` drops to
`--panel` with no edge highlight.

### Fields (`.field`)

`--surface`, 1px `--line-2`, 10px radius. Focus lifts the background to
`--panel`, borders in `--brand-lit`, and adds a 4px `--brand-wash` ring. Invalid
swaps both to red.

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
- Introduce a white or near-white surface. The product is dark-first; a light
  slab between navy sections is the thing this revision removed.
- Use green for proven, or lime for anything that is not an action.
- Add a fifth item to the header nav. Four is the demo path; the rest is footer.
- Gradients as decoration, glassmorphism, glowing edges, pulsing dots.
- Nested cards, or a coloured `border-left` on a callout.
- The hero-metric template: four cards of big-number-over-small-label.
