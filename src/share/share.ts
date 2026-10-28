/**
 * Sharing one list as a URL fragment, with no server: the list, its places and the tags they
 * use are written as JSON, deflated and base64url-encoded. Decoding treats the data as hostile:
 * it never throws, checks every field and returns null when the payload is not valid. Importing
 * a share adds a new list to the notebook, reusing tags by name and places already pinned.
 */

import {
  normalizeColor,
  normalizeLat,
  normalizeLng,
  normalizeState,
  normalizeUrl,
} from "../store/merge";
import type { Doc, List, Place, PlaceState, Tag, TagColor } from "../store/model";
import { alive, newId } from "../store/model";

export interface ShareTag {
  name: string;
  color: TagColor;
  icon: string;
}

export interface SharePlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  /** Indexes into `SharePayload.tags`. */
  tags: number[];
  url?: string;
  state?: PlaceState;
}

export interface SharePayload {
  v: 1;
  list: { name: string; description: string };
  tags: ShareTag[];
  places: SharePlace[];
}

/** The most places a share carries; the rest of a decoded payload is dropped. */
export const MAX_SHARE_PLACES = 2000;

/** Decompressed payloads larger than this are refused (a deflate bomb guard). */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** Places closer than this, with the same name, are taken to be the same place. */
const SAME_PLACE_METERS = 30;

// --- Encoding ------------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BufferSource])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates, giving up (null) on corrupt data or past `MAX_JSON_BYTES`. */
async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as BufferSource])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/** Encodes a payload as a URL-safe string (deflated JSON, base64url without padding). */
export async function encodeShare(payload: SharePayload): Promise<string> {
  return toBase64Url(await deflate(new TextEncoder().encode(JSON.stringify(payload))));
}

// --- Validation ----------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optString(value: unknown): string | null {
  if (value === undefined) return "";
  return typeof value === "string" ? value : null;
}

function validTag(raw: unknown): ShareTag | null {
  if (!isObject(raw) || typeof raw.name !== "string") return null;
  const icon = optString(raw.icon);
  if (icon === null) return null;
  return { name: raw.name, color: normalizeColor(raw.color), icon };
}

function validPlace(raw: unknown, tagCount: number): SharePlace | null {
  if (!isObject(raw) || typeof raw.name !== "string") return null;
  const address = optString(raw.address);
  const note = optString(raw.note);
  const lat = normalizeLat(raw.lat);
  const lng = normalizeLng(raw.lng);
  if (address === null || note === null || lat === undefined || lng === undefined) return null;
  const rawTags = raw.tags ?? [];
  if (!Array.isArray(rawTags)) return null;
  const tags: number[] = [];
  for (const t of rawTags) {
    if (!Number.isInteger(t) || (t as number) < 0 || (t as number) >= tagCount) return null;
    if (!tags.includes(t as number)) tags.push(t as number);
  }
  const place: SharePlace = { name: raw.name, address, lat, lng, note, tags };
  const url = normalizeUrl(raw.url);
  if (url !== undefined) place.url = url;
  if (raw.state !== undefined) place.state = normalizeState(raw.state);
  return place;
}

/** Checks an untrusted value against the payload shape; null when it does not fit. */
export function validateShare(raw: unknown): SharePayload | null {
  if (!isObject(raw) || raw.v !== 1) return null;
  const list = raw.list;
  if (!isObject(list) || typeof list.name !== "string") return null;
  const description = optString(list.description);
  if (description === null) return null;
  if (!Array.isArray(raw.tags) || !Array.isArray(raw.places)) return null;
  const tags: ShareTag[] = [];
  for (const t of raw.tags) {
    const tag = validTag(t);
    if (!tag) return null;
    tags.push(tag);
  }
  const places: SharePlace[] = [];
  for (const p of raw.places.slice(0, MAX_SHARE_PLACES)) {
    const place = validPlace(p, tags.length);
    if (!place) return null;
    places.push(place);
  }
  return { v: 1, list: { name: list.name, description }, tags, places };
}

/** Decodes a string made by `encodeShare`. Never throws: null on anything invalid. */
export async function decodeShare(data: string): Promise<SharePayload | null> {
  const bytes = fromBase64Url(data.trim());
  if (!bytes || bytes.length === 0) return null;
  const json = await inflate(bytes);
  if (!json) return null;
  try {
    return validateShare(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json)));
  } catch {
    return null;
  }
}

