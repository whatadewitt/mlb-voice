# Handoff: MLB rAIdio — Single-Page HLS Audio Broadcast

## Overview
A single full-bleed page that streams an HLS audio feed of a live baseball
broadcast. The page presents a scoreboard (two teams, score, inning, count,
runners on base, current batter), an audio player (play/pause + volume +
mute), a decorative audio visualizer, and a `MLB rAIdio` brand mark whose
"AI" letters are stylized in the accent color. Two visual styles are
supported — a clean "Pro" broadcast look and an "80s Neon Midnight"
synthwave look — switchable at runtime.

## About the Design Files
The files under `reference/` are **design references created in HTML** —
a working prototype showing the intended look, copy, and behavior. They
are *not* production code to ship directly. Your job is to **recreate
this design in the target codebase's existing environment** (React, Vue,
SwiftUI, native, etc.) using its established patterns, design tokens,
and component library. If the project does not yet have a frontend
environment, pick the framework that best fits the rest of the stack and
implement there.

The HTML reference uses React 18 + Babel inline for fast iteration; the
production implementation should use the host app's idiomatic component
patterns (hooks/state management, design tokens, etc.) rather than
porting the inline-Babel structure.

## Fidelity
**High-fidelity (hifi).** The reference is a pixel-level mockup with
final colors, typography, spacing, copy, and the two style variants the
team selected. Reproduce it pixel-perfectly using the codebase's
existing libraries and tokens where they exist; fall back to the values
documented below where they do not.

## Screens / Views

There is **one screen**, full-viewport, with the following vertical
sections (top → bottom). All measurements assume a 1440px-wide desktop
viewport; the layout reflows at ≤ 720px (see *Responsive behavior*).

### 1. Top bar (`.topbar`)
- **Layout**: flex row, `justify-content: space-between`, `padding: 24px 48px`.
- **Left — brand**:
  - 38×38 circle badge (`.brand-mark`) — 2px solid border in foreground color,
    contains the text "AI" in JetBrains Mono 700, 12px, letter-spacing −0.02em.
  - Wordmark (`.brand-name`) reading "**MLB rAIdio** · The game, on air".
    Font: Inter 700, 13px, letter-spacing 0.22em, uppercase.
    The two "AI" characters inside "rAIdio" are wrapped in a span
    styled as JetBrains Mono 700 in the **accent color** (the
    `--accent` token, default `#E2253D`).
    The tagline ("· The game, on air") sits to the right with `margin-left: 10px`,
    color `rgba(247,247,245,0.48)`, font-weight 500.
- **Right** (`.topbar-right`): flex row, gap 24px, 12px uppercase 600 weight.
  - **"On Air" pill** (`.live-pill`): pill capsule, padding 6/10/6/8,
    border-radius 999px, background `rgba(226,37,61,0.14)`,
    border `1px solid rgba(226,37,61,0.35)`, color `#ff6478`,
    contains a 7px red dot (`#ff3550`) with a pulsing box-shadow ring
    (1.6s ease-out, infinite).
  - "12,847 listening" text.

### 2. Stage (`.stage`)
Flex column, padding `24px 48px 48px`, gap 28px between the
broadcast card and the play-by-play card.

#### 2a. Broadcast card (`.broadcast-card`)
Max-width 960px, centered. Made up of three stacked panels that share a
hairline 1px border, with subsequent panels using `border-top: none` so
the borders read as a single continuous card.

##### Inning strip (`.inning-strip`)
Flex row, padding `0 4px 14px`, 11px uppercase muted text.
- Left: "Top 7th" (foreground) · "Veritas Field" · "Game 132", separated by 3px circular dot dividers.
- Right: "Sat · Aug 12 · 7:08 PM ET".

##### Scoreboard (`.scoreboard`)
3-column grid `1fr auto 1fr`, gap 28px, padding `36px 40px`,
background `rgba(255,255,255,0.015)`.

- **Away team** (left, `.team.away` — `flex-direction: row-reverse`, text right-aligned):
  - 88×88 circular team logo (`.team-logo.away`).
    Default styling: background `#6B2733`, border `3px solid #f7f7f5`,
    text color `#f7f7f5`, contains letters "BH" in Inter 900, 36px,
    letter-spacing −0.02em. **Placeholder** — replace with real team key art.
  - City: "Brooklyn", 11px uppercase 0.18em tracking, muted.
  - Name: "Hawks", 28px 900 weight, letter-spacing −0.02em, line-height 1.
  - Record: "74-58 · away", 11px 500 weight, muted, tabular nums.

