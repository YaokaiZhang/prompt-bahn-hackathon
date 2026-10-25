---
name: Control Room
description: Bahn's car delivery control room, where agents check orders and operators decide.
colors:
  birch: "#fffef7"
  sand-50: "#f1eee6"
  sand-100: "#e2ded4"
  sand-200: "#ccc6ba"
  sand-300: "#b7afa0"
  grey-500: "#8a7f6b"
  muted: "#685f4f"
  brown: "#5a5346"
  body: "#2a2721"
  ink: "#12110e"
  asphalt-panel: "rgba(30, 28, 23, 0.96)"
  orange: "#fd6a31"
  orange-ink: "#a14623"
  orange-bg: "#ffece3"
  orange-on-dark: "#ffa27e"
  red: "#fd4a61"
  red-ink: "#a13342"
  red-bg: "#ffe8ec"
  red-on-dark: "#ff8e9d"
  teal: "#43afc1"
  teal-ink: "#205058"
  teal-bg: "#dcf4f7"
  teal-on-dark: "#85cdd9"
  green: "#29af77"
  green-ink: "#1b6c4a"
  green-bg: "#daf4e9"
  green-on-dark: "#76cda9"
typography:
  display-hero:
    fontFamily: "Archivo, Owners Wide, system-ui, sans-serif"
    fontSize: "clamp(40px, 5vw, 64px)"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 125"
  display:
    fontFamily: "Archivo, Owners Wide, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 900
    lineHeight: 0.98
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.6vw, 32px)"
    fontWeight: 700
    lineHeight: 1.18
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum'"
  body-strong:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.3
    fontFeature: "'tnum'"
  label:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "'tnum'"
  button:
    fontFamily: "Figtree, Duplet Open, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
rounded:
  pill: "999px"
  lg: "24px"
  card: "18px"
  md: "16px"
  sm: "12px"
spacing:
  card-gap: "8px"
  inset: "18px"
  panel: "24px"
  block: "28px"
  gutter: "32px"
  section: "56px"
  bar: "72px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.birch}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.body}"
  button-tertiary:
    backgroundColor: "{colors.sand-100}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-tertiary-hover:
    backgroundColor: "{colors.sand-200}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "38px"
  field:
    backgroundColor: "{colors.sand-50}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "48px"
  field-focus:
    backgroundColor: "{colors.birch}"
  nav-track:
    backgroundColor: "{colors.sand-50}"
    rounded: "{rounded.pill}"
    padding: "4px"
  nav-item:
    textColor: "{colors.brown}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  nav-item-current:
    backgroundColor: "{colors.birch}"
    textColor: "{colors.ink}"
  filter:
    backgroundColor: "{colors.sand-50}"
    textColor: "{colors.brown}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "30px"
  filter-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.birch}"
  filter-needs-action:
    backgroundColor: "{colors.red-bg}"
    textColor: "{colors.red-ink}"
  pill:
    backgroundColor: "{colors.sand-50}"
    textColor: "{colors.body}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "26px"
  queue-card:
    backgroundColor: "{colors.sand-50}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "14px 18px 15px"
  queue-card-hover:
    backgroundColor: "{colors.sand-100}"
  queue-card-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.birch}"
  panel:
    backgroundColor: "{colors.sand-50}"
    rounded: "{rounded.lg}"
    padding: "8px 24px 12px"
  inset-block:
    backgroundColor: "{colors.birch}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  hero-card:
    backgroundColor: "{colors.asphalt-panel}"
    textColor: "{colors.birch}"
    rounded: "{rounded.lg}"
    padding: "28px 32px 30px"
---

# Design System: Control Room

## Overview

**Creative North Star: "The Bahn Yard Office"**

The Control Room lives inside Bahn's own visual world: the bahn.com vehicle transport page is the binding reference, so the system is warm birch paper, asphalt ink and sand-toned panels, with every control shaped as a pill. It reads as a calm operations desk, not a dashboard. Surfaces are flat tonal layers of sand on birch; there are almost no lines and almost no shadows, and hierarchy comes from tone, size and weight.

Type carries the brand. One wide, heavy, uppercase display cut names the page and the car, and nothing else. Everything an operator reads to decide (reasons, dates, routes, counts) is set in a friendly humanist sans with tabular figures, at sizes that stay legible on a daylight laptop and on a projector. Colour is semantic and rare: orange and red belong to the route's two ends and to risk; teal means live work; green means delivered. The ground stays quiet so those signals can be found at a glance.

Density is medium. Headlines say what is wrong; secondary labels and descriptions that repeat what the layout already says are left out. Lists are stacks of rounded sand cards separated by small gaps, the selected item inverts to asphalt, and detail opens in a large sand panel beside the list, not in a modal. No coloured strips or underline bars mark groups.

