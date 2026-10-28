---
name: spots
description: A personal map notebook where every saved place is a printed luggage label and the map is the suitcase.
colors:
  shell: "#1f3fa8"
  on-shell: "#ffffff"
  action: "#c93a1e"
  action-deep: "#a72e16"
  on-action: "#ffffff"
  mustard: "#f2b731"
  paper: "#ffffff"
  paper-2: "#f2f4fa"
  paper-3: "#e6eaf5"
  hole: "#e9edf6"
  ink: "#16182a"
  ink-2: "#474c68"
  ink-3: "#62678a"
  rule: "rgba(22, 24, 42, 0.12)"
  rule-strong: "rgba(22, 24, 42, 0.24)"
  ok: "#1e6b4e"
  danger: "#b3261e"
  night-hole: "#131a2e"
  night-shell: "#172f80"
  night-paper: "#1b2033"
  night-paper-2: "#232a42"
  night-paper-3: "#2c3451"
  night-ink: "#eef0f8"
  night-ink-2: "#b9bfd6"
  night-ink-3: "#9aa1bf"
  tag-tangerine: "#ec7a2c"
  tag-sky: "#4b9be0"
  tag-mustard: "#f2b731"
  tag-bottle-green: "#1e6b4e"
  tag-plum: "#7a2e6e"
  tag-teal: "#0f6f78"
  tag-rose: "#b8405f"
  tag-black: "#16182a"
  tag-slate: "#5a6386"
  ground-land: "#e9edf6"
  ground-water: "#bccdee"
  ground-park: "#d3e4d6"
  ground-building: "#dbe1ef"
  ground-label: "#5a6386"
  ground-label-strong: "#2a3150"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "31px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  action:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "21px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.06em"
  stamp:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.1em"
  label-tag:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.09em"
  body:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  body-strong:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.45
  small:
    fontFamily: "Figtree, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  stamp: "8px"
  item: "10px"
  field: "12px"
  panel: "14px"
  menu: "16px"
  pill: "9999px"
spacing:
  hair: "6px"
  tight: "8px"
  gap: "12px"
  stack: "14px"
  sheet: "18px"
  bar: "56px"
components:
  pin-button:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.action}"
    rounded: "{rounded.pill}"
    padding: "0 22px 0 16px"
    height: "52px"
  pin-button-hover:
    backgroundColor: "{colors.action-deep}"
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-hover:
    backgroundColor: "{colors.paper-2}"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.action-deep}"
  button-shell:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.on-shell}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  top-bar:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.on-shell}"
    padding: "8px 10px 8px 14px"
    height: "{spacing.bar}"
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 6px 0 14px"
    height: "42px"
  tag-label:
    backgroundColor: "{colors.tag-tangerine}"
    textColor: "{colors.ink}"
    typography: "{typography.label-tag}"
    rounded: "{rounded.pill}"
    padding: "0 12px 0 8px"
    height: "32px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "34px"
  chip-selected:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.on-shell}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "10px 13px"
    height: "46px"
  state-toggle:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label-tag}"
    rounded: "{rounded.field}"
    padding: "0 8px"
    height: "44px"
  state-toggle-selected:
    textColor: "{colors.ink}"
  stamp:
    textColor: "{colors.ok}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "5px 10px 4px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "0 18px 18px"
    width: "400px"
  place-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "7px 18px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "10px 10px 10px 16px"
---

# Design System: spots

## Overview

**Creative North Star: "The Labelled Suitcase"**

Every saved place is a printed hotel or luggage label, and the map is the suitcase they are stuck on. The world is lithographed rather than rendered: flat, saturated inks printed inside a white die-cut rim, set on a quiet cobalt-tinted basemap that never competes with them. A cobalt shell (the top bar) frames the case; a single vermilion pill is the one thing to press; the sheet that holds every screen is itself a baggage tag, with clipped shoulders, a punched eyelet that shows the map's ground through it, and a dashed perforation above its stub.

