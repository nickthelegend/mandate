# Design System: Outcome

## Overview

A light product surface with one orange doing all the work, a near-black pill
for the primary action, and every page opening inside a clipped, rounded frame.
Inter throughout, with Instrument Serif italic on a single accent word.

**The frame is the signature.** Each route opens with a rounded panel inset from
the page edge, and everything inside it — background video, floating navbar,
headline, dashboard tray — is cut off by the same corners. Content bleeding past
the bottom edge is deliberate: it says the surface continues past what you can
see, which is exactly what a live system does.

**What Outcome adds to the theme:** a verdict pair. No marketing surface ships
with the state this product exists to render — a settlement that *succeeded* and
still paid nobody. That is `--proven` / `--refused`.

**What this replaced.** Four visual directions preceded this one and each was
rejected: a near-black console with an emerald accent, a struck-metal assay
office, a ticker-tape world in violet on newsprint, and a dark Polaris port. The
lesson across all four is that this project does not want an invented world; it
wants a specified one, executed exactly. This theme was given as a spec and is
followed as a spec.

## Colors

### Primary

`--brand: #ef4d23` — the orange. Section labels, active nav, the eyebrow dot,
link accents, and the one action per view that should be pressed.
`--brand-ink: #d13d16` for hover, `--brand-wash: #fdefe9` for tinted fills.

### Action

`--dark: #0b0f1a` — the near-black pill. This is the *primary* action; the
orange is the *marketing* action. On a working page the dark pill submits and
the orange pill navigates.

### Surfaces

- `--page: #ededed` — the mat every frame sits on
- `--hero: #d9d9d9` — the frame's own ground, behind the video
- `--tray: #f5f2ee` — the warm tray the dashboard cards sit in
- `--card: #ffffff` — cards, fields, the navbar pill

### Text ramp

`--ink: #0b0f1a` · `--ink-2: #404040` · `--ink-3: #737373` · `--ink-4: #a3a3a3`.
Lines: `--line: #e5e5e5`, `--line-2: #d4d4d4`.

### Verdicts

`--proven: #0b7a55` on `--proven-wash: #e9f6f0`, and `--refused: #c0362a` on
`--refused-wash: #fdefed`.

**Refused cannot be the brand orange**, which is why it takes a red the
interface uses nowhere else — an orange that means both "press me" and "this
payment failed" means neither. And proven takes a restrained green rather than a
celebration: a proof is a finding, not congratulation.

## Typography

**Inter** (400/500/600/700) carries the whole interface.

**Instrument Serif italic** on exactly one accent word per headline. It is a
counterpoint to Inter, not a second voice — used twice on a page it stops being
an accent and becomes a typeface choice nobody made. Available as `.serif`.

**Geist Mono** for every hash, address, amount and timestamp, via `.figure`.
`tabular-nums` is on at `body`.

### Hierarchy

- **Hero** — `clamp(36px, 8vw, 72px)`, weight 500, `-0.02em`, line-height 1.05.
- **Page title** — `clamp(28px, 5.5vw, 52px)`, weight 500, `-0.02em`.
- **Section** — `clamp(26px, 4vw, 40px)`, weight 500, `-0.02em`.
- **Body** — `clamp(13px, 3.5vw, 16px)`, measure capped around 60ch.
- **Eyebrow** (`.eyebrow`) — a white pill, 13px, with an orange dot. One per
  page, above the title.

## Layout

`.shell` — `max-width: 76rem`, 1rem gutter rising to 1.5rem at 640px.

`.frame` — the clipped rounded panel: `overflow: hidden`, 1rem radius rising to
1.5rem at 640px, on `--hero`. The home page's frame is
`h-[calc(100vh-24px)]` / `sm:h-[calc(100vh-32px)]`; interior frames are
content-height. The page mat is the `p-3 sm:p-4` on `<body>`.

The navbar lives **inside** the frame, not in the layout, because it floats over
the hero video and is clipped by the same corners.

## Elevation & Depth

Shadows are nearly invisible and separate rather than lift.

