# FXtrader — Design System

> Version 1.0 · Desktop-first replay & backtesting platform · Dark mode default

---

## 1. Brand Identity

**Name:** FXtrader
**Tagline:** *Rewind the markets. Sharpen your edge.*
**Personality:** Precise · Composed · Spirited

**Inspiration references (category, not copy):**
- The information density and monospaced rigor of professional trading terminals
- The restraint and typographic discipline of modern productivity tools (clean sans, no decoration debt)
- The quiet confidence of premium financial publications — generous negative space around dense data, never busy
- Subtle gamification cues from competitive ranked-play interfaces (badges, streaks) — used sparingly so the platform reads as a tool first, a game second

**Voice:** Direct. No hype. Numbers do the talking. Microcopy is short, lowercase-friendly, and never exclaimed. *"Position closed. +$1,240."* — not *"Nice trade! 🎉"*

---

## 2. Color Palette

All colors specified as hex. Tailwind variable names follow a flat token convention (`bg-surface-1`, `text-fg-muted`, etc.) so dark/light themes swap via `:root` / `[data-theme="light"]`.

### 2.1 Brand & Action

| Role | Dark mode | Light mode | Tailwind token |
|---|---|---|---|
| Primary (brand cyan-blue) | `#3DA9FC` | `#0A6CC9` | `brand-500` |
| Primary hover | `#5FB8FD` | `#0959A8` | `brand-400` / `brand-600` |
| Primary press | `#2D8FDB` | `#074A8E` | `brand-600` / `brand-700` |
| Secondary (accent amber) | `#E8B339` | `#B47C0E` | `accent-500` |

### 2.2 Status

| Role | Dark | Light | Token |
|---|---|---|---|
| Success / Buy | `#16C784` | `#0E8A5C` | `bull-500` |
| Danger / Sell | `#EA3943` | `#C8242E` | `bear-500` |
| Warning | `#F0B90B` | `#A8810A` | `warn-500` |
| Info | `#3DA9FC` | `#0A6CC9` | `info-500` |

> **Buy/Sell rule:** green = bullish/long/profit, red = bearish/short/loss. Never inverted, never themed. This is muscle memory for traders — breaking it costs trust.

### 2.3 Neutrals — Dark mode (default)

The dark palette is *blue-black*, not pure black. This is what makes it feel "expensive" rather than flat or cheap. Each surface step adds ~3–5% lightness so layered cards remain legible without borders fighting the eye.

| Step | Hex | Use | Token |
|---|---|---|---|
| `bg-base` | `#0B0F17` | App background (deepest) | `surface-0` |
| `bg-1` | `#11161F` | Default panel / card | `surface-1` |
| `bg-2` | `#171D28` | Elevated card, modal backdrop content | `surface-2` |
| `bg-3` | `#1F2632` | Hover row, selected row base | `surface-3` |
| `border` | `#2A3140` | Hairline dividers, input borders | `border-default` |
| `border-strong` | `#3A4254` | Focused inputs, active tabs underline | `border-strong` |
| `fg-muted` | `#8593A8` | Secondary text, axis labels | `fg-muted` |
| `fg-default` | `#C9D1DC` | Body text | `fg-default` |
| `fg-strong` | `#F2F4F8` | Headings, prices | `fg-strong` |

### 2.4 Neutrals — Light mode

A warm-cool off-white, never pure `#FFFFFF`. Borders are soft to keep density readable.

| Step | Hex | Token |
|---|---|---|
| `bg-base` | `#F7F8FA` | `surface-0` |
| `bg-1` | `#FFFFFF` | `surface-1` |
| `bg-2` | `#FAFBFD` | `surface-2` |
| `bg-3` | `#EEF1F6` | `surface-3` |
| `border` | `#DCE1EA` | `border-default` |
| `border-strong` | `#B8C0CE` | `border-strong` |
| `fg-muted` | `#5A6478` | `fg-muted` |
| `fg-default` | `#1F2533` | `fg-default` |
| `fg-strong` | `#0A0E16` | `fg-strong` |

