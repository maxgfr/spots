/**
 * The import, kept outside the Import screen so that leaving the screen neither loses the
 * files picked nor stops the places coming in: coming back shows where it stands. Files picked
 * in several goes add up, so a Mapstr export's CSV and GeoJSON can come one after the other.
 * Closing the tab still stops it, so the page warns while it runs.
 *
 * Google's lists rarely carry coordinates, so those places are found by name, one at a time,
 * and the ones that cannot be found are listed rather than guessed. A place already in the
 * notebook is not looked up again: what the import knows and the place lacks is filled in.
 */
import { computed, effect, signal } from "@preact/signals";
import { unzipSync } from "fflate";
import { search } from "../geo/geocode";
import { fmt, l, plural, tr } from "../i18n";
import { parseBackup } from "../import/backup";
import { parseCsv } from "../import/csv";
import { enrichPatch, findExisting } from "../import/enrich";
import {
  combineMapstr,
  isMapstrCsvHeader,
  isMapstrGeojson,
  type MapstrCsvPlace,
  type MapstrGeoPlace,
  parseMapstrCsv,
  parseMapstrGeojson,
} from "../import/mapstr";
import {
  type ImportedTag,
  listNameFromFile,
  parseSavedListCsv,
  parseSavedPlaces,
  type TakeoutPlace,
} from "../import/takeout";
import { fitPlaces } from "../map/MapView";
import { foldName } from "../share/share";
import type { Doc, Place, PlaceSource, PlaceState } from "../store/model";
import {
  addList,
  addPlace,
  addTag,
  lists,
  mergeIn,
  places,
  tags,
  updatePlace,
} from "../store/store";
import { toast } from "../ui/ui";
import { go, route } from "./state";

export interface Batch {
  /** The list these places go to, or null for none. */
  list: string | null;
  /** The state of its places, unless a place has its own. */
  state: PlaceState;
  source: PlaceSource;
  places: TakeoutPlace[];
}

/** What one picked file holds; a Mapstr export's halves are kept apart until all are picked. */
interface Part {
  name: string;
  batches: Batch[];
  backup: Doc | null;
  skipped: string[];
  mapstrGeo: MapstrGeoPlace[];
  mapstrCsv: MapstrCsvPlace[];
}

export interface Found {
  /** The names of the files picked. */
  files: string[];
  batches: Batch[];
  backup: Doc | null;
  skipped: string[];
  /** Which halves of a Mapstr export were picked, or null when neither was. */
  mapstr: { geo: boolean; csv: boolean } | null;
}

export interface ImportResult {
  added: number;
  updated: number;
  existing: number;
  missing: string[];
}

const parts = signal<Part[]>([]);

/** The files picked so far, read and joined; null when none is. */
export const found = computed<Found | null>(() =>
  parts.value.length > 0 ? assemble(parts.value) : null,
);
export const reading = signal(false);
export const progress = signal<{ done: number; total: number } | null>(null);
export const running = computed(() => progress.value !== null);
export const result = signal<ImportResult | null>(null);
export const error = signal<string | null>(null);

const FAVOURITE_LISTS = /^(favou?rites?|favoris|starred|lieux favoris|adresses favorites)/i;

function stateForList(name: string): PlaceState {
  return FAVOURITE_LISTS.test(name.trim()) ? "favorite" : "try";
}

/** The header of a CSV text: its first line, read alone. */
function csvHeader(text: string): string[] {
  return parseCsv(text.split(/\r\n|\n|\r/, 1)[0] ?? "")[0] ?? [];
}