- **Score block** (center, `.score-block`):
  - JetBrains Mono 700, 88px, letter-spacing −0.04em, line-height 0.85,
    tabular nums. Format: `5  —  3` (em-dash in muted color, 56px).

- **Home team** (right, `.team.home`):
  - Same structure as away team. Default logo: background `#18324E`,
    border `3px solid #F4D03F`, text `#F4D03F`, letters "PK".
  - City: "Portland", Name: "Knights", Record: "79-53 · home".

##### Game-state panel (`.game-state`)
Grid `auto 1fr auto`, gap 32px, padding `16px 40px`, no top border.

- **Diamond** (`.diamond`, 64×64): four 14×14 squares rotated 45°
  positioned at home (bottom), first (right), second (top), third (left).
  Empty bases use a 1.5px muted border; occupied bases fill with the
  `--accent` color and a 2px white-ish outer shadow. Default state:
  first ✓ occupied, second ✗, third ✓ occupied, home empty.
- **Count** (`.count`): three "B / S / O" items, each a column with a
  10px uppercase label and a row of 12px circular pips. Filled pips:
  balls green `#4ad17d` (3 pips total, 2 filled), strikes amber `#f0c544`
  (2 pips total, 1 filled), outs red `#d96666` (2 pips total, 1 filled).
- **At-bat** (`.at-bat`, right-aligned column):
  - "AT BAT" 10px uppercase 0.22em muted label.
  - "M. Rodríguez" 16px 700 weight, letter-spacing −0.01em.
  - "2-for-4, HR · vs. D. Tanaka (87 P)" 11px muted, tabular nums.

##### Player panel (`.player`)
Grid `auto 1fr auto`, gap 24px, padding `22px 28px`.

- **Play/pause button** (`.play-btn`): 64×64 circle, background
  foreground color (white-ish `#f7f7f5`), foreground icon `#0A0B0E`.
  Hover: `scale(1.04)`, 80ms ease-out. Active: `scale(0.97)`.
  Icon swaps between a play triangle and a two-bar pause glyph (22×22).
- **Center column** (`.visualizer-wrap`, flex column gap 6px):
  - "ON THE CALL" 10px uppercase 0.22em tracking muted label, separated
    from the announcer line by a 1px right border with 10px padding-right.
  - "Jim Powell & Sarah Diaz · BKH @ PTK" body text, 12px.
  - **Visualizer** (`<canvas class="viz">`): 36px high, 56 vertical bars,
    gap 4px, each 2–N px wide depending on width. Animated by RAF using
    summed sines `0.42 + 0.13 + 0.83` of bar index plus a phase that
    advances `0.085 rad/frame` only while playing. While paused, bars
    render at a flat low amplitude (idle 0.12 × height). Fill uses the
    `--accent` token at globalAlpha `0.55 + |amp|·0.5` while active,
    `0.35` while paused. This is **decorative** — it does not
    introspect real audio (the production version may swap in a Web
    Audio AnalyserNode, but cross-origin HLS typically blocks it).
- **Volume control** (`.volume-control`, flex row, min-width 200px):
  - Mute toggle button (`.vol-icon`), background transparent, border none,
    padding 0, 18×18 stroke icon. Toggles muted state.
  - Native `<input type="range">` styled as a 3px hairline track with a
    12px white circular thumb. min 0, max 1, step 0.01.

#### 2b. Play-by-play card (`.pbp-card`) — optional, toggleable
Max-width 960px, 1px hairline border.
- Header bar (`.pbp-header`): 14/24 padding, "PLAY-BY-PLAY" left,
  "Auto-updating · 5s delay" right, both 11px uppercase muted.
- List of events. Each `.pbp-item` is a grid `64px 1fr auto` with
  gap 18px, padding 14/24, bottom hairline border:
  - Left: inning code in JetBrains Mono 11px (e.g. "T7 · 1 out").
  - Middle: event description, 14px, lead actor names bolded.
  - Right: 10px uppercase tag pill (`.pbp-tag.hit`, `.run`, `.out`)
    with a 1px colored border — hits use the accent color, runs green
    `#4ad17d`, outs red `#d96666`.
- Max height 220px with `overflow-y: auto`.

### 3. Footer (`.footer`)
Flex row `space-between`, padding `22px 48px 28px`, 11px uppercase 500 weight muted.
- Left: "© MLB rAIdio · REDspace affiliate broadcasting network".
- Right: "Stream · HLS · 128 kbps".

## Style variants

Both variants share the same DOM, switched via `data-style="pro"` or
`data-style="neon"` on the root `.app` element.