Meaning is split cleanly between colour and form. Colour belongs to tags: a place's label wears its tag's ink and glyph. A place's state is told by shape alone: a ring for "to try", a filled label once visited, a second ring for a favourite, and on the sheet a rotated rubber stamp. Selecting a place lifts its label off the map as a tilted sticker with its name on a paper strip, and every other label fades behind it.

Density follows the moment. On a phone the map stays full-bleed and the tag sheet peeks from the bottom; at a desk the sheet becomes a fixed column on the left. The list packs hairline-ruled rows at small sizes; the place sheet ranks by weight and case, a condensed-caps name over reading-size text. The direction refused the category default of a grey basemap, teardrop pins and a blue-accent white sheet.

**Key Characteristics:**
- Cobalt shell, vermilion single action, eight flat tag inks plus slate for untagged places.
- Labels as die-cut circles: ink body, white rim, Lucide glyph printed on top.
- State by shape (ring, fill, double ring, stamp), never by hue.
- Barlow Condensed caps for anything printed on a label; Figtree for anything read.
- The sheet is a baggage tag: clipped 22px shoulders, eyelet, dashed perforated stub.
- Light and dark themes share the cobalt shell; paper and ink swap.

## Colors

A cobalt-and-vermilion shell over a pale cobalt-tinted map, with a box of eight saturated label inks that only tags may use.

### Primary
- **Cobalt Shell** (shell): the top bar, the cluster bubbles on the map, the shell button variant, selected list chips, the progress fill, toggle accents and menu-item icons. In dark mode it deepens to Night Cobalt (night-shell) but stays the frame.
- **White on Shell** (on-shell): wordmark, menu icon and anything printed on the bar.

### Secondary
- **Vermilion Pin** (action): the one primary action. The "Épingler" pin button, primary buttons, the wordmark dot and the draft pin dropped on the map. Hover deepens to **Fired Vermilion** (action-deep). Text on it is white (on-action).

### Tertiary
- **Label Mustard** (mustard): the focus ring wherever the ground is cobalt or dark (top bar, search field, the whole dark theme), text selection, the toast action, and pressed icons in dark mode. It is also a tag ink.

### Neutral
- **Label Paper** (paper): sheet, menus, results, buttons and fields. Steps down through **Paper Wash** (paper-2) for hover rows, notices and the segmented track, and **Paper Shade** (paper-3) for the eyelet's reinforcement ring and the progress track.
- **Map Hole** (hole): the colour seen through the eyelet, equal to the light basemap's land so the punch reads as a real hole.
- **Ledger Ink** (ink): text and the toast ground. **Ink Grey** (ink-2) for meta, hints and secondary labels; **Ink Faint** (ink-3) for placeholders and the search icon.
- **Hairline** (rule) for row separators and section rules; **Strong Hairline** (rule-strong) for button, chip and field borders and the dashed perforation.
- **Night paper and ink** (night-paper, night-paper-2, night-paper-3, night-ink, night-ink-2, night-ink-3, night-hole): the dark theme swaps these in through the same custom properties; nothing else changes role.

### Semantic
- **Bottle Stamp** (ok): the "Visité" / "Favori" stamp's ink and border; lifted to a pale mint in dark mode. **Signal Red** (danger): destructive button text and field errors (a salmon in dark mode).

### Tag inks
Each tag carries one ink and the text colour that reads on it: **Tangerine** (tag-tangerine), **Sky** (tag-sky) and **Mustard** (tag-mustard) print dark ink text; **Bottle Green** (tag-bottle-green), **Plum** (tag-plum), **Teal** (tag-teal), **Rose** (tag-rose) and **Black** (tag-black) print white. A place with no tag is printed in **Slate** (tag-slate), a colour no tag can take. The inks live in code as hex for the map (which cannot read CSS variables) and reach the interface as per-element `--fill` and `--on` properties.

### Map ground
The basemap is OpenFreeMap's Positron recoloured layer by layer: **Pale Cobalt Land** (ground-land), **Cobalt Water** (ground-water), **Sage Park** (ground-park), **Blue-grey Buildings** (ground-building), white major roads, and slate place names (ground-label, ground-label-strong for cities). A matching night ground is carried in the sidecar.

