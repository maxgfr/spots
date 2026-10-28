/**
 * Reading a Google Takeout export: "Saved Places.json" (a GeoJSON FeatureCollection, in its
 * current and its older shape) and the CSV files of saved lists ("Want to go.csv"...). Places
 * come out without ids or tags; those whose position is unknown have no lat/lng and need to be
 * geocoded from their name and address.
 */

import { parseMapLink } from "../geo/links";
import { parseCsv } from "./csv";

export interface TakeoutPlace {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  note: string;
  url?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function coords(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const la = num(lat);
  const ln = num(lng);
  if (la === undefined || ln === undefined) return undefined;
  if (la === 0 && ln === 0) return undefined;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return undefined;
  return { lat: la, lng: ln };
}

function joinNotes(...notes: string[]): string {
  return notes.filter((n) => n !== "").join("\n");
}

function place(
  name: string,
  address: string,
  note: string,
  url: string,
  position: { lat: number; lng: number } | undefined,
): TakeoutPlace {
  const out: TakeoutPlace = { name, address, note };
  if (url !== "") out.url = url;
  if (position) {
    out.lat = position.lat;
    out.lng = position.lng;
  }
  return out;
}

function fromFeature(feature: unknown): TakeoutPlace | null {
  if (!isObject(feature)) return null;
  const props = isObject(feature.properties) ? feature.properties : {};
  const geometry = isObject(feature.geometry) ? feature.geometry : {};
  // Newer exports: properties.location; older ones: properties.Location.
  const location = isObject(props.location) ? props.location : {};
  const oldLocation = isObject(props.Location) ? props.Location : {};
  const geo = isObject(oldLocation["Geo Coordinates"]) ? oldLocation["Geo Coordinates"] : {};

  const url = text(props.google_maps_url) || text(props["Google Maps URL"]);
  const address = text(location.address) || text(oldLocation.Address);
  const note = text(props.Comment) || text(props.comment);

  const [lng, lat] = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const link = url ? parseMapLink(url) : null;
  const position =
    coords(lat, lng) ??
    coords(geo.Latitude, geo.Longitude) ??
    (link?.lat !== undefined && link.lng !== undefined
      ? { lat: link.lat, lng: link.lng }
      : undefined);

  const name =
    text(location.name) ||
    text(props.Title) ||
    text(oldLocation["Business Name"]) ||
    link?.name ||
    address ||
    link?.query ||
    (position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : "");
  if (name === "") return null;
  return place(name, address, note, url, position);
}

/** The places of a Takeout "Saved Places.json" (current or older format). */
export function parseSavedPlaces(json: unknown): TakeoutPlace[] {
  if (!isObject(json) || !Array.isArray(json.features)) return [];
  const out: TakeoutPlace[] = [];
  for (const feature of json.features) {
    const p = fromFeature(feature);
    if (p) out.push(p);
  }
  return out;
}

/** The places of a Takeout saved list CSV (Title, Note, URL, [Tags,] Comment). */
export function parseSavedListCsv(csv: string): TakeoutPlace[] {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows.shift();
  if (!header) return [];
  const columns = header.map((h) => h.trim().toLowerCase());
  const col = (name: string) => columns.indexOf(name);
  const title = col("title");
  if (title < 0) return [];
  const noteCol = col("note");
  const urlCol = col("url");
  const commentCol = col("comment");
  const cell = (row: string[], index: number) => (index < 0 ? "" : text(row[index]));

  const out: TakeoutPlace[] = [];
  for (const row of rows) {
    const name = cell(row, title);
    if (name === "") continue;
    const url = cell(row, urlCol);
    const link = url ? parseMapLink(url) : null;
    const position =
      link?.lat !== undefined && link.lng !== undefined
        ? { lat: link.lat, lng: link.lng }
        : undefined;
    const note = joinNotes(cell(row, noteCol), cell(row, commentCol));
    out.push(place(name, "", note, url, position));
  }
  return out;
}

/** The list name for an exported file: "Takeout/Saved/Want to go.csv" gives "Want to go". */
export function listNameFromFile(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "").trim() || base.trim();
}
