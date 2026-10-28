# spots

**Pin the places you love on a map, and keep them in your browser.** Restaurants, cafés, bars,
shops, sights, a friend's tip: each one becomes a label on your map, in the colour of its tag.
No account, no server, no API key.

**[Open spots → maxgfr.github.io/spots](https://maxgfr.github.io/spots/)**
- **Pin in seconds.** Search a place, paste a Google Maps, Apple Maps or OpenStreetMap link (or
  bare coordinates), press and hold the map, or pin where you stand. A found restaurant lands in
  your Food tag on its own.
- **Tags and states.** Each tag has an ink and a glyph, printed on every label of its places and
  usable as a filter. A label's shape says where you stand: a ring for _to try_, filled once
  _visited_, a second ring for a _favourite_.
- **Lists you can share.** Group places for a trip or a city, show one list alone on the map, and
  send it as a link. The link carries the list itself (compressed in the `#fragment`, which no
  server sees); whoever opens it can add it to their own notebook.
- **Bring your Google Maps saves.** Pick the Takeout zip as you get it: starred places and saved
  lists come in, lists stay lists, and places without coordinates are found by name.
- **Works offline.** The app is cached after the first visit, the map keeps the areas you have
  seen, and _Keep this area offline_ stores a whole neighbourhood down to street level.
- **Sync through your own GitHub.** Optional: paste a fine-grained token that can only touch
  gists, and your notebook is kept in a secret gist of yours. Every device merges record by
  record (the newer edit wins, deletions included), and the gist's history keeps every version.
- **AI, with your own provider.** Optional, through
  [llm-connect](https://github.com/maxgfr/llm-models/tree/main/packages/llm-connect) and
  [llm-models](https://github.com/maxgfr/llm-models): paste a friend's message or an article (or
  dictate it) and the AI pins the places it names; ask _"a cheap dinner near me I haven't
  tried?"_ and it answers from your own places. OpenAI, Anthropic, Gemini, Mistral, any
  OpenAI-compatible provider, or a local server (Ollama, LM Studio).
- **English and French**, following your browser. Light and dark, following your system.

## What leaves your device

Your notebook lives in `localStorage`. The page talks to:

| Where                         | What for                                                                                  | When                        |
| ----------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- |
| `tiles.openfreemap.org`       | Map tiles, fonts and sprites ([OpenFreeMap](https://openfreemap.org), OpenStreetMap data) | Always, as you move the map |
| `photon.komoot.io`            | Search and reverse lookup ([Photon](https://photon.komoot.io))                            | When you search or pin      |
| `nominatim.openstreetmap.org` | Reverse lookup when Photon finds nothing                                                  | When you press the map      |
| `api.github.com`              | Your secret gist                                                                          | Only if you connect GitHub  |
| Your AI provider              | What you ask the AI to read                                                               | Only if you set up the AI   |

A strict Content-Security-Policy keeps every script, style and font to the site itself; there is
no analytics and no tracking. The GitHub token stays in this browser; the AI key is encrypted at
rest under a non-extractable WebCrypto key (llm-connect's `secureStorage`).

## Sync with GitHub

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new).
2. Under _Account permissions_, set **Gists** to _Read and write_. Nothing else.
3. In spots, open _Menu → GitHub sync_ and paste it.

spots looks for a gist holding `spots.json` and creates a secret one if there is none, so a
second device connected to the same account finds the same notebook.

## Import from Google Maps

On [takeout.google.com](https://takeout.google.com/), keep only _Maps (your places)_ and
_Saved_, export, and pick the zip in _Menu → Import & export_. `Saved Places.json` (your starred
places) and the CSV of each saved list are read in the browser. A JSON backup of spots imports
the same way and merges with what you have.

## Develop

```bash
bun install
bun run dev        # rebuilds on change, serves http://localhost:5173/spots/
bun run test       # unit tests
bun run test:e2e   # builds, then Playwright in Chromium
bun run typecheck && bun run lint
bun run build      # dist/, deployed to GitHub Pages by .github/workflows/pages.yml
```

Bun builds `index.html` (Preact and signals, MapLibre GL); `scripts/build.ts` injects the CSP,
copies the MapLibre worker and the fonts, and writes a service worker that precaches the app and
keeps map tiles. The AI code (the AI SDK, zod, the provider SDKs) is only loaded when the AI is
used.

| Path           |                                                                                         |
| -------------- | --------------------------------------------------------------------------------------- |
| `src/store/`   | The notebook (`model.ts`), its persistence (`store.ts`) and the sync merge (`merge.ts`) |
| `src/map/`     | MapLibre view and the recoloured OpenFreeMap Positron style                             |
| `src/app/`     | Shell, search, sheet and screens                                                        |
| `src/geo/`     | Photon / Nominatim geocoding, maps link parsing                                         |
| `src/share/`   | Lists as compressed links                                                               |
| `src/import/`  | Google Takeout, CSV, JSON backups                                                       |
| `src/sync/`    | GitHub Gist client and sync loop                                                        |
| `src/ai/`      | llm-connect settings, extraction and questions                                          |
| `src/offline/` | Keeping an area's tiles                                                                 |

## Credits

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, tiles by
[OpenFreeMap](https://openfreemap.org), © OpenMapTiles. Search by [Photon](https://photon.komoot.io)
(komoot) and [Nominatim](https://nominatim.org). Icons by [Lucide](https://lucide.dev). Fonts:
Barlow Condensed and Figtree (SIL Open Font License).

## License

[MIT](LICENSE)