// --- Building and importing ----------------------------------------------------------------

/** The payload for one list: its alive places and only the tags they use. Null if no such list. */
export function buildSharePayload(doc: Doc, listId: string): SharePayload | null {
  const list = doc.lists[listId];
  if (!list || list.deletedAt !== undefined) return null;
  const tags: ShareTag[] = [];
  const tagIndex = new Map<string, number>();
  const places: SharePlace[] = [];
  for (const p of alive(doc.places)) {
    if (!p.listIds.includes(listId)) continue;
    const indexes: number[] = [];
    for (const tagId of p.tagIds) {
      let index = tagIndex.get(tagId);
      if (index === undefined) {
        const tag = doc.tags[tagId];
        if (!tag || tag.deletedAt !== undefined) continue;
        index = tags.length;
        tags.push({ name: tag.name, color: tag.color, icon: tag.icon });
        tagIndex.set(tagId, index);
      }
      if (!indexes.includes(index)) indexes.push(index);
    }
    const place: SharePlace = {
      name: p.name,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      note: p.note,
      tags: indexes,
      state: p.state,
    };
    if (p.url !== undefined) place.url = p.url;
    places.push(place);
  }
  return { v: 1, list: { name: list.name, description: list.description }, tags, places };
}

/** A name folded for comparison: trimmed, lower case, without accents, spaces collapsed. */
export function foldName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Adds a shared list to a copy of the doc. Tags are matched by folded name and created only
 * when a new place needs them; a place already pinned within 30 m under the same name is not
 * duplicated but joins the new list. `added` counts the places created.
 */
export function importShare(
  doc: Doc,
  payload: SharePayload,
  now: number,
): { doc: Doc; listId: string; added: number } {
  const out: Doc = {
    version: 1,
    places: { ...doc.places },
    tags: { ...doc.tags },
    lists: { ...doc.lists },
  };

  const list: List = {
    id: newId(),
    name: payload.list.name,
    description: payload.list.description,
    createdAt: now,
    updatedAt: now,
  };
  out.lists[list.id] = list;

  const tagsByName = new Map<string, string>();
  for (const tag of alive(doc.tags)) {
    const key = foldName(tag.name);
    if (!tagsByName.has(key)) tagsByName.set(key, tag.id);
  }
  const tagIdOf = (index: number): string | undefined => {
    const shared = payload.tags[index];
    if (!shared) return undefined;
    const key = foldName(shared.name);
    const existing = tagsByName.get(key);
    if (existing !== undefined) return existing;
    const tag: Tag = {
      id: newId(),
      name: shared.name.trim(),
      color: shared.color,
      icon: shared.icon,
      createdAt: now,
      updatedAt: now,
    };
    out.tags[tag.id] = tag;
    tagsByName.set(key, tag.id);
    return tag.id;
  };

  const placesByName = new Map<string, string[]>();
  const index = (p: Place) => {
    const key = foldName(p.name);
    const ids = placesByName.get(key);
    if (ids) ids.push(p.id);
    else placesByName.set(key, [p.id]);
  };
  for (const p of alive(doc.places)) index(p);

  let added = 0;
  for (const shared of payload.places) {
    const twin = (placesByName.get(foldName(shared.name)) ?? [])
      .map((id) => out.places[id])
      .find(
        (p): p is Place =>
          p !== undefined &&
          distanceMeters(p.lat, p.lng, shared.lat, shared.lng) < SAME_PLACE_METERS,
      );
    if (twin) {
      if (!twin.listIds.includes(list.id)) {
        out.places[twin.id] = { ...twin, listIds: [...twin.listIds, list.id], updatedAt: now };
      }
      continue;
    }
    const tagIds: string[] = [];
    for (const index of shared.tags) {
      const id = tagIdOf(index);
      if (id !== undefined && !tagIds.includes(id)) tagIds.push(id);
    }
    const place: Place = {
      id: newId(),
      name: shared.name,
      address: shared.address,
      lat: shared.lat,
      lng: shared.lng,
      note: shared.note,
      tagIds,
      listIds: [list.id],
      state: shared.state ?? "try",
      source: "share",
      createdAt: now,
      updatedAt: now,
    };
    if (shared.url !== undefined) place.url = shared.url;
    out.places[place.id] = place;
    index(place);
    added++;
  }

  return { doc: out, listId: list.id, added };
}