### Named Rules
**The Tag Owns Colour Rule.** On the map, colour means tag and nothing else. The stored tag keys "vermilion" and "cobalt" print as tangerine and sky precisely so no label is ever mistaken for the shell or the pin button.

**The One Vermilion Rule.** Vermilion marks the single act of pinning or confirming. One vermilion element per view; everything else is paper, ink or cobalt.

**The Mustard Focus Rule.** Focus is a 3px ring offset 2px, cobalt on paper and mustard on cobalt or in the dark theme; the ring always contrasts with what it sits on.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow), shipped at 600 and 800 only
**Body Font:** Figtree (with system-ui), shipped at 400, 600 and 700

**Character:** Barlow Condensed in tracked uppercase is the printed type of a luggage label: tight, loud, made to be read at a glance. Figtree is the handwriting of the notebook: open, round and calm for addresses, notes and lists. Numbers use tabular figures throughout.

### Hierarchy
- **Display** (800, 31px, line-height 1, lowercase): the "spots" wordmark only, followed by its vermilion dot.
- **Headline** (800, 32px, line-height 1, uppercase, balanced wrap): a place's name on its sheet; the peek header ("8 spots autour") and the empty state use the same face at 26px and 30px.
- **Title** (800, 24px, uppercase, 0.02em): screen headers (Tags, Lists, Sync, Import).
- **Action** (800, 21px, uppercase, 0.06em): the pin button's verb.
- **Stamp** (800, 18px, uppercase, 0.1em): the rotated visited / favourite stamp.
- **Label-tag** (600, 16px, uppercase, 0.06em): text printed on tag labels and the state toggles.
- **Label** (600, 14px, uppercase, 0.09em): section names on a sheet ("Listes"), result group heads, distances in list rows.
- **Body** (400, 16px, line-height 1.45): addresses, notes, inputs; 600 for row and result names; 700 (body-strong) for buttons and chips.
- **Small** (400, 14px): meta lines, hints, notices, the stub; list-row meta drops to 13px.