### Pro (default)
- Background: dark gradient `#0F1216 → #0A0B0E → #07080A` with a faint
  radial highlight at the top, plus a very faint diamond grid pattern
  masked to the center via radial mask.
- Type: Inter throughout, JetBrains Mono for the score and inning codes.
- Sharp 2px corners on cards. Hairline `rgba(255,255,255,0.10)` borders.
- The accent color drives: the "AI" in the wordmark, the live pulse dot
  ring (red), the diamond's occupied bases, and the visualizer bars.

### Neon Midnight (`data-style="neon"`)
- Background: layered radial gradients — magenta `rgba(255,41,217,0.22)`
  glow top-center, cyan `rgba(0,220,255,0.18)` glow bottom, base
  `#1a0633 → #0a0419 → #06010f`.
- **Synthwave grid floor**: pseudo-element on `.bg::after`, perspective
  500px, rotateX 60°, anchored to bottom, with vertical cyan grid lines
  every 60px and horizontal lines every 36px, fading from transparent
  to magenta near the horizon. Masked by a vertical gradient so it
  fades up from the bottom.
- **Scanlines**: `.bg::before` repeating 3-line gradient at 2.5% white opacity.
- **Sun** (`.neon-sun`): 60vh circular radial gradient (gold → magenta),
  positioned top-center −20vh, masked into horizontal slats by an
  intersecting linear gradient + repeating-linear-gradient mask.
- Type: 'Audiowide' Google Font replaces Inter for brand, scoreboard
  names, inning strip, and topbar-right. Score uses 'Share Tech Mono'
  in cyan `#00f0ff` with a 3-stop neon text-shadow (cyan inner glow,
  cyan mid, magenta outer).
- Cards: `rgba(26,6,51,0.45)` background with `backdrop-filter: blur(8px)`,
  magenta-pink 1px borders, layered box-shadows for outer magenta and
  inset glow.
- Play button: linear-gradient `#ff2891 → #00dcff`, dark text, magenta+cyan glow.
- Volume thumb: cyan with cyan glow.
- The "AI" mono span in the wordmark turns cyan `#00f0ff` with a cyan glow.
- `.brand-mark`: magenta border + glow.
- The live pill becomes magenta-themed (`#ff5fb5` text, magenta border, magenta glow).

## Interactions & Behavior

### Audio playback
- HLS stream is attached on mount and whenever `hlsUrl` changes.
- Use `hls.js` 1.5.x where supported; fall back to native
  `application/vnd.apple.mpegurl` on Safari.
- Play button toggles `audio.play()` / `audio.pause()`. UI listens
  for the audio element's `play` and `pause` events so external state
  changes stay in sync.
- If `play()` rejects (autoplay block, network), the UI still flips
  to the "playing" state so the design demos work without a live stream.

### Volume / mute
- Volume slider `0..1`, applied to `audio.volume` whenever volume or
  muted changes. Muted overrides volume to 0 on the element but the
  slider remains at the last unmuted volume (slider just *displays* 0
  while muted).
- Mute toggle: clicking the icon flips muted state; dragging the slider
  also clears muted.

### Visualizer
- Animates only while `playing === true`. Otherwise renders flat idle bars.
- Decorative only — does not need to react to actual audio amplitude.

### Hover / press
- Play button hover scales to 1.04, active scales to 0.97 (80ms ease-out).
- Volume icon hover lifts color from `--ink-2` to `--ink`.

### Style toggle
- Setting `data-style="pro"` vs `data-style="neon"` on the root
  swaps every visual treatment via CSS — no JS required beyond
  flipping the attribute.

## State management
A single root component owns:
- `playing: boolean` — synced from audio events.
- `volume: number` (0..1).
- `muted: boolean`.
- `style: 'pro' | 'neon'`.
- `accent: string` (hex).
- `showVisualizer: boolean`.
- `showPlayByPlay: boolean`.
- `hlsUrl: string`.

Mock content (scoreboard data, play-by-play events, announcer names) is
hard-coded in `app.jsx` as `GAME` and `PBP` constants. Real
implementations should pull these from whatever live-game feed the
broadcaster ingests.

## Design tokens

### Colors (pro)
| Token | Value |
|---|---|
| `--ink` foreground primary | `#f7f7f5` |
| `--ink-2` secondary text | `rgba(247,247,245,0.72)` |
| `--ink-3` muted text | `rgba(247,247,245,0.48)` |
| `--ink-4` faintest | `rgba(247,247,245,0.22)` |
| `--line` hairline border | `rgba(247,247,245,0.10)` |
| `--line-2` stronger border | `rgba(247,247,245,0.18)` |
| `--accent` (default) | `#E2253D` |
| Background base | `#0A0B0E` |
| Background gradient stops | `#0F1216 → #0A0B0E → #07080A` |
| Score balls green | `#4ad17d` |
| Score strikes amber | `#f0c544` |
| Score outs red | `#d96666` |
| Live red | `#ff3550` / pill bg `rgba(226,37,61,0.14)` |