The tokens are defined as custom properties in `starter/app/globals.css`, the fonts load through next/font in `starter/app/layout.tsx`, and the signature pieces live in `starter/app/components/shell.tsx`, `starter/app/components/card.tsx`, `starter/app/components/route-line.tsx` and `starter/app/components/record/header.tsx`.

**Key Characteristics:**
- Birch ground, sand panels, asphalt ink; depth by tone, not shadow.
- Pill geometry for every control, 24px radius for large panels.
- Wide 900-weight uppercase display for page titles and car names only.
- Figtree with tabular figures for all working text.
- Orange pickup, red delivery and critical, teal live, green delivered.
- Selection is inversion to asphalt.

## Colors

A warm, near-monochrome sand-and-asphalt ramp, with four signal hues used only for meaning.

### Primary
- **Asphalt Ink** (ink): primary text, primary buttons, the pressed filter, the selected queue card, and the active progress fill. It is the system's only "accent" for action.
- **Asphalt Panel** (asphalt-panel): the translucent dark card on the order page that overlaps the foot of the car image and carries the car name and key facts.

### Secondary
- **Pickup Orange** (orange): the pickup pin, the marketplace stage dot. Its text-safe shade **Rust** (orange-ink) and fill **Peach Wash** (orange-bg) mark risk and warnings; internal notes use Peach Wash as their ground.
- **Delivery Red** (red): the delivery pin and the cancelled stage dot. **Brick** (red-ink) and **Blush Wash** (red-bg) mark critical items and the Needs-action filter.

