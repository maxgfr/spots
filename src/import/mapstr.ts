/**
 * Reading a Mapstr export, which comes as two files that each hold half of a place: the
 * GeoJSON has its position and the colours of its tags, the CSV (date, name, address, icon,
 * userComment, rating, tags joined by "#", photos) has its stars and the day it was saved.
 * The two are matched by name and address; either file alone is enough (places from the CSV
 * alone have no position and are geocoded later). A "To try" tag becomes the place's state.
 */

import { foldName } from "../share/share";
import { normalizeRating } from "../store/merge";
import type { PlaceState, TagColor } from "../store/model";
import { TAG_COLORS } from "../store/model";
import { INKS } from "../ui/colors";
import { parseCsv } from "./csv";
import { coords, type ImportedTag, isObject, num, type TakeoutPlace, text } from "./takeout";

/** A place as the GeoJSON gives it. */
export interface MapstrGeoPlace {
  name: string;
  address: string;
  note: string;
  lat?: number;
  lng?: number;
  /** Mapstr's own icon name ("restaurant", "cafe"...). */
  icon: string;
  tags: { name: string; color: string }[];
}

/** A place as the CSV gives it. */
export interface MapstrCsvPlace {
  name: string;
  address: string;
  note: string;
  icon: string;
  rating?: number;
  createdAt?: number;
  tags: string[];
}

/**
 * Mapstr's icons, as keys of TAG_ICONS (src/ui/icons.tsx, kept out of this module so that it
 * stays free of the interface; a test checks every key exists). "generic" has no glyph.
 */
export const MAPSTR_ICONS: Record<string, string> = {
  restaurant: "utensils",
  cafe: "coffee",
  bakery: "croissant",
  bar: "cocktail",
  wine: "wine",
  nightclub: "music",
  shopping: "shop",
  supermarket: "store",
  fitness: "sport",
};

/** The glyph a tag takes when none of its places has a known icon, as for a tag made by hand. */
const NO_ICON = "pin";

const TO_TRY = new Set(["to try", "a essayer", "a tester", "want to go"]);

/** Whether a tag means the place is still to try ("To try", "À essayer"...). */
export function isToTry(tagName: string): boolean {
  return TO_TRY.has(foldName(tagName));
}

function rgb(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return undefined;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The label ink nearest to a colour (by RGB distance), "ink" when there is none. Inks in
 * `taken` are passed over while another is left, so distinct colours keep distinct inks.
 */
export function inkFor(
  hex: string | undefined,
  taken: ReadonlySet<TagColor> = new Set(),
): TagColor {
  const target = hex ? rgb(hex) : undefined;
  if (!target) return "ink";
  const free = TAG_COLORS.filter((c) => !taken.has(c));
  let best: TagColor = "ink";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of free.length > 0 ? free : TAG_COLORS) {
    const fill = rgb(INKS[color].fill);
    if (!fill) continue;
    const d = fill.reduce((sum, v, i) => sum + (v - (target[i] ?? 0)) ** 2, 0);
    if (d < bestDistance) {
      best = color;
      bestDistance = d;
    }
  }
  return best;
}

/** Glyphs a tag's own name points to (folded), tried before its places' icons. */
const NAME_ICONS: [RegExp, string][] = [
  [/boulang|patiss|bakery|pastr|croissant/, "croissant"],
  [/glace|ice ?cream|gelat/, "ice-cream"],
  [/\bcafes?\b|coffee/, "coffee"],
  [/\bvins?\b|wine/, "wine"],
  [/biere|beer|\bpubs?\b/, "beer"],
  [/\bbars?\b|cocktail/, "cocktail"],
  [/restau|food|cuisine/, "utensils"],
];

/** The glyph a tag's name points to, if any (a key of TAG_ICONS). */
export function iconForName(name: string): string | undefined {
  const folded = foldName(name);
  return NAME_ICONS.find(([re]) => re.test(folded))?.[1];
}

/** Whether a parsed JSON value is a Mapstr GeoJSON export (and not Google's Saved Places). */
export function isMapstrGeojson(json: unknown): boolean {
  if (!isObject(json) || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    return false;
  }
  return json.features.some((f) => {
    const props = isObject(f) && isObject(f.properties) ? f.properties : null;
    return (
      props !== null &&
      typeof props.name === "string" &&
      Array.isArray(props.tags) &&
      !("google_maps_url" in props) &&
      !("location" in props)
    );
  });
}

/** The places of a Mapstr GeoJSON export. */
export function parseMapstrGeojson(json: unknown): MapstrGeoPlace[] {
  if (!isMapstrGeojson(json) || !isObject(json) || !Array.isArray(json.features)) return [];
  const out: MapstrGeoPlace[] = [];
  for (const feature of json.features) {
    if (!isObject(feature) || !isObject(feature.properties)) continue;
    const props = feature.properties;
    const name = text(props.name);
    if (name === "") continue;
    const geometry = isObject(feature.geometry) ? feature.geometry : {};
    const [lng, lat] = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const position = coords(lat, lng);
    const tags = (Array.isArray(props.tags) ? props.tags : [])
      .filter(isObject)
      .map((t) => ({ name: text(t.name), color: text(t.color) }))
      .filter((t) => t.name !== "");
    out.push({
      name,
      address: text(props.address),
      note: text(props.userComment),
      icon: text(props.icon),
      tags,
      ...(position ?? {}),
    });
  }
  return out;
}

const CSV_COLUMNS = ["name", "address", "usercomment", "rating", "tags"];

/** Whether a CSV header row is a Mapstr export's. */
export function isMapstrCsvHeader(header: string[]): boolean {
  const columns = header.map((h) => h.trim().toLowerCase());
  return CSV_COLUMNS.every((c) => columns.includes(c));
}