async function readFile(f: File): Promise<Part> {
  const out: Part = {
    name: f.name,
    batches: [],
    backup: null,
    skipped: [],
    mapstrGeo: [],
    mapstrCsv: [],
  };
  const entries: { name: string; text: string }[] = [];
  if (/\.zip$/i.test(f.name)) {
    const zip = unzipSync(new Uint8Array(await f.arrayBuffer()), {
      filter: (file) => /\.(json|geojson|csv)$/i.test(file.name),
    });
    const dec = new TextDecoder();
    for (const [name, data] of Object.entries(zip)) entries.push({ name, text: dec.decode(data) });
  } else entries.push({ name: f.name, text: await f.text() });
  for (const e of entries) {
    if (/\.csv$/i.test(e.name)) {
      if (isMapstrCsvHeader(csvHeader(e.text))) {
        out.mapstrCsv.push(...parseMapstrCsv(e.text));
        continue;
      }
      const list = parseSavedListCsv(e.text);
      if (list.length > 0) {
        const name = listNameFromFile(e.name);
        out.batches.push({
          list: name,
          state: stateForList(name),
          source: "google",
          places: list,
        });
      } else out.skipped.push(e.name);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(e.text);
    } catch {
      out.skipped.push(e.name);
      continue;
    }
    if (isMapstrGeojson(json)) {
      out.mapstrGeo.push(...parseMapstrGeojson(json));
      continue;
    }
    const backup = parseBackup(e.text);
    if (backup && Object.keys(backup.places).length + Object.keys(backup.lists).length > 0) {
      out.backup = backup;
      continue;
    }
    const saved = parseSavedPlaces(json);
    if (saved.length > 0) {
      // Saved Places.json holds the starred places.
      out.batches.push({ list: null, state: "favorite", source: "google", places: saved });
    } else out.skipped.push(e.name);
  }
  return out;
}

function hasPlaces(p: Part): boolean {
  return p.batches.length > 0 || p.backup !== null || p.mapstrGeo.length + p.mapstrCsv.length > 0;
}

/** All the parts as one import, the Mapstr halves joined (whichever file they came in). */
function assemble(all: Part[]): Found {
  const out: Found = {
    files: all.map((p) => p.name),
    batches: all.flatMap((p) => p.batches),
    backup: all.findLast((p) => p.backup)?.backup ?? null,
    skipped: all.flatMap((p) => p.skipped),
    mapstr: null,
  };
  const geo = all.flatMap((p) => p.mapstrGeo);
  const csv = all.flatMap((p) => p.mapstrCsv);
  if (geo.length + csv.length > 0) {
    out.mapstr = { geo: geo.length > 0, csv: csv.length > 0 };
    // Each place carries its own state; "visited" is only the fallback.
    out.batches.push({
      list: null,
      state: "visited",
      source: "mapstr",
      places: combineMapstr(geo, csv),
    });
  }
  return out;
}

/** Adds files to those picked (a file picked again replaces itself). */
export async function addFiles(files: File[]): Promise<void> {
  if (files.length === 0 || running.value) return;
  reading.value = true;
  error.value = null;
  result.value = null;
  try {
    const read: Part[] = [];
    for (const f of files) read.push(await readFile(f));
    if (!read.some(hasPlaces)) {
      error.value = tr(
        l(
          "No places found in these files. Pick the Takeout zip, “Saved Places.json”, the CSV files of your saved lists, the CSV and GeoJSON files of a Mapstr export, or a spots backup.",
          "Aucun lieu trouvé dans ces fichiers. Choisis le zip Takeout, « Saved Places.json », les fichiers CSV de tes listes enregistrées, les fichiers CSV et GeoJSON d'un export Mapstr, ou une sauvegarde spots.",
        ),
      );
      return;
    }
    const names = new Set(read.map((p) => p.name));
    parts.value = [...parts.value.filter((p) => !names.has(p.name)), ...read];
  } catch {
    error.value = tr(l("These files could not be read.", "Impossible de lire ces fichiers."));
  } finally {
    reading.value = false;
  }
}

/** Forgets the files picked, the last result and error. */
export function reset(): void {
  if (running.value) return;
  parts.value = [];
  result.value = null;
  error.value = null;
}

/** The counts of a result, the places added first. */
export function resultParts(r: ImportResult): string[] {
  const out = [
    `${r.added} ${plural(r.added, l("place added", "lieu ajouté"), l("places added", "lieux ajoutés"))}`,
  ];
  if (r.updated > 0)
    out.push(
      `${r.updated} ${plural(r.updated, l("updated", "mis à jour"), l("updated", "mis à jour"))}`,
    );
  if (r.existing > 0)
    out.push(
      `${r.existing} ${plural(r.existing, l("already there", "déjà présent"), l("already there", "déjà présents"))}`,
    );
  return out;
}

