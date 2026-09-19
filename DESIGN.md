# Design — GhostWhistle

Locked design system for the GhostWhistle hackathon product. Future UI work
must preserve the product flow and defer to this file before adding styles.

## System

- Genre · modern-minimal
- Tone · austere, trustworthy, technical
- Marketing macrostructure · Narrative Workflow
- App macrostructure · Workbench
- Theme · custom Midnight dark paper with one signal-green accent
- Axes · dark paper / grotesk sans / cool green

## Product hierarchy

- The primary audience is a first-time reporter. Minimise blockchain vocabulary until proof or receipt stages.
- The primary action is `제보 시작하기`; it appears once in the hero and once in the edge navigation.
- Home explains the sequence: write → prove eligibility → deliver.
- The reporting workspace prioritises the active form. The destination preview is supporting evidence, not an equal column.

## Typography

- Display · Manrope 700–800, normal style, tight tracking
- Body · Noto Sans KR 400–700, 16 px minimum for prose
- Mono · DM Mono only for hashes, addresses, and proof metadata
- No italic headings, decorative all-caps eyebrows, or body copy below 14 px

## Colour and surfaces

- `tokens.css` is canonical. Every new colour and font must be a named token.
- Signal green occupies no more than 5% of a viewport. Use it for focus, progress, links, and small proof indicators.
- Elevation comes from surface lightness and rules, not coloured glows or glass blur.
- No grid wallpaper, aurora blobs, ambient orbs, fake browser chrome, or decorative gradients.

## Components

- Radius · 8–10 px for inputs and structural panels; pills only for genuine compact status.
- Primary actions use a light neutral fill with dark text and a small green directional detail.
- Buttons, tabs, and links remain one line and at least 44 px high.
- Use Lucide only. Icons support labels; they do not sit in decorative icon tiles.
- Avoid bordered containers nested inside other bordered containers.

## Motion and states

- Motion is functional: stage crossfade, progress, button press, and loading rotation only.
- Animate transform and opacity only. No bounce, parallax, or infinite decorative loops.
- Focus rings appear immediately. Every interactive control supports keyboard focus.
- Reduced motion collapses spatial movement to a ≤150 ms opacity transition.

## Responsive contract

- Verify 320, 375, 414, 768, and desktop widths.
- `html` and `body` use `overflow-x: clip`; interactive labels never wrap.
- The receipt preview follows the form on small screens and never forces horizontal scrolling.

## Exports

`tokens.css` at the repository root is the source of truth for colour, type,
spacing, motion, rules, and radius values.
