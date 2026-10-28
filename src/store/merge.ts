/**
 * Merging two copies of the notebook, for sync. Each collection is a union by id; when both
 * sides hold a record, the one with the larger `updatedAt` wins, and a tie is broken by
 * comparing the records' canonical JSON so that the result does not depend on argument order.
 * A tombstone is an ordinary record and follows the same rule. The merge is commutative,
 * associative and idempotent, and never mutates its inputs (records are shared, not copied).
 *
 * Also here: dropping old tombstones, comparing two docs, and turning untrusted JSON into a Doc.
 */

import type { Doc, Entry, List, Place, PlaceSource, PlaceState, Tag, TagColor } from "./model";
import { TAG_COLORS } from "./model";

const DAY_MS = 24 * 60 * 60 * 1000;

const PLACE_STATES: readonly PlaceState[] = ["try", "visited", "favorite"];
const PLACE_SOURCES: readonly PlaceSource[] = [
  "search",
  "map",
  "link",
  "google",
  "ai",
  "share",
  "import",
];

/** JSON with object keys sorted at every level, so equal values give equal strings. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const v = record[key];
      if (v === undefined || typeof v === "function") continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The winner between two versions of the same record. */
function pick<T extends Entry>(x: T, y: T): T {
  if (x.updatedAt !== y.updatedAt) return x.updatedAt > y.updatedAt ? x : y;
  return canonicalJson(x) >= canonicalJson(y) ? x : y;
}

function mergeRecords<T extends Entry>(
  a: Record<string, T>,
  b: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [id, record] of Object.entries(b)) {
    const mine = out[id];
    out[id] = mine === undefined ? record : pick(mine, record);
  }
  return out;
}

/** Merges two docs: per record, the latest `updatedAt` wins, ties broken deterministically. */
export function merge(a: Doc, b: Doc): Doc {
  return {
    version: 1,
    places: mergeRecords(a.places, b.places),
    tags: mergeRecords(a.tags, b.tags),
    lists: mergeRecords(a.lists, b.lists),
  };
}

function purgeRecords<T extends Entry>(
  records: Record<string, T>,
  now: number,
  maxAgeMs: number,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, record] of Object.entries(records)) {
    if (record.deletedAt !== undefined && now - record.deletedAt > maxAgeMs) continue;
    out[id] = record;
  }
  return out;
}

/** Drops the tombstones deleted more than `maxAgeMs` ago (90 days by default). */
export function purgeTombstones(doc: Doc, now: number, maxAgeMs = 90 * DAY_MS): Doc {
  return {
    version: 1,
    places: purgeRecords(doc.places, now, maxAgeMs),
    tags: purgeRecords(doc.tags, now, maxAgeMs),
    lists: purgeRecords(doc.lists, now, maxAgeMs),
  };
}

/** Whether two docs hold the same data, whatever the order of their keys. */
export function sameDoc(a: Doc, b: Doc): boolean {
  return a === b || canonicalJson(a) === canonicalJson(b);
}

// --- Normalisation of untrusted input ------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v !== ""))];
}

/** A latitude clamped to [-90, 90], or undefined when it is not a finite number. */
export function normalizeLat(value: unknown): number | undefined {
  const n = finite(value);
  return n === undefined ? undefined : Math.min(90, Math.max(-90, n));
}

/** A longitude clamped to [-180, 180], or undefined when it is not a finite number. */
export function normalizeLng(value: unknown): number | undefined {
  const n = finite(value);
  return n === undefined ? undefined : Math.min(180, Math.max(-180, n));
}

/** The value as a known place state, "try" otherwise. */
export function normalizeState(value: unknown): PlaceState {
  return PLACE_STATES.includes(value as PlaceState) ? (value as PlaceState) : "try";
}

/** The value as a known tag colour, "ink" otherwise. */
export function normalizeColor(value: unknown): TagColor {
  return TAG_COLORS.includes(value as TagColor) ? (value as TagColor) : "ink";
}

/** The value when it is an http(s) URL, undefined otherwise (no `javascript:` links). */
export function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

interface Stamps {
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

function stamps(raw: Record<string, unknown>): Stamps {
  const updatedAt = finite(raw.updatedAt) ?? 0;
  const out: Stamps = { createdAt: finite(raw.createdAt) ?? updatedAt, updatedAt };
  const deletedAt = finite(raw.deletedAt);
  if (deletedAt !== undefined) out.deletedAt = deletedAt;
  return out;
}

function normalizePlace(raw: Record<string, unknown>, id: string): Place | null {
  const lat = normalizeLat(raw.lat);
  const lng = normalizeLng(raw.lng);
  if (lat === undefined || lng === undefined) return null;
  const place: Place = {
    id,
    name: str(raw.name),
    address: str(raw.address),
    lat,
    lng,
    note: str(raw.note),
    tagIds: strings(raw.tagIds),
    listIds: strings(raw.listIds),
    state: normalizeState(raw.state),
    ...stamps(raw),
  };
  const url = normalizeUrl(raw.url);
  if (url !== undefined) place.url = url;
  if (PLACE_SOURCES.includes(raw.source as PlaceSource)) place.source = raw.source as PlaceSource;
  return place;
}

function normalizeTag(raw: Record<string, unknown>, id: string): Tag {
  return {
    id,
    name: str(raw.name),
    color: normalizeColor(raw.color),
    icon: str(raw.icon),
    ...stamps(raw),
  };
}

function normalizeList(raw: Record<string, unknown>, id: string): List {
  return { id, name: str(raw.name), description: str(raw.description), ...stamps(raw) };
}

function normalizeCollection<T extends Entry>(
  raw: unknown,
  normalize: (record: Record<string, unknown>, id: string) => T | null,
): Record<string, T> {
  const out: Record<string, T> = {};
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((r) => ["", r])
    : isObject(raw)
      ? Object.entries(raw)
      : [];
  for (const [key, value] of entries) {
    if (!isObject(value)) continue;
    const id = typeof value.id === "string" && value.id !== "" ? value.id : key;
    if (id === "") continue;
    const record = normalize(value, id);
    if (record === null) continue;
    const existing = out[id];
    out[id] = existing === undefined ? record : pick(existing, record);
  }
  return out;
}

/**
 * Turns an untrusted parsed JSON value into a valid Doc: malformed records are dropped, missing
 * collections become empty, coordinates are clamped and unknown enums coerced. Returns null when
 * the value does not look like a doc at all (or claims a version other than 1).
 */
export function normalizeDoc(raw: unknown): Doc | null {
  if (!isObject(raw)) return null;
  if (raw.version !== undefined && raw.version !== 1) return null;
  const looksLikeDoc = raw.version === 1 || "places" in raw || "tags" in raw || "lists" in raw;
  if (!looksLikeDoc) return null;
  return {
    version: 1,
    places: normalizeCollection(raw.places, normalizePlace),
    tags: normalizeCollection(raw.tags, normalizeTag),
    lists: normalizeCollection(raw.lists, normalizeList),
  };
}