### Colors (neon overrides)
| Token | Value |
|---|---|
| Background base | `#1a0633 → #0a0419 → #06010f` |
| `--ink` | `#fdf8ff` |
| `--ink-3` | `rgba(180,140,255,0.72)` |
| Magenta primary | `#ff2891` (text variants `#ff5fb5`) |
| Cyan primary | `#00f0ff` / `#00dcff` |
| Card background | `rgba(26,6,51,0.45)` + `backdrop-filter: blur(8px)` |

### Accent swatches (Tweaks panel)
`#E2253D`, `#F4B400`, `#0E7C66`, `#3D5AFE`, `#FF2891`.

### Typography
- **Body / UI**: Inter 400/500/600/700/800/900.
- **Monospace / scoreboard digits**: JetBrains Mono 400/500/700.
- **Neon display**: Audiowide (Google Fonts).
- **Neon score**: Share Tech Mono.

Display sizes:
- Score block: 88px / 0.85 line / −0.04em tracking.
- Team name: 28px / 900 / −0.02em tracking.
- Brand mark "AI" inside circle: 12px JetBrains Mono 700.
- Brand wordmark: 13px Inter 700 uppercase 0.22em tracking.
- Labels (uppercase 0.18–0.22em tracking): 10–11px.
- Body in cards: 14–16px.

### Spacing
4px grid throughout. Common values: 4, 6, 10, 14, 18, 22, 24, 28, 32, 36, 40, 48px.

### Radii
- Cards: 0 (sharp 2px-ish, actually 0 in the reference — chosen for cinematic feel).
- Pills (live indicator): 999px (full).
- Play button: 50% (circle).
- Volume thumb: 50%.

### Shadows
- Pro: no shadows on chrome — depth comes from hairline borders + slightly raised backgrounds.
- Neon: layered glows on cards
  (`0 0 28px rgba(255,40,145,0.18), inset 0 0 30px rgba(255,40,145,0.05)`),
  buttons (`0 0 24px rgba(255,40,145,0.55), 0 0 48px rgba(0,220,255,0.3)`),
  and a pulsing 8px ring on the live dot.

### Motion
- Live dot pulse: 1.6s ease-out infinite, expanding 0–8px box-shadow ring.
- Play button hover/press: 80ms ease-out scale.
- Visualizer phase: advances `0.085 rad/frame` while playing.

## Responsive behavior
Single breakpoint at `≤ 720px`:
- Topbar padding shrinks to `16/20px`.
- Stage padding shrinks; gap drops to 18px.
- Scoreboard collapses to a single centered column; teams stack
  (logo on top, meta below).
- Score block shrinks to 64px.
- Game-state panel becomes a centered column.
- Player panel becomes 2 columns; volume control occupies the full
  bottom row.
- Play-by-play tags hide.

## Assets
- **Fonts**: loaded from Google Fonts —
  `Inter:wght@400;500;600;700;800;900`,
  `JetBrains+Mono:wght@400;500;700`,
  `Audiowide`,
  `Share+Tech+Mono`.
- **HLS**: `hls.js@1.5.15` via jsDelivr CDN.
- **Icons**: bespoke inline SVGs (play, pause, volume on/off). 1.8 stroke
  width, 24×24 viewBox, `currentColor`. No icon-font dependency.
- **Team logos**: placeholder circular roundels with letters. Replace
  with real key art when shipping.
- **Brand mark**: a 38×38 circle with "AI" in JetBrains Mono — easy to
  reproduce as SVG or as styled text.

## Tweaks panel
The reference includes an in-design Tweaks panel (a floating control
strip toggled from the prototype toolbar). It writes to a JSON block
at the top of `index.html` so values persist between reloads. This is a
**prototype-only convenience** — production builds do not need it.
The five keys it exposes (`style`, `accent`, `showVisualizer`,
`showPlayByPlay`, `hlsUrl`) map directly to the state described in
*State management*.

## Files (in `reference/`)
- `index.html` — shell + font/CDN imports + tweak defaults JSON block.
- `app.jsx` — React component tree, HLS hook, visualizer, mock data.
- `styles.css` — all visual styling for both Pro and Neon variants.
- `tweaks-panel.jsx` — prototype-only Tweaks helper (safe to ignore in port).