### Named Rules
**The Printed Caps Rule.** Anything printed on a label (a place's name, a tag, a state, a stamp, the pin verb) is Barlow Condensed in tracked caps. Anything a person reads as sentences stays in Figtree, sentence case.

**The Name Over Reading Rule.** A place sheet ranks by weight and case: one condensed-caps name, then everything at reading size (16px) with 14px for labels and the stub. Do not add intermediate heading sizes to a sheet.

## Layout

The map is always full-bleed and everything floats over it. The cobalt top bar is fixed at 56px plus the safe-area inset and holds the wordmark, a white pill search that flexes to fill (capped at 520px on desktop), and the menu button. The tag filter labels scroll in a single row 8px below the bar. The locate button and the pin button stack at the bottom right, 12px from the edge, and ride up with the sheet; they hide once the sheet covers more than 60% of the screen.

Below 900px the sheet is a bottom sheet inset 10px from each side with three resting heights: peek (188px), half (52% of the viewport) and full (viewport minus 118px, so a strip of map stays visible). It is dragged by its eyelet and snaps by position plus velocity; a tap or Enter toggles peek and half, arrow keys step. At 900px and above it becomes a 400px column fixed 12px from the left, from below the bar to 12px above the bottom, and the filters start at 424px; the map centres places in what stays visible.

Spacing is a small set of steps: 6px between chips and labels, 8px for row gaps, 12px between icons and text in rows, 14px between stacked blocks, 18px for the sheet's side padding and section rules. List rows are dense (7px vertical padding, hairline-ruled, bleeding to the sheet edges); menu items are roomier (56px minimum). Sheet controls are at least 44px tall; the exceptions are chips (34px), the filter labels (32px plus a 3px margin), the bar's search and menu button (42px) and the search clear button (32px).

**The Suitcase Rule.** The map is never framed or shrunk to a panel; the shell, sheet and controls sit on it, and the sheet never covers the whole map.

## Elevation & Depth

Fills are flat, depth is soft. Nothing has a gradient or a texture; separation comes from diffuse black-alpha shadows that lift paper off the map, and from spread-shadow rims that cut labels out of their ground. The dark theme deepens every shadow rather than lightening surfaces.

### Shadow Vocabulary
- **Bar** (`box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18)`): under the cobalt top bar.
- **Float** (`box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24)`, 0.5 in dark): the pin and locate buttons, search results, the pin menu, toasts.
- **Sheet** (`filter: drop-shadow(0 -4px 14px rgba(0, 0, 0, 0.2))`; on desktop `drop-shadow(0 6px 16px rgba(0, 0, 0, 0.22))`): a filter on the sheet's outer element so the clipped shoulders cast it.
- **Die-cut rim** (`box-shadow: 0 0 0 2.5px #ffffff, 0 1px 3px rgba(0, 0, 0, 0.18)`): filter labels and mini labels; the rim is paper-coloured inside the sheet.
- **Sticker** (`box-shadow: 0 8px 18px rgba(0, 0, 0, 0.38)`): the selected label lifted off the map, the deepest shadow in the system.

### Named Rules
**The Lifted Label Rule.** Shadows are soft, centred and black-alpha. The higher the object sits above the map (filters, then floats, then the sticker), the larger the blur; never a hard offset.

**The Die-Cut Rule.** A label is separated from its ground by a white (or paper) ring drawn as a spread shadow, not by a border inside its fill.

## Shapes

Two families. Labels are circles: map labels, mini labels in lists, the sticker, swatches, the draft pin and the eyelet. Everything you press is a pill whose radius is half its height (search 42px, buttons 44px, chips 34px, filter labels 32px, pin button 52px). Containers soften by role: fields, state toggles and notices at 12px, results, segmented controls and toasts at 14px, the pin menu at 16px, menu items and glyph tiles at 10px, the stamp at 8px.

The sheet is the one non-rounded silhouette: a rectangle whose two top corners are clipped at 45 degrees (22px shoulders) like a baggage tag, with a 16px eyelet punched at the top centre and ringed by a 4px reinforcement. The foot of a place sheet is a stub behind a 2px dashed perforation. The stamp is rotated -5 degrees, the sticker -8 degrees; nothing else is tilted.

**The Shape Is State Rule.** A place's state is drawn, not coloured: to try is a ring of ink on white, visited is a filled ink label, favourite adds a second ring outside the rim. The same shapes appear on the map, in list rows, in the sticker and on the state toggles.

**The Clipped Shoulder Rule.** The sheet's top corners are cut, never rounded; the cut and the eyelet are what make it a tag.

## Components

### Buttons
Tactile pills with a confident weight.
- **Shape:** fully rounded (radius half of a 44px height).
- **Default:** paper with a 1.5px strong-hairline border, ink text in Figtree 700; hover to paper wash. Three sit in an equal grid under a place (Y aller, Ouvrir, Zoomer).
- **Primary:** vermilion, no border, white text; hover to fired vermilion.
- **Shell:** cobalt with white text, for confirmations inside management screens (create list, choose a file, connect a Gist).
- **Danger:** default button with red text.
- **Disabled:** 50% opacity, not-allowed cursor.
- **Icon buttons:** 44px circles, transparent, paper-wash hover. On the bar they are 42px with a 12% white hover.

### Pin Button (signature)
The single primary action: a 52px vermilion pill with a plus and the verb in Barlow Condensed 800 caps (21px, 0.06em), float shadow, hover to fired vermilion. It opens a pin menu that pops from its bottom-right corner (scale 0.92 and 6px rise, 0.22s).

### Tag Labels and Chips
- **Filter label:** a 32px pill printed in the tag's ink, glyph plus name in condensed caps, with the white die-cut rim. Pressed adds a second ring of the same ink outside the rim and a small dot after the name.
- **Ink chip:** the same printed label on a place sheet (30px), rimmed in paper and a strong hairline.
- **Plain chip:** a 34px paper pill with a strong-hairline border and Figtree 700 14px, for actions and lists; selected fills with the tag's ink or cobalt and loses its border. Chip rows scroll sideways and fade out over the last 32px.

### Cards / Containers
- **Sheet:** label paper inside the clipped-shoulder tag, 18px side padding, sheet drop shadow.
- **Results and pin menu:** paper, 14px and 16px radius, float shadow, paper-wash hover rows.
- **Notice:** paper wash, 12px radius, 12px by 14px padding, 14px ink-grey text with ink emphasis.
- **Toast:** ink ground with paper text, 14px radius, a mustard text action (undo); stacks of up to three, bottom centre.

### Inputs / Fields
- **Style:** 46px minimum, 12px radius, 1.5px strong-hairline border, paper ground, 16px text; textareas grow with content up to 40% of the viewport; selects draw their own chevron in ink grey.
- **Focus:** border turns to the focus colour with a 3px ring of the same at 25% mix.
- **Search field:** a white 42px pill in the bar, always white in both themes, with a mustard focus ring.
- **Error:** 14px Signal Red text below the field.

### Navigation
The cobalt top bar is the only navigation chrome: the lowercase wordmark returns to the map, the menu button toggles to a close icon while the menu is open. Screens open inside the sheet with a 44px header (back button, condensed caps title, trailing actions). Menu entries are 56px hairline-ruled rows with a cobalt (mustard in dark) leading icon, a 600 title and a 14px ink-grey description.

### Labels on the Map (signature)
Each place is a 10px-radius ink circle inside a 13px white rim with a blurred shadow, its tag glyph printed at 0.58 scale. To try shrinks the body to white with a 2.6px ink stroke; favourite adds an outer 2.5px ink ring at 16px. Names appear from zoom 14.5 in 12px bold under the label. Clusters are cobalt circles with a 3px white stroke and white counts.

### Sticker (signature)
The selected place is lifted off the map as a 54px white disc rotated -8 degrees around a 46px ink body, with its name in condensed 800 caps on a white strip running right (or left near the edge). It lands with a 0.42s stick animation (drops from 1.5x, overshoots, settles); all other labels fade to 32% and clusters to 40%.

### Stamp and Stub (signature)
Marking a place visited or favourite prints a rotated stamp beside its name: 3px bottle-green border, 8px radius, condensed 800 caps, slammed in from 1.8x scale in 0.36s. The state toggles below are three equal 44px tiles, each with its shape swatch; the selected one takes a 2px ink border. The sheet ends on a dashed perforation and a small "Pinned" stub.

### Place Row
Dense list rows: a 32px mini label (same shapes as the map), a 600 name and 13px meta that both truncate, and the distance in condensed caps on the right, separated by hairlines and bleeding to the sheet edges.

## Do's and Don'ts

### Do:
- **Do** print every place as a die-cut circle in its main tag's ink, with the white rim and the tag's glyph; use slate for places without a tag.
- **Do** tell state by shape only: ring for to try, fill for visited, double ring for favourite, stamp on the sheet.
- **Do** keep vermilion for the single primary action of the view (the pin button or one primary button).
- **Do** set names, tags, states, stamps and the pin verb in Barlow Condensed tracked caps, and everything read as sentences in Figtree.
- **Do** dim every other label when one is selected, and lift the selected one as the tilted sticker.
- **Do** keep the sheet's clipped shoulders, eyelet and dashed stub in every screen and both themes.
- **Do** switch the focus ring to mustard on cobalt and in the dark theme.
- **Do** collapse every animation and transition when reduced motion is requested.

### Don't:
- **Don't** print a tag in the shell's cobalt or the pin's vermilion; tag inks are the eight in the box.
- **Don't** use hue to say whether a place is visited, to try or a favourite.
- **Don't** draw teardrop pins, a grey basemap, or a blue-accent white sheet.
- **Don't** round the sheet's top corners; they are cut.
- **Don't** use hard offset shadows or gradients; depth is soft black-alpha shadow over flat fills.
- **Don't** add heading sizes between the place name and reading text on a sheet.
- **Don't** set notes, addresses or long text in Barlow Condensed.