### 2.5 Chart Colors

Tuned for prolonged screen time. Bullish/bearish are slightly desaturated vs. the status reds/greens so a screen full of candles doesn't vibrate.

| Role | Dark | Light | Token |
|---|---|---|---|
| Bullish candle body | `#22C28B` | `#108A5A` | `chart-bull` |
| Bearish candle body | `#E04757` | `#BB2832` | `chart-bear` |
| Wick | `#5C6678` | `#8893A6` | `chart-wick` |
| Volume bar (neutral) | `#3A4254` | `#C8CFDB` | `chart-vol` |
| Volume bar (bull tint) | `#22C28B` @ 35% | `#108A5A` @ 25% | `chart-vol-bull` |
| Volume bar (bear tint) | `#E04757` @ 35% | `#BB2832` @ 25% | `chart-vol-bear` |
| MA1 (fast) | `#3DA9FC` | `#0A6CC9` | `chart-ma1` |
| MA2 (slow) | `#E8B339` | `#B47C0E` | `chart-ma2` |
| Grid lines | `#1F2632` | `#EEF1F6` | `chart-grid` |
| Crosshair | `#8593A8` | `#5A6478` | `chart-crosshair` |

---

## 3. Typography

### 3.1 Families

| Role | Family | Why |
|---|---|---|
| Display / UI | **Söhne** (or fallback **Inter Tight**) | Geometric-humanist, tight tracking, reads pro |
| Body | **Inter** | Workhorse, excellent at small sizes |
| Mono / numerics | **JetBrains Mono** | Tabular, distinguishable `0` / `O`, calm at price tickers |

```css
--font-display: "Söhne", "Inter Tight", -apple-system, system-ui, sans-serif;
--font-body:    "Inter", -apple-system, system-ui, sans-serif;
--font-mono:    "JetBrains Mono", "SF Mono", ui-monospace, monospace;
```

> All numeric values (prices, P&L, volumes, timestamps, percentages) use `font-mono` with `font-variant-numeric: tabular-nums`. This is non-negotiable — non-tabular numerics jitter on update and look amateur.

### 3.2 Weights

- 400 — body
- 500 — UI labels, button text
- 600 — section headings, emphasis
- 700 — display headings only

Avoid 800/900 — they read as consumer fintech.

### 3.3 Type scale

| Token | Size / line-height | Tracking | Use |
|---|---|---|---|
| `text-xs` | 11 / 16 | +0.02em | Table micro-labels, axis |
| `text-sm` | 12 / 18 | +0.01em | Secondary UI, dense rows |
| `text-base` | 13 / 20 | 0 | Default body |
| `text-md` | 14 / 22 | 0 | Inputs, primary UI |
| `text-lg` | 16 / 24 | -0.005em | Card titles |
| `text-xl` | 20 / 28 | -0.01em | Section headings |
| `text-2xl` | 24 / 32 | -0.015em | Modal titles |
| `text-3xl` | 32 / 40 | -0.02em | Page titles |
| `text-4xl` | 44 / 52 | -0.025em | Marketing / empty-state hero |

> Information density bias: default body is **13px**, not 16px. This is a trader's tool — every extra px of padding pushes a row off-screen.

### 3.4 Numeric variants

```css
.num         { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.num-price   { font-feature-settings: "ss01"; letter-spacing: -0.01em; }
.num-pnl     { font-weight: 500; }
```

---

## 4. Spacing — 4px base scale

| Token | Value | Use |
|---|---|---|
| `0` | 0 | — |
| `0.5` | 2px | Hairline insets |
| `1` | 4px | Icon-to-label gap |
| `1.5` | 6px | Compact row padding |
| `2` | 8px | Default row padding, button x-padding |
| `3` | 12px | Card inner gap |
| `4` | 16px | Card padding (default) |
| `5` | 20px | Section gap |
| `6` | 24px | Card padding (comfortable) |
| `8` | 32px | Major section gap |
| `10` | 40px | Page gutter |
| `12` | 48px | Hero spacing |
| `16` | 64px | Marketing only |