- `--shadow-sm: 0 1px 2px rgba(11,15,26,0.05)` — cards, the navbar pill, fields.
- `--shadow-md` / `--shadow-lg` for the rare floating panel.

## Components

### Buttons (`.btn`)

Pills. `--dark` is the primary and carries a trailing `.btn__dot` circle at
`white/15` with a chevron in it — the asymmetric right padding that makes that
circle sit tight to the edge is the button's signature. `--brand` is the same
shape in orange at `white/20`. `--outline` is white with a hairline.

### Navbar

A white pill, `max-w-[760px]`, floating inside the frame. Four links; under
`md` they collapse into a hamburger and a dropdown panel. Everything else the
project built is in the footer.

### Cards (`.card-p`)

White, 1rem radius, `--shadow-sm`, optional hairline via `--bordered`.

### Labels (`.field-label`)

Inter, 12px, medium, `--ink-3`. Deliberately not the tracked monospace uppercase
an earlier visual world used for the same job: mono here would claim the label
is data, and a label is the question, not the answer. Monospace is reserved for
`.figure` — hashes, addresses, amounts, timestamps.

### Fields (`.field`)

White, 1px `--line-2`, 8px radius. Focus is an orange border plus a 3px
`--brand-wash` ring. Invalid swaps both to red.

### Gauge (`components/gauge.tsx`)

Forty ticks across a 180° sweep, `value`% of them lit. Reading a proportion off
counted ticks shows the resolution the number is actually reported at, which a
filled bar hides. Coordinates are rounded to 2dp — unrounded `cos`/`sin` lands
on values like `20.000000000000004` and fails hydration on every tick.

### Verdict (`.verdict`)

A pill carrying a mark. The mark carries the state so it survives greyscale: a
filled disc for proven, a struck ring for refused, an open ring for awaiting.

### Settlement (`.settlement`)

The signature component. Two facts side by side that never move: **what the
facilitator claimed** and **what the chain actually moved**. Putting them in one
row is the argument — the reader does not have to hold two numbers across a
scroll to notice they disagree.

### Rule chain (`components/rule-chain.tsx`)

Fifteen chips in engine order. Passed rules fill in the brand wash, the refusing
rule is ringed in the refusal colour and set semibold, and everything after it
dims to `--ink-4`. The dim is doing real work: it says *never consulted*, not
*passed*, which is the difference between an ordered chain and a checklist.

Motion: the chain fills one chip every 55ms rather than appearing at once,
because the sequence is the mechanism. It replays when the decision changes, and
`prefers-reduced-motion` renders it settled.

### Decision demo (`components/decision-demo.tsx`)

The Persuade surface's operable moment. Six cases down the left, the verdict and
rule chain on the right. Each case changes exactly one input so the rule it trips
is unambiguous — including `maxAmount` moving with the amount on the cap case,
since `intent.maxAmountBound` runs first and would otherwise steal the refusal.

Runs the real engine client-side. The label "judged in your browser · no server"
is load-bearing copy, not decoration.

### The mark

A ring in the brand orange with a gap at the top right, and a check in `--dark`
entering *through* that gap. The claim is the circle; the proof comes from
outside it. Inline SVG in `components/logo.tsx`, also `public/outcome-mark.svg`.

## Do's and Don'ts

### Do:

- Open every route with a frame, and let content bleed past its bottom edge.
- Put a claim and its proof in the same viewport.
- Spend the serif italic once per page.
- Keep hashes exact and copyable; abbreviate for the eye only.
- Render "not known yet" as an em dash, distinct from zero.

### Don't:

- Use the brand orange for a failure state, or the dark pill for navigation.
- Add a fifth item to the navbar. Four is the demo path; the rest is footer.
- Put the navbar in the layout. It belongs inside the frame.
- Gradients as decoration, glassmorphism, glowing edges, pulsing dots.
- Nested cards, or a coloured `border-left` on a callout.
- The hero-metric template: four cards of big-number-over-small-label.
- Ship an SVG with unrounded computed coordinates.
