# Wantaja — UI Design System

Aesthetic concept: **Torchlit Stone Dungeon**. Warm amber torchlight pooling against cold hewn stone. Every element feels physically crafted — carved wood, pressed stone, aged parchment. Inspired by classic 2D MMORPGs (Tibia, Margonem).

---

## Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&family=Cinzel+Decorative:wght@400;700;900&family=Cinzel:wght@400;600;700&family=Press+Start+2P&family=VT323&family=IM+Fell+English&display=swap" rel="stylesheet">
```

| Font | Use |
|---|---|
| `Cinzel Decorative` | Page titles, modal headings, overlay headers |
| `Cinzel` | Subheadings, labels, buttons, card titles, footers |
| `VT323` | Body text, card descriptions, secondary copy |
| `Press Start 2P` | Game stats, timers, numbers (pixel-art feel) |
| `Orbitron` / `Share Tech Mono` | Reserved for Phaser canvas HUD (do not use in HTML UI) |
| `IM Fell English` | Optional: lore/flavour text with aged imperfection |

**Rule:** Never use Arial, Inter, Roboto, or system fonts in HTML UI.

---

## Colour Palette

```css
--wood-dark:      #2c1a0e;   /* Panel backgrounds, deep surfaces */
--wood-mid:       #4a2e15;   /* Borders, dividers */
--wood-light:     #7a4a1e;   /* Button top face */
--gold-bright:    #c9a227;   /* Primary accent, active borders, titles */
--gold-dim:       #8b6914;   /* Labels, secondary text, inactive states */
--gold-text:      #f0c060;   /* Text on wooden buttons */
--parchment:      #e8d5a0;   /* Main body text on dark backgrounds */
--parchment-dim:  #d4c9a8;   /* Secondary body text */
--shadow-deep:    #1a1208;   /* Page background, deep shadows */
--stone-bg:       #0e0c08;   /* Home screen background */
--red-dark:       #6a2a2a;   /* Destructive/danger button face */
--red-border:     #8a3030;   /* Danger button rim */
```

---

## Global Base

```css
body {
  background: #1a1208;
  font-family: 'VT323', serif;
  overflow: hidden; /* game-specific; remove for scrollable subpages */
}
```

---

## Backgrounds

### Page / Home Screen — Stone Grid
```css
background-color: #0e0c08;
/* Two grid sizes create an organic brick-offset feel — no animation */
background-image:
  repeating-linear-gradient(0deg,  transparent 0, transparent 29px, rgba(0,0,0,0.2) 29px, rgba(0,0,0,0.2) 30px),
  repeating-linear-gradient(90deg, transparent 0, transparent 29px, rgba(0,0,0,0.2) 29px, rgba(0,0,0,0.2) 30px),
  repeating-linear-gradient(0deg,  transparent 0, transparent 14px, rgba(0,0,0,0.07) 14px, rgba(0,0,0,0.07) 15px),
  repeating-linear-gradient(90deg, transparent 0, transparent 59px, rgba(0,0,0,0.07) 59px, rgba(0,0,0,0.07) 60px);
```

### Torchlight Vignette (pseudo-element overlay)
```css
/* Apply via ::after on the screen container */
background:
  radial-gradient(ellipse 60% 50% at 50% 50%, rgba(201,162,39,0.06) 0%, transparent 70%),
  radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.65) 100%);