**Density rule:** table rows = 28px tall (compact) / 32px (default). Buttons = 28px / 32px / 36px. Don't pad past these without reason.

---

## 5. Border Radius

| Token | Value | Use |
|---|---|---|
| `radius-none` | 0 | Charts, table cells |
| `radius-sm` | 3px | Inputs, badges, small buttons |
| `radius-md` | 5px | Default buttons, cards |
| `radius-lg` | 8px | Modals, large cards |
| `radius-xl` | 12px | Marketing cards only |
| `radius-full` | 9999px | Pills, avatars, status dots |

> Pro tools use *less* radius than consumer apps. 5px is the workhorse; anything over 8px starts to feel soft.

---

## 6. Shadows

Dark mode shadows lean on a touch of color tint + low opacity rather than heavy blur — this is what reads as expensive.

```css
--shadow-none: none;
--shadow-sm:   0 1px 2px rgba(0, 0, 0, 0.32);
--shadow-md:   0 4px 12px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255,255,255,0.02);
--shadow-lg:   0 12px 32px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255,255,255,0.03);

/* Special: primary CTA glow — subtle, never neon */
--shadow-glow: 0 0 0 1px rgba(61, 169, 252, 0.40),
               0 4px 18px rgba(61, 169, 252, 0.28);

/* Light mode equivalents */
--shadow-sm-light: 0 1px 2px rgba(15, 23, 42, 0.06);
--shadow-md-light: 0 4px 12px rgba(15, 23, 42, 0.08);
--shadow-lg-light: 0 12px 32px rgba(15, 23, 42, 0.12);
```

The glow is reserved for **one** CTA per screen — typically the primary action in a flow (e.g. "Start replay", "Place trade"). If everything glows, nothing does.

---

## 7. Components

### 7.1 Buttons

Heights: `sm` 26px · `md` 30px · `lg` 36px. Horizontal padding scales with height (8 / 12 / 16px). Font is `font-display`, weight 500, `text-sm` or `text-md`.

| Variant | Background | Border | Text | Notes |
|---|---|---|---|---|
| Primary | `brand-500` | none | `#0B0F17` | Solid; uses `shadow-glow` on hover |
| Secondary | transparent | `border-default` 1px | `fg-strong` | Hover bg `surface-2`, border → `border-strong` |
| Success / Buy | `bull-500` | none | `#06120C` | The dark text on green is intentional — high contrast, less harsh than white |
| Danger / Sell | `bear-500` | none | `#FFFFFF` | |
| Ghost | transparent | none | `fg-default` | Hover bg `surface-2` only |
| Icon-only | transparent | none | `fg-muted` | 28px square, hover `fg-strong` + `surface-2` bg, `radius-sm` |

**States:** `hover` lightens by ~8%, `active` darkens by ~6%, `disabled` is 40% opacity (no greyscale). All buttons get a 1px focus ring in `brand-500` at 2px offset.

### 7.2 Cards

| Variant | Spec |
|---|---|
| Default | `surface-1`, 1px `border-default`, `radius-md`, padding `4` (16px), no shadow |
| Elevated | `surface-2`, no border, `radius-lg`, padding `6` (24px), `shadow-md` |
| Stat card | `surface-1` + 1px border; padding `4`; layout: 24px icon + label (`text-xs`, `fg-muted`, uppercase tracking +0.05em) over value (`font-mono`, `text-2xl`, `fg-strong`); optional delta chip (`text-xs`, `bull-500` or `bear-500`) inline-right of value |

### 7.3 Tables

Rows are 28px (compact) / 32px (default). No row borders inside the body — vertical rhythm comes from a single 1px header divider and hover bands.

