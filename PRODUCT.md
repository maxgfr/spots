# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun (Bun.build, bun test), Preact with @preact/signals, TypeScript, Biome, Playwright; MapLibre GL with OpenFreeMap vector tiles. Same conventions as the author's other Bun app (maxgfr/toolbelt). Hosted on GitHub Pages at https://maxgfr.github.io/spots/, no backend.

## Users

Anyone who lands on the GitHub Pages site and wants to keep the places they care about: restaurants, bars, cafés, shops, sights, a friend's tip. They are often on a phone, in the street or just after hearing about a place, and sometimes at a desk preparing a trip. Lists travel between people by link; the recipient can open the list and keep it in their own notebook.

## Product Purpose

A personal map notebook of places, in the spirit of Mapstr, that lives entirely in the browser. Success means four moments are fast:
1. **Pin on the go**: on mobile, pin a place in a few seconds, by search, by pressing the map, by pasting a maps link, or by describing it to the AI.
2. **"Where should I go near here?"**: find your own places around you, filtered by tag or list.
3. **Plan a trip**: build a list for a city at a desk, then share it as a link.
4. **Bring what you already have**: import saved places from Google Maps (Takeout) and sort them.

## Positioning

No account, no server, no API key needed. Data stays in the browser (localStorage) and can be synced across devices through the user's own private GitHub Gist. Lists are shared through a link that carries the list itself. AI is optional and uses the user's own provider and key (llm-connect).

## Operating Context

- Mobile browser in the street, one hand, sometimes poor network: the app shell and already-seen map areas work offline.
- Desktop browser while planning: larger map, side panel, keyboard.
- Inputs: an address or name typed, a long press on the map, a Google Maps / Apple Maps / OpenStreetMap link pasted from a message, a Google Takeout export (Saved Places.json, saved lists CSV), free text or voice handed to the AI.
- Outputs: a shared list link, a JSON backup, a private Gist.

## Capabilities and Constraints

- Places: name, address, coordinates, note, tags, lists, visited flag, rating; created and edited in place.
- Tags (name, color, icon) and lists (name, description); filtering on map and list.
- Geocoding with Photon (komoot), and Nominatim for reverse lookups, both keyless and rate-limited by fair use.
- Map: MapLibre GL, OpenFreeMap tiles (no key), light and dark styles.
- Sync: private Gist through a fine-grained token with only the Gists permission; the token stays on the device; merge by id and update time with deletion tombstones.
- Sharing: a list encoded and compressed into the URL fragment, never sent to a server.
- Import: Google Takeout Saved Places (GeoJSON) and saved lists (CSV, geocoded by name), JSON backup round trip.
- Offline: precached app shell, runtime tile cache, and "keep this area offline".
- AI (optional, bring your own provider and key through llm-connect and llm-models): extract places from pasted text or voice, suggest tags, and answer questions about the user's own places. Data sent to the provider is stated before sending.
- Languages: English and French, following the browser, switchable and remembered.
- Constraints: static hosting only, strict CSP (scripts from the site only), no tracking.

## Brand Commitments

Name: **spots**. Lowercase, like the author's other tools (toolbelt, today).

## Evidence on Hand

None: no users, testimonials or metrics exist. Do not invent any. Demo content shown in screenshots must be labelled as sample data.

## Product Principles

1. Pinning beats organising: capture first, sort later.
2. The user's data is theirs: local by default, portable (JSON, Gist), never locked in.
3. Works with nothing: no key, no account, no server; every external service is optional or keyless.
4. Say what leaves the device: each network destination (tiles, geocoding, GitHub, AI provider) is named where it is used.

## Accessibility & Inclusion

WCAG 2.2 AA. Everything on the map is also reachable in the list view (keyboard and screen readers). Respects reduced motion and the system color scheme.