/** Brings the picked places in. Runs once at a time, whichever screen is open. */
export async function run(): Promise<void> {
  const f = found.value;
  if (!f || running.value) return;
  error.value = null;
  if (f.backup) {
    mergeIn(f.backup);
    toast(tr(l("Backup merged into your notebook", "Sauvegarde fusionnée dans ton carnet")));
  }
  const total = f.batches.reduce((n, b) => n + b.places.length, 0);
  let done = 0;
  let added = 0;
  let updated = 0;
  let existing = 0;
  const missing: string[] = [];
  const listIds = new Map<string, string>();
  const tagIds = new Map<string, string>();
  // A tag is made only when a place that carries it comes in, and once per name.
  const tagIdOf = (t: ImportedTag): string => {
    const key = foldName(t.name);
    const id =
      tagIds.get(key) ??
      tags.value.find((x) => foldName(x.name) === key)?.id ??
      addTag({ name: t.name, color: t.color, icon: t.icon }).id;
    tagIds.set(key, id);
    return id;
  };
  const tagIdsOf = (t: TakeoutPlace) => [...new Set((t.tags ?? []).map(tagIdOf))];
  const addedPlaces: Place[] = [];
  progress.value = { done, total };
  try {
    for (const batch of f.batches) {
      let listId: string | null = null;
      if (batch.list) {
        const same = lists.value.find((x) => foldName(x.name) === foldName(batch.list ?? ""));
        listId = listIds.get(batch.list) ?? same?.id ?? addList({ name: batch.list }).id;
        listIds.set(batch.list, listId);
      }
      for (const t of batch.places) {
        let lat = t.lat;
        let lng = t.lng;
        let address = t.address;
        const at = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
        // A place already in the notebook needs no lookup.
        let same = findExisting(places.value, t, at);
        if (!same && (lat === undefined || lng === undefined)) {
          try {
            const [hit] = await search([t.name, t.address].filter(Boolean).join(" "), {
              limit: 1,
            });
            if (hit) {
              lat = hit.lat;
              lng = hit.lng;
              address ||= hit.address;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 350));
          if (lat !== undefined && lng !== undefined) {
            same = findExisting(places.value, { name: t.name, address }, { lat, lng });
          }
        }
        done++;
        progress.value = { done, total };
        if (same) {
          const patch = enrichPatch(same, {
            note: t.note,
            tagIds: tagIdsOf(t),
            state: t.state ?? batch.state,
            source: batch.source,
            ...(t.rating !== undefined ? { rating: t.rating } : {}),
          });
          if (Object.keys(patch).length > 0) {
            updatePlace(same.id, patch);
            updated++;
          } else existing++;
          continue;
        }
        if (lat === undefined || lng === undefined) {
          missing.push(t.name);
          continue;
        }
        addedPlaces.push(
          addPlace({
            name: t.name,
            address,
            lat,
            lng,
            note: t.note,
            tagIds: tagIdsOf(t),
            listIds: listId ? [listId] : [],
            state: t.state ?? batch.state,
            ...(t.url && /^https?:\/\//.test(t.url) ? { url: t.url } : {}),
            ...(t.rating !== undefined ? { rating: t.rating } : {}),
            ...(t.createdAt !== undefined ? { createdAt: t.createdAt } : {}),
            source: batch.source,
          }),
        );
        added++;
      }
    }
  } catch {
    error.value = tr(
      l("The import stopped before the end.", "L'import s'est arrêté avant la fin."),
    );
  } finally {
    progress.value = null;
  }
  parts.value = [];
  const r = { added, updated, existing, missing };
  result.value = r;
  if (route.value.name !== "import" && total > 0) {
    const counts = resultParts(r);
    if (missing.length > 0)
      counts.push(
        fmt(l("{n} not found on the map", "{n} introuvables sur la carte"), { n: missing.length }),
      );
    toast(`${tr(l("Import done", "Import terminé"))} · ${counts.join(" · ")}`, {
      label: tr(l("See", "Voir")),
      run: () => go({ name: "import" }),
    });
  }
  if (addedPlaces.length > 0) fitPlaces(addedPlaces);
}

function warnOnLeave(e: BeforeUnloadEvent): void {
  e.preventDefault();
  // Safari and older browsers ask through returnValue.
  e.returnValue = "";
}

if (typeof window !== "undefined") {
  effect(() => {
    if (!running.value) return;
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  });
}