| State | Spec |
|---|---|
| Header | `surface-0` bg, 11px uppercase, `fg-muted`, tracking +0.05em, sticky on vertical scroll, sortable arrow appears on hover |
| Body row | `surface-1` bg, 13px, alternating optional with `surface-1` and `surface-1` + 2% lightness |
| Hover row | `surface-3` bg, no border, transition 80ms |
| Selected row | `surface-3` bg + 2px left border in `brand-500` (inset, doesn't shift content) |
| Empty state | Centered 200px-tall block: 32px outline icon (`fg-muted`), 14px `fg-default` headline, 12px `fg-muted` helper, optional ghost button |

Numeric columns are right-aligned and use `font-mono`. Always.

### 7.4 Inputs

Height 30px (default), 36px (large for primary forms). `surface-1` bg, 1px `border-default`, `radius-sm`, `text-md`. 12px horizontal padding.

| State | Spec |
|---|---|
| Default | as above |
| Hover | border → `border-strong` |
| Focused | border → `brand-500`, 0 0 0 3px `brand-500/20` ring, no shadow |
| Error | border → `bear-500`, 0 0 0 3px `bear-500/20` ring; helper text `bear-500` 11px below |
| Disabled | 50% opacity, cursor `not-allowed`, no hover |
| With icon | 14px `fg-muted` icon at 10px from edge; input padding adjusts to 32px on that side |
| Numeric stepper | Right-aligned mono input + two 14px chevron buttons stacked at the right edge inside the input frame; click-and-hold accelerates |

### 7.5 Tabs

Underline style. 32px tall row, 14px gap between tabs. Each tab is `text-md`, weight 500, `fg-muted` resting → `fg-strong` active. Active tab has a 2px `brand-500` underline flush with the row's bottom border (1px `border-default`). 120ms slide transition between tabs. No background fills.

### 7.6 Modals / Dialogs

- Width: 480px (default), 640px (form), 880px (data). Never full-bleed except on confirm-trade flows where the chart is referenced.
- `surface-2` bg, `radius-lg`, `shadow-lg`.
- Backdrop: `#000000` at 56% opacity + 4px backdrop blur. Backdrop blur is a one-place-only luxury — used here, used nowhere else.
- Header: 56px tall, `text-xl` title left, close icon-button right, 1px `border-default` bottom.
- Footer: 56px tall, right-aligned actions with 8px gap, 1px top border.
- Open/close: 140ms ease-out scale from 0.98→1 + opacity 0→1.

### 7.7 Tooltips

- `surface-3` bg, 1px `border-default`, `radius-sm`, `shadow-md`.
- 11px `fg-strong` text, 6px / 8px padding.
- 6ms delay in, 0ms out. (Yes, fast — chart hovers need to feel instantaneous.)
- 8px offset from anchor with a 6px arrow.
- Max-width 280px; longer content gets a popover instead.

### 7.8 Badges

22px tall, `radius-full`, 8px horizontal padding, 11px font (display, weight 500), uppercase tracking +0.04em.

| Type | Visual |
|---|---|
| Pro | `accent-500` bg @ 16% + `accent-500` text + 1px `accent-500/30` border |
| Day Trading | `info-500` bg @ 16% + `info-500` text |
| Win Streak | `bull-500` bg @ 16% + `bull-500` text + tiny flame glyph (8px) prefixed; pulses gently on streak increment |
| Loss Streak | `bear-500` bg @ 16% + `bear-500` text |
| New | `surface-3` + `fg-strong` |

### 7.9 Toasts

Bottom-right stack, 16px gutter, 360px wide, `surface-2`, `radius-md`, `shadow-lg`. 4px left accent stripe in the status color.

| Type | Stripe | Icon |
|---|---|---|
| Success | `bull-500` | check |
| Error | `bear-500` | alert |
| Info | `info-500` | info |
| Warning | `warn-500` | warning |

Slide in from right (180ms ease-out), auto-dismiss at 5s (success/info) or 8s (error/warning). Stack tops out at 3 — older ones collapse into a "+N more" pill.

---

## 8. Iconography

- **Style:** outline / line, never duotone or filled-by-default.
- **Stroke width:** 1.5px at 16px size, 1.75px at 20px+. Consistent stroke is the *only* way an icon set looks designed instead of collected.
- **Sizes:** 14px (inline with body), 16px (default UI), 20px (toolbar), 24px (empty states).
- **Color:** inherits `currentColor` from text. Never colored unless it's a status icon in a toast or alert.
- **Filled variants** exist for: active tab indicators, selected state in lists, chart bookmark glyphs. Filled = "this is the active one."
- **Source:** standardize on a single open icon set (Lucide, Phosphor — pick one) and don't mix. Custom icons (chart studies, drawing tools) follow the same stroke + grid rules.

---

## 9. Motion

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 80ms | `cubic-bezier(0.2, 0, 0.2, 1)` | Hover, focus rings, table row highlight |
| `motion-fast` | 140ms | `cubic-bezier(0.2, 0, 0.2, 1)` | Modal open, dropdown, toast in |
| `motion-base` | 220ms | `cubic-bezier(0.2, 0, 0, 1)` | Tab switch, panel slide |
| `motion-slow` | 360ms | `cubic-bezier(0.2, 0, 0, 1)` | Onboarding, empty-state illustrations |
| `motion-pulse` | 600ms | `ease-out` | Live-update flash on numeric values |

### What animates
- Modal/popover/tooltip enter & exit
- Hover state color/border transitions
- Tab indicator slide
- Toast entry/exit
- Subtle pulse-on-change for live numerics (see §10)
- Chart playback scrubbing (60fps requirement)

### What does NOT animate
- Candle rendering during replay — instant snap, never tweened
- P&L color change — instant (false fades read as lag in a real fill)
- Order book updates
- Page transitions (this is a tool, not a story)

### Reduced motion
Honor `prefers-reduced-motion: reduce`. All non-essential motion → 0ms. Pulses → static color flash (no scale).

---

## 10. Trading-Specific Visual Rules

### 10.1 Position rendering on chart

| Element | Spec |
|---|---|
| **Entry line** | 1px solid horizontal line in `brand-500` (long) or `accent-500` (short). Right-edge label chip: ticker + entry price + side glyph (▲ long / ▼ short). Chip uses `surface-2` bg with a 1px brand-colored border. |
| **Stop Loss (SL)** | 1px **dashed** line in `bear-500` @ 80%. Right-edge chip: `SL · price · -$amount` in `bear-500` text, `bear-500/12%` bg. Dashed pattern: 4px-on / 3px-off. |
| **Take Profit (TP)** | 1px **dashed** line in `bull-500` @ 80%. Right-edge chip: `TP · price · +$amount` in `bull-500`, `bull-500/12%` bg. Same dash pattern. |
| **Profit zone fill** | Between entry and TP: `bull-500` at 6% opacity. |
| **Loss zone fill** | Between entry and SL: `bear-500` at 6% opacity. |
| **Active position highlight** | When a position row is selected in the positions panel, its lines on chart get +1px stroke and +20% opacity boost. |

### 10.2 P&L coloring

- Profit (positive): `bull-500`. Always green. Always.
- Loss (negative): `bear-500`. Always red. Always.
- Zero / breakeven: `fg-muted`.
- **Never** invert for any user preference, theme, or "colorblind mode" — colorblind users get the colorblind palette (below) which still maps green-up / red-down.

**Colorblind palette (opt-in):** bullish → `#3DA9FC` (blue), bearish → `#E8B339` (amber). Plus a small `▲` / `▼` glyph always prefixes P&L numbers when this mode is on, so polarity is conveyed by shape, not just hue.

P&L numbers are formatted: sign always shown for non-zero (`+$1,240.50`, `-$320.00`). Currency symbol matches account base. Never abbreviate to `1.24k` in the trade log — only on summary stat cards.

### 10.3 Live-updating numbers (pulse)

When a price, P&L, or balance updates:

```
1. Capture old value, new value.
2. If new > old: brief flash background `bull-500/18%` → transparent, 600ms ease-out.
3. If new < old: brief flash background `bear-500/18%` → transparent, 600ms ease-out.
4. The numeric text color stays its resting color throughout — only the background pulses.
5. If updates fire faster than every 200ms, throttle: only the most recent direction pulses.
```

This is the pulse rule. It's quiet enough that a screen full of ticking prices doesn't strobe, but present enough that you can feel the market breathing.

### 10.4 Chart-specific rules

- Crosshair: 1px dashed in `chart-crosshair`, with price label chip on the y-axis and timestamp chip on the x-axis.
- Replay scrubber: full-width below the chart, 32px tall. Currently-played region is `brand-500` at 24% opacity; ungrazed future region is `surface-2`. The current-bar handle is a 4px wide `brand-500` vertical line with a 12px square grab handle at its center.
- "Now" indicator (in replay): small `accent-500` dot at the rightmost candle's close, with a 1px `accent-500/40%` vertical line dropped to the time axis.

---

## 11. Sample Dashboard Layout (ASCII)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ FX  EUR/USD ▾   1H ▾   ◀◀  ▶  ❚❚  ▶▶   2024-03-12 14:00      [⌘K Search]   ⚙   👤 Alex ▾│  ← top bar 48px
├──────┬─────────────────────────────────────────────────────────────┬─────────────────────┤
│      │                                                             │  POSITIONS          │
│ ◰    │                                                             │  ┌────────────────┐ │
│ Re-  │                                                             │  │ EUR/USD  LONG  │ │
│ play │                                                             │  │ 1.0842  +$240  │ │
│      │                                                             │  └────────────────┘ │
│ ▣    │                          [ MAIN  CHART ]                    │  ┌────────────────┐ │
│ Bk-  │                                                             │  │ GBP/JPY  SHORT │ │
│ test │                       (candles, MAs, position lines)        │  │ 192.41  -$ 80  │ │
│      │                                                             │  └────────────────┘ │
│ ⚔    │                                                             │                     │
│ Bat- │                                                             │  ORDER TICKET       │
│ tles │                                                             │  ┌────────────────┐ │
│      │                                                             │  │ Size   [1.00 ] │ │
│ 📒   │                                                             │  │ SL     [1.080] │ │
│ Jrnl │                                                             │  │ TP     [1.090] │ │
│      │                                                             │  │ ┌─────┐ ┌────┐ │ │
│      │                                                             │  │ │ BUY │ │SELL│ │ │
│      │                                                             │  │ └─────┘ └────┘ │ │
│      │                                                             │  └────────────────┘ │
│      │─────────────────────────────────────────────────────────────│                     │
│      │  [Volume / RSI / MACD studies pane — collapsible]           │  STATS              │
│      │                                                             │  Equity   $12,440   │
│ ──── │─────────────────────────────────────────────────────────────│  Today    +$ 320    │
│  ⓘ   │  [Replay scrubber: ──────●═════════════════════════════]    │  Win rate  62 %     │
│      │   2024-03-01  ───────────●──────────────────  2024-03-31    │  Streak    🔥 4     │
├──────┴─────────────────────────────────────────────────────────────┴─────────────────────┤
│ TRADES   ORDERS   ALERTS   JOURNAL                                                        │  ← tabs
│ ─────────                                                                                 │
│ Time           Pair      Side   Entry    Exit     P&L         Notes                      │
│ 14:23 ·  Mar 8 EURUSD    LONG   1.0820   1.0855   +$ 350      —                          │
│ 11:02 ·  Mar 8 GBPJPY    SHORT  192.80   192.41   +$ 390      news fade                  │
│ 09:15 ·  Mar 7 USDJPY    LONG   151.10   150.90   -$ 200      stopped out                │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        ↑                          ↑                                          ↑
   left rail 56px          flexible chart canvas                       right rail 320px
```

**Spatial logic**
- 48px top bar (instrument, timeframe, replay transport, command, account)
- 56px collapsible left rail with mode icons (Replay / Backtest / Battles / Journal)
- Right rail 320px holds: positions list (scrollable), order ticket (sticky), session stats (sticky-bottom)
- Bottom tab strip is full-width, swaps content panel below the chart
- Studies pane between chart and scrubber is resizable + collapsible
- Chart canvas takes whatever remains — minimum 640px, otherwise it punishes you

---

## 12. Tailwind Config Snippet

```js
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Brand & accent
        brand: {
          400: '#5FB8FD',
          500: '#3DA9FC',
          600: '#2D8FDB',
          700: '#1E6FAE',
        },
        accent: {
          400: '#F0C055',
          500: '#E8B339',
          600: '#C7951E',
        },

        // Status
        bull:  { 400: '#3FE0A2', 500: '#16C784', 600: '#0FA46A' },
        bear:  { 400: '#F25762', 500: '#EA3943', 600: '#C8242E' },
        warn:  { 400: '#F5C642', 500: '#F0B90B', 600: '#C99A09' },
        info:  { 400: '#5FB8FD', 500: '#3DA9FC', 600: '#0A6CC9' },

        // Surfaces (dark — default)
        surface: {
          0: '#0B0F17',
          1: '#11161F',
          2: '#171D28',
          3: '#1F2632',
        },
        // Foreground
        fg: {
          muted:   '#8593A8',
          default: '#C9D1DC',
          strong:  '#F2F4F8',
        },
        // Borders
        line: {
          DEFAULT: '#2A3140',
          strong:  '#3A4254',
        },

        // Chart
        chart: {
          bull:      '#22C28B',
          bear:      '#E04757',
          wick:      '#5C6678',
          vol:       '#3A4254',
          ma1:       '#3DA9FC',
          ma2:       '#E8B339',
          grid:      '#1F2632',
          crosshair: '#8593A8',
        },
      },

      fontFamily: {
        display: ['Söhne', 'Inter Tight', '-apple-system', 'system-ui', 'sans-serif'],
        sans:    ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        xs:   ['11px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        sm:   ['12px', { lineHeight: '18px', letterSpacing: '0.01em' }],
        base: ['13px', { lineHeight: '20px' }],
        md:   ['14px', { lineHeight: '22px' }],
        lg:   ['16px', { lineHeight: '24px', letterSpacing: '-0.005em' }],
        xl:   ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        '2xl':['24px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
        '3xl':['32px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        '4xl':['44px', { lineHeight: '52px', letterSpacing: '-0.025em' }],
      },

      borderRadius: {
        none: '0',
        sm:   '3px',
        md:   '5px',
        lg:   '8px',
        xl:   '12px',
        full: '9999px',
      },

      boxShadow: {
        sm:   '0 1px 2px rgba(0, 0, 0, 0.32)',
        md:   '0 4px 12px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255,255,255,0.02)',
        lg:   '0 12px 32px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255,255,255,0.03)',
        glow: '0 0 0 1px rgba(61, 169, 252, 0.40), 0 4px 18px rgba(61, 169, 252, 0.28)',
      },

      spacing: {
        0.5: '2px',
        1.5: '6px',
      },

      transitionTimingFunction: {
        'fx-out': 'cubic-bezier(0.2, 0, 0.2, 1)',
        'fx-emphasis': 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        80:  '80ms',
        140: '140ms',
        220: '220ms',
        360: '360ms',
      },
    },
  },
  plugins: [],
};
```

### Light-mode override (paste into your global CSS)

```css
[data-theme="light"] {
  --tw-color-surface-0: #F7F8FA;
  --tw-color-surface-1: #FFFFFF;
  --tw-color-surface-2: #FAFBFD;
  --tw-color-surface-3: #EEF1F6;
  --tw-color-line:      #DCE1EA;
  --tw-color-line-strong: #B8C0CE;
  --tw-color-fg-muted:    #5A6478;
  --tw-color-fg-default:  #1F2533;
  --tw-color-fg-strong:   #0A0E16;
  --tw-color-chart-bull:  #108A5A;
  --tw-color-chart-bear:  #BB2832;
  --tw-color-chart-grid:  #EEF1F6;
}
```

---

## Closing principle

> **Density is respect.** Every padding decision, every type size, every animation millisecond is in service of a trader's eyes scanning thousands of bars in a session. When in doubt: tighter, calmer, more monospaced, less decorated.