pointer-events: none;
```

### Waiting Area / In-Game Background
```css
background-color: #0a0806;
background-image:
  repeating-linear-gradient(0deg,   transparent 0px, transparent 29px, rgba(0,0,0,0.25) 29px, rgba(0,0,0,0.25) 30px),
  repeating-linear-gradient(90deg,  transparent 0px, transparent 29px, rgba(0,0,0,0.25) 29px, rgba(0,0,0,0.25) 30px),
  radial-gradient(ellipse at center, #1e1408 0%, #0a0806 100%);
```

### Parchment Card Texture (on dark panels)
```css
/* Layer this under the dark bg colour */
background:
  repeating-linear-gradient(-45deg, rgba(201,162,39,0.018) 0px, rgba(201,162,39,0.018) 1px, transparent 1px, transparent 7px),
  rgba(26,18,8,0.97);
```

---

## Cards / Panels

```css
.card {
  background:
    repeating-linear-gradient(-45deg, rgba(201,162,39,0.018) 0px, rgba(201,162,39,0.018) 1px, transparent 1px, transparent 7px),
    rgba(26,18,8,0.97);
  border: 2px solid #4a2e15;
  border-radius: 14px;             /* 6px for tighter/smaller cards */
  color: #e8d5a0;
  box-shadow:
    0 8px 48px rgba(0,0,0,0.75),
    0 0 0 1px rgba(74,46,21,0.3),
    inset 0 1px 0 rgba(201,162,39,0.1);
}

.card:hover {
  border-color: rgba(201,162,39,0.5);
  box-shadow: 0 0 18px rgba(201,162,39,0.1), inset 0 0 12px rgba(201,162,39,0.03);
}

/* Card heading */
.card h1, .card h2 {
  font-family: 'Cinzel Decorative', serif;
  color: #c9a227;
  text-shadow: 0 0 18px rgba(201,162,39,0.5), 0 2px 4px rgba(0,0,0,0.8);
}

/* Card subtitle */
.card .subtitle {
  font-family: 'Cinzel', serif;
  color: #8b6914;
}
```

### ASCII Corner Decoration (optional, dungeon-map feel)
```css
.card::before { content: '┌─'; position: absolute; top: 6px; left: 8px; font-size: 0.65rem; color: rgba(74,46,21,0.4); }
.card::after  { content: '─┘'; position: absolute; bottom: 6px; right: 8px; font-size: 0.65rem; color: rgba(74,46,21,0.4); }
```

---

## Overlays / Modals

**Critical:** Always use `align-items: flex-start` + `overflow-y: auto` on the fixed container, and `margin: auto 0` on the inner card. This centers content when it fits the viewport and scrolls when it doesn't — never clip.

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: flex-start;   /* NOT center — that clips overflow */
  justify-content: center;
  overflow-y: auto;
  z-index: 200;
  padding: 16px;
}

.overlay-card {
  margin-top: auto;          /* These two lines together center when */
  margin-bottom: auto;       /* content fits, scroll from top when tall */
  max-width: 440px;
  width: 100%;
}
```

---

## Wooden 3D Buttons (primary action)

The asymmetric border widths simulate a 3D press-down wooden plank.

```css
.btn-wood {
  font-family: 'Cinzel', serif;
  font-weight: 700;
  color: #f0c060;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0px, transparent 1px, transparent 9px),
    linear-gradient(180deg, #7a4a1e 0%, #5a3010 100%);
  border-top:    2px solid #9a6028;   /* rim light — lighter = light from above */
  border-left:   2px solid #8a5020;
  border-right:  2px solid #3a1e08;
  border-bottom: 5px solid #1a0e04;  /* 3D depth/thickness */
  border-radius: 6px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
  box-shadow: 0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
  cursor: pointer;
  transition: opacity 0.2s, transform 0.1s, box-shadow 0.2s;
}

.btn-wood:hover {
  box-shadow: 0 2px 12px rgba(0,0,0,0.5), 0 0 8px rgba(201,162,39,0.2), inset 0 1px 0 rgba(255,255,255,0.06);
  opacity: 0.95;
}

.btn-wood:active {
  transform: translateY(3px);
  border-bottom-width: 2px;   /* collapses the depth = pressed */
}

.btn-wood:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  border-bottom-width: 5px;
}
```

### Danger / Destructive Button (red-wood variant)
```css
.btn-danger {
  /* Same structure as .btn-wood but red tones */
  background: linear-gradient(180deg, #6a2a2a, #4a1a1a);
  color: #f0a0a0;
  border-top:    2px solid #8a3030;
  border-left:   2px solid #7a2828;
  border-right:  2px solid #2a0808;
  border-bottom: 5px solid #1a0808;
}
```

### Subtle Link Button
```css
.btn-link {
  background: none;
  border: 1px solid rgba(74,46,21,0.5);
  border-radius: 6px;
  color: #8b6914;
  font-size: 0.8rem;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.btn-link:hover { color: #c9a227; border-color: rgba(201,162,39,0.4); }
```

---

## Inputs

```css
input, textarea, select {
  background: rgba(12,8,4,0.7);
  border: 2px solid #4a2e15;
  border-radius: 8px;
  color: #e8d5a0;
  font-family: 'VT323', serif;
  outline: none;
  transition: border-color 0.2s;
}

input::placeholder { color: rgba(201,162,39,0.25); }
input:focus        { border-color: #c9a227; }
```

---

## Tabs

```css
.tab-btn {
  background: rgba(42,28,14,0.7);
  color: #8b6914;
  border: 1px solid rgba(74,46,21,0.5);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.tab-btn.active {
  background: rgba(201,162,39,0.14);
  color: #f0c060;
  border-color: rgba(201,162,39,0.45);
}

.tab-btn:hover:not(.active) {
  background: rgba(74,46,21,0.4);
  color: #c9a227;
}
```

---

## Typography Scale

```css
/* Page title */
h1.hero { font-family: 'Cinzel Decorative', serif; font-size: clamp(2.4rem, 6vw, 4.2rem); color: #c9a227; }

/* Section heading */
h2      { font-family: 'Cinzel Decorative', serif; font-size: 1.5rem; color: #c9a227; }

/* Card / panel heading */
h3      { font-family: 'Cinzel', serif; font-size: 1.05rem; color: #e8d5a0; }

/* Label (above inputs, sections) */
label   { font-family: 'Cinzel', serif; font-size: 0.78rem; color: #8b6914; letter-spacing: 1px; text-transform: uppercase; }

/* Body copy */
p       { font-family: 'VT323', serif; font-size: 1rem; color: #d4c9a8; line-height: 1.5; }

/* Stat numbers */
.stat   { font-family: 'Press Start 2P', monospace; font-size: 0.65rem; }

/* Footer / small print */
small   { font-family: 'Cinzel', serif; font-size: 0.68rem; color: #4a2e10; letter-spacing: 3px; text-transform: uppercase; }
```

---

## Animations

### Torch Flicker (title glow pulse)
```css
@keyframes torchFlicker {
  0%, 100% { text-shadow: 0 0 20px rgba(201,162,39,0.5), 0 0 60px rgba(201,162,39,0.15), 0 2px 4px rgba(0,0,0,0.9); }
  33%       { text-shadow: 0 0 28px rgba(201,162,39,0.65), 0 0 80px rgba(201,162,39,0.22), 0 2px 4px rgba(0,0,0,0.9); }
  66%       { text-shadow: 0 0 16px rgba(201,162,39,0.38), 0 0 45px rgba(201,162,39,0.10), 0 2px 4px rgba(0,0,0,0.9); }
}
/* Usage: animation: torchFlicker 3s ease-in-out infinite; */
```

### Cursor Blink
```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
/* Usage on a thin vertical bar element: animation: blink 1.1s step-end infinite; */
/* Cursor colour: #c9a227 */
```

### Card Entrance (staggered reveal)
```css
@keyframes cardFadeIn {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Usage: opacity: 0; animation: cardFadeIn 0.5s ease forwards; */
/* Stagger with animation-delay: 0.15s, 0.30s, 0.45s per card */
```

### Rank Slide-In (results list)
```css
@keyframes rankSlideIn {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

---

## Scrollbar Styling

```css
element {
  scrollbar-width: thin;
  scrollbar-color: rgba(201,162,39,0.4) transparent;
}
element::-webkit-scrollbar { width: 5px; }
element::-webkit-scrollbar-track { background: transparent; }
element::-webkit-scrollbar-thumb { background: rgba(201,162,39,0.4); border-radius: 3px; }
```

---

## Responsive Breakpoints

The UI uses three breakpoints. **Always add `overflow-y: auto` to fixed overlays** — never rely on `align-items: center` alone.

| Breakpoint | Target | Notes |
|---|---|---|
| `max-width: 768px` | Tablets | Tighten padding, collapse some layouts |
| `max-width: 480px` | Phones | Single-column cards, smaller fonts, stacked buttons |
| `max-width: 360px` | Small phones (iPhone SE) | Minimum font sizes, minimal padding |

### Touch Targets
All interactive elements must be at least **48px tall** on mobile (`min-height: 48px`).

### Overlay scrolling pattern (mobile-safe)
```css
/* On the fixed wrapper: */
align-items: flex-start;
overflow-y: auto;
padding: 16px;

/* On the card inside: */
margin-top: auto;
margin-bottom: auto;
```

---

## Z-Index Stack

| Layer | Value | Element |
|---|---|---|
| Game canvas | — | `#game` (Phaser, behind everything) |
| Chat | 100 | `#chat-wrapper` |
| Home screen | 190 | `#home-screen` |
| Join overlay | 200 | `#overlay` |
| Reconnecting | 300 | `#reconnecting-banner` |
| Session ended | 400 | `#session-ended-overlay` |
| Rankings / Modals | 500 | `#final-rankings-overlay`, `#register-modal` |

New subpages/overlays should slot into this stack without conflicting values.

---

## Quick Checklist for New Subpages

- [ ] Use `Cinzel Decorative` for the main heading
- [ ] Use `Cinzel` for labels, subheadings, buttons
- [ ] Use `VT323` for body text / descriptions
- [ ] Stone grid or parchment texture on backgrounds
- [ ] Primary buttons use the 3D wooden style (asymmetric borders)
- [ ] Inputs have `rgba(12,8,4,0.7)` background + `#4a2e15` border + gold focus
- [ ] Fixed overlays: `align-items: flex-start` + `overflow-y: auto`
- [ ] Cards have `margin: auto 0` inside scrollable overlays
- [ ] All gold accents use `#c9a227` (bright) or `#8b6914` (dim)
- [ ] No white, no neon green, no purple gradients
- [ ] Mobile: test on 360px wide viewport; all content must be reachable