### Tertiary
- **Live Teal** (teal): live work, the moving stage, tracked leg progress and ETA. **Deep Teal** (teal-ink) and **Glacier Wash** (teal-bg) for text and fills.
- **Delivered Green** (green): the delivered stage and completed legs. **Pine** (green-ink) and **Mint Wash** (green-bg) for text and fills.
- **On-dark tints** (red-on-dark, orange-on-dark, teal-on-dark, green-on-dark): the lighter signal shades used only on asphalt surfaces (the selected queue card's reason line, pills inside the dark order panel, where they become fills under ink text).

### Neutral
- **Birch** (birch): the page ground, text on asphalt, and inset blocks inside sand panels (route stops, open-items list).
- **Sand 50** (sand-50): the default panel, card, field, nav track and pill ground.
- **Sand 100** (sand-100): hover on sand, tertiary buttons, dividers inside panels, the image placeholder.
- **Sand 200** (sand-200): tertiary hover, unfilled progress track, underline colour for links, secondary text on asphalt.
- **Sand 300** (sand-300) and **Stone** (grey-500): stage dots for intake and ready; Stone is also the focus ring.
- **Muted Umber** (muted): secondary text, metadata, counts.
- **Brown** (brown): nav labels, filter labels, small role labels.
- **Body** (body): long-form body text and the primary-button hover.

### Named Rules
**The Signals Mean Something Rule.** Orange, red, teal and green appear only where they encode pickup, delivery or critical, risk, live work, or done. They are never decoration, and a hue never swaps roles.

**The Ink Is The Accent Rule.** The action colour is asphalt, not a brand hue. Primary buttons, the pressed filter and the selected card are all ink on birch inverted.

**The Wash-For-Fill Rule.** Signal hues fill a surface only through their wash (`*-bg`) with their ink shade as text; the saturated 500 shade is reserved for dots, pins and progress.

## Typography

**Display Font:** Archivo at 125% width, weight 900 (stand-in for Bahn's Owners Wide; with system-ui fallback)
**Body Font:** Figtree (stand-in for Bahn's Duplet Open; with system-ui fallback)

**Character:** A stretched, heavy, uppercase display gives each page and each car a poster-like name in Bahn's voice; Figtree keeps everything else warm, open and quick to scan, with tabular figures so times and counts line up.

### Hierarchy
- **Display Hero** (900, clamp(40px, 5vw, 64px), 0.98, uppercase, 125% width): the car name on the order page.
- **Display** (900, 44px, 0.98, uppercase, 125% width): page titles (queue, inbox, entity and index pages; 40px on state pages, 34px under 760px viewport height or 900px width). The car name in the queue preview uses the same cut at clamp(34px, 3.4vw, 48px).
- **Headline** (700, clamp(24px, 2.6vw, 32px), 1.18, -0.015em): the order's story headline and the inbox message subject; max 34ch. The preview story line is 22px, 600.
- **Title** (700, 22px, -0.01em): section heads; date values use 20px, 700.
- **Body** (400, 15px, 1.45, tabular): the default. Story detail runs at 18px, preview detail 16px; long text is held to 60 to 80ch.
- **Body Strong** (700, 16px): car names in queue cards, stop names, step names.
- **Label** (600, 13px to 14px): pills, filters, stop roles, small field labels in Muted Umber. Sentence case, never tracked uppercase.

### Named Rules
**The Two Names Rule.** The wide display cut is used for exactly two things: the page title and the car's name. Section heads, numbers, buttons and labels are Figtree.

**The Tabular Rule.** Tabular figures are on at the root; times, counts and distances must align in every list.

## Layout

A fixed 72px top bar on birch (wordmark, a "Control Room" label behind a hairline, a pill nav in a sand track, the snapshot clock right-aligned) sits over a full-height workspace with a 32px gutter.

The Not normal board (`/`) is a main area and a rail. Needs action fills the main area as a grid of situation cards (auto-fill, min 380px, 12px gap); Confirm before publishing and In progress sit in a sticky 300–360px rail beside it, In progress as one tonal list of two-line rows. Section heads are a 20px bold label and its count: no rule, strip or tint under them; the grouping is the layout. The Pipeline (`/board`) is five tonal Sand 50 lanes (20px radius) with sticky heads and compact birch tiles. Under 1100px the rail drops below the main area and the lanes scroll sideways with snap.

List-and-detail screens (the support inbox, the Briefing) are a two-column grid: a left column of minmax(380px, 460px) (inbox minmax(340px, 420px)) holding the display title, tools and a scrolling stack of cards, and a right column that is one large scrolling sand panel. The gap is 20px. Each column scrolls on its own with contained overscroll; the page itself does not scroll on these screens.

Record pages (order, customer, driver, place) are a single centred column, max 1180px, with sections 56px apart and blocks 28px apart. Inside panels, birch inset blocks sit on sand with 16px to 20px padding; lists of cards are separated by 6px to 8px gaps.

Responsive: under 1180px the "Control Room" label and clock subline drop. Under 900px the gutter becomes 16px, the bar becomes 60px and wraps the nav to its own scrolling row, the preview panel is hidden and cards open the order page directly, the selected card no longer inverts, and the route stacks vertically. Under 760px viewport height on desktop, the queue head compacts (34px title, tighter tool spacing, 42px search field).

## Elevation & Depth

The system is flat and tonal. Depth is birch below, sand above, birch inset inside sand, and asphalt for the one dark overlay. Shadows exist only as small, functional cues, never as card elevation.

### Shadow Vocabulary
- **Current tab lift** (`box-shadow: 0 1px 3px rgba(18, 17, 14, 0.1)`): the current nav item, a birch pill raised slightly out of its sand track.
- **Sticky action edge** (`box-shadow: 0 -10px 16px -12px rgba(18, 17, 14, 0.18)`): the top edge of the sticky action bar in the preview panel, showing content scrolls under it.
- **Inset hairline** (`box-shadow: inset 0 0 0 1px var(--sand-100 or --sand-200)`): field hover, open folded records, operator messages, keyboard keys. A drawn edge without a border box.
- **Pin halo** (`box-shadow: 0 0 0 3px var(--birch), 0 0 0 4px currentColor`): route pins, a birch gap and a ring in the pin's own colour.

### Named Rules
**The Tone Not Shadow Rule.** A surface is separated from its parent by a step in the sand ramp. Do not add drop shadows to cards or panels.

**The One Dark Panel Rule.** Asphalt Panel is the only dark surface besides the selected-card inversion; it appears once per order page, overlapping the foot of the 3:1 car image by 96px (40px on small screens).

## Shapes

Every control is a full pill (999px): buttons, fields, the nav track and its items, filters, pills, the route summary bar, the image-note badge. Large containers (preview panel, record panels, the dark order panel, the hero image) use 24px. Queue and inbox cards use 18px. Inset blocks, the car picture in the preview, dates and folded records use 16px. Small embedded blocks (proposal blocks, step instructions, file thumbnails, error notes) use 12px. Dots and pins are circles. Lines are rare: hairline 1px dividers in sand-50 or sand-100 between list rows, and a 1px sand-200 rule between the wordmark and the "Control Room" label. Progress lines are 4px with 2px rounded ends.

## Components

### Buttons
Soft, confident pills in Bahn's two-tone pair.
- **Shape:** full pill (999px), 48px tall; small size 38px.
- **Primary:** asphalt with birch text, 16px semibold, 22px side padding. Hover shifts to Body.
- **Tertiary:** Sand 100 with ink text; hover Sand 200; disabled Sand 50 with Stone text.
- **Link button:** semibold Brown text with a Sand 200 underline offset 4px; hover darkens text and underline to ink.
- **Focus:** a 3px Stone outline offset 2px, everywhere.
- **Motion:** background and colour transitions at 0.18s on the house ease, cubic-bezier(0.22, 1, 0.36, 1).

### Chips
- **Pill:** 26px tall, 13px semibold, Sand 50 ground. Tone variants use the signal wash with the signal ink. A stage pill leads with an 8px stage dot.
- **Filter:** 30px stage filters with a count in lighter weight. Pressed inverts to asphalt with a Sand 200 count. The Needs-action filter rests in Blush Wash with Brick text when not pressed.

### Cards / Containers
- **Situation card** (`app/components/situation.tsx`): 24px radius, Sand 50 (birch inside the Briefing's sand panel), padding 18px 22px 20px. A muted line with the car and reference, the deadline right-aligned (Brick when urgent); a 21px 800-weight headline saying what is wrong; one or two 15.5px sentences of situation and suggestion; then one asphalt primary pill for the suggested step and an outlined "Choose another step" pill that opens a small birch menu. The text is a deterministic shortening of the engine's words (`lib/present/situation.ts`). On the order page it leads the record at headline size (`sit-lead`). Used on the board, in the Briefing and on the order page.
- **Pipeline tile:** 14px radius, birch on the Sand 50 lane, padding 10px 12px. Car name 14.5px bold with a 20px state tag right only when the order is not normal (Urgent, Needs action, Confirm, In progress); reference and route in Muted Umber.
- **Outlined pill** (`btn-quiet`): transparent with a 1.5px Sand 200 inset ring; the secondary action beside an asphalt primary.
- **Preview panel:** one 24px Sand 50 panel; content rises in over 0.28s on each selection; a sticky action bar holds "Open order" and the keyboard hint.
- **Inset block:** birch on sand, 16px radius, 16px to 20px padding; route stops and the open-items list.
- **Record panel:** Sand 50, 24px radius, 8px 24px 12px padding; rows divided by Sand 100 hairlines.
- **Folded record:** 16px Sand 50 row with icon, title, count and chevron; opens to birch with an inset hairline and the chevron rotates 90 degrees.

### Inputs / Fields
- **Style:** a 48px pill in Sand 50 with a leading icon, Muted Umber placeholder.
- **Hover:** birch ground with a 1px Sand 200 inset hairline.
- **Focus:** birch ground with a 2px ink inset ring; icon and text darken to ink.

### Navigation
- **Top bar:** 72px, birch, sticky. Wordmark at 22px height in ink (the Bahn wordmark SVG from the reference page), "Control Room" in 15px semibold Brown behind a hairline.
- **Nav:** a Sand 50 pill track with 4px padding holding 40px pill links in 15px semibold Brown. Hover Sand 100 and ink. Current is a birch pill with ink text and the current-tab lift.
- **Snapshot clock:** right-aligned, the time in 14px semibold ink over a 13px Muted Umber line.
- **Keyboard:** J/K or the arrow keys move the queue selection; Enter opens the selected order. Keys are shown as small birch keycaps with an inset hairline.

### Route Line (signature)
Bahn's route drawing: an orange pickup pin, a line, a red delivery pin, transfers in ink. In full form it is a three-part grid (stop, leg, stop) of birch stop blocks with the leg between: a 4px Sand 200 track whose ink fill (teal when live, solid green when done) grows to the leg's progress once per render over 0.7s. The compact form for the preview is a birch pill: pickup city, a teal progress line, delivery city, then distance and transfers in Muted Umber. Under 900px the full form stacks with a vertical leg line.

### Order Hero (signature)
The 3:1 car illustration in a 24px frame (16:9 on small screens), labelled "Model illustration" by a translucent asphalt pill with a 10px backdrop blur, with the Asphalt Panel overlapping its foot. Inside the panel: stage and status pills on 12% birch or on-dark tints with ink text, the car name in Display Hero, facts in Sand 200 with birch values and underlined links.

## Do's and Don'ts

### Do:
- **Do** build every control as a 999px pill: asphalt primary, Sand 100 tertiary, Sand 50 fields and tracks.
- **Do** separate surfaces by stepping the sand ramp (birch, Sand 50, Sand 100) rather than with borders or shadows.
- **Do** mark selection by inverting to asphalt with birch text and the on-dark signal tints.
- **Do** keep orange for pickup and risk, red for delivery and critical, teal for live work, green for delivered.
- **Do** set times, counts and distances in Figtree with tabular figures.
- **Do** use the 3px Stone focus ring on every interactive element and honour reduced motion by removing animation.

### Don't:
- **Don't** use the wide Archivo display for anything but page titles and car names.
- **Don't** fill a surface with a saturated signal hue; use its wash with its ink shade as text.
- **Don't** drop-shadow cards or panels; shadows are limited to the current-tab lift, the sticky action edge, inset hairlines and pin halos.
- **Don't** introduce a second dark surface beyond the selected-card inversion and the order page's Asphalt Panel.
- **Don't** use square or lightly rounded controls; buttons, fields, filters and pills are always full pills.
- **Don't** present the car illustration as a photo of the car; it always carries its "Model illustration" note.