/** The places of a Mapstr CSV export. */
export function parseMapstrCsv(csv: string): MapstrCsvPlace[] {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows.shift();
  if (!header || !isMapstrCsvHeader(header)) return [];
  const columns = header.map((h) => h.trim().toLowerCase());
  const cell = (row: string[], name: string) => text(row[columns.indexOf(name)]);

  const out: MapstrCsvPlace[] = [];
  for (const row of rows) {
    const name = cell(row, "name");
    if (name === "") continue;
    const place: MapstrCsvPlace = {
      name,
      address: cell(row, "address"),
      note: cell(row, "usercomment"),
      icon: cell(row, "icon"),
      tags: [
        ...new Set(
          cell(row, "tags")
            .split("#")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ],
    };
    const rating = normalizeRating(num(cell(row, "rating")));
    if (rating !== undefined) place.rating = rating;
    const date = Date.parse(cell(row, "date"));
    if (Number.isFinite(date)) place.createdAt = date;
    out.push(place);
  }
  return out;
}

function key(name: string, address: string): string {
  return `${foldName(name)}\n${foldName(address)}`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const group = out.get(k);
    if (group) group.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** A place with its two halves, before its tags are resolved. */
interface Joined {
  geo?: MapstrGeoPlace;
  csv?: MapstrCsvPlace;
}

/** Pairs each GeoJSON place with its CSV row: same name and address, or a name unique to both. */
function join(geo: MapstrGeoPlace[], csv: MapstrCsvPlace[]): Joined[] {
  const byKey = groupBy(csv, (c) => key(c.name, c.address));
  const csvByName = groupBy(csv, (c) => foldName(c.name));
  const geoByName = groupBy(geo, (g) => foldName(g.name));
  const used = new Set<MapstrCsvPlace>();
  const out: Joined[] = [];
  for (const g of geo) {
    let match = byKey.get(key(g.name, g.address))?.find((c) => !used.has(c));
    if (!match) {
      const name = foldName(g.name);
      const sameName = csvByName.get(name) ?? [];
      const only = sameName[0];
      if (sameName.length === 1 && geoByName.get(name)?.length === 1 && only && !used.has(only)) {
        match = only;
      }
    }
    if (match) used.add(match);
    out.push(match ? { geo: g, csv: match } : { geo: g });
  }
  for (const c of csv) if (!used.has(c)) out.push({ csv: c });
  return out;
}

/** A tag's name and colour as the place carries them (the GeoJSON's, or the CSV's names). */
function tagsOf(j: Joined): { name: string; color: string }[] {
  if (j.geo && j.geo.tags.length > 0) return j.geo.tags;
  return (j.csv?.tags ?? []).map((name) => ({ name, color: "" }));
}

/**
 * The tags of all places, by folded name: first spelling, first colour, the glyph its name
 * points to or else its places' commonest. The most used tags pick their ink first.
 */
function resolveTags(joined: Joined[]): Map<string, ImportedTag> {
  const seen = new Map<
    string,
    { name: string; color: string; count: number; icons: Map<string, number> }
  >();
  for (const j of joined) {
    const icon = MAPSTR_ICONS[j.geo?.icon || j.csv?.icon || ""];
    for (const t of tagsOf(j)) {
      if (isToTry(t.name)) continue;
      const k = foldName(t.name);
      let entry = seen.get(k);
      if (!entry) {
        entry = { name: t.name, color: t.color, count: 0, icons: new Map() };
        seen.set(k, entry);
      }
      entry.count++;
      entry.color ||= t.color;
      if (icon) entry.icons.set(icon, (entry.icons.get(icon) ?? 0) + 1);
    }
  }
  const out = new Map<string, ImportedTag>();
  const taken = new Set<TagColor>();
  const byUse = [...seen].sort(([, a], [, b]) => b.count - a.count);
  for (const [k, entry] of byUse) {
    let icon = iconForName(entry.name) ?? NO_ICON;
    if (icon === NO_ICON) {
      let most = 0;
      for (const [i, n] of entry.icons) {
        if (n > most) {
          icon = i;
          most = n;
        }
      }
    }
    const color = inkFor(entry.color, taken);
    if (entry.color) taken.add(color);
    out.set(k, { name: entry.name, color, icon });
  }
  return out;
}

function stateOf(tagNames: string[], rating: number | undefined): PlaceState {
  if (tagNames.some(isToTry)) return "try";
  return rating === 5 ? "favorite" : "visited";
}

/**
 * The places of a Mapstr export, from its GeoJSON, its CSV or both, ready to import: matched
 * halves joined, tags resolved (a "To try" tag turned into the state), and the CSV rows the
 * GeoJSON lacks kept without a position.
 */
export function combineMapstr(geo: MapstrGeoPlace[], csv: MapstrCsvPlace[]): TakeoutPlace[] {
  const joined = join(geo, csv);
  const tags = resolveTags(joined);
  return joined.map((j) => {
    const g = j.geo;
    const c = j.csv;
    const names = tagsOf(j).map((t) => t.name);
    const placeTags = [...new Set(names.map(foldName))]
      .map((k) => tags.get(k))
      .filter((t): t is ImportedTag => t !== undefined);
    const out: TakeoutPlace = {
      name: g?.name || c?.name || "",
      address: g?.address || c?.address || "",
      note: c?.note || g?.note || "",
      state: stateOf(names, c?.rating),
    };
    if (g?.lat !== undefined && g.lng !== undefined) {
      out.lat = g.lat;
      out.lng = g.lng;
    }
    if (placeTags.length > 0) out.tags = placeTags;
    if (c?.rating !== undefined) out.rating = c.rating;
    if (c?.createdAt !== undefined) out.createdAt = c.createdAt;
    return out;
  });
}
