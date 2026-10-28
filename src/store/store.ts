/**
 * The notebook in memory and in localStorage. `doc` is the one source of truth
 * for the interface; every change goes through the functions here, which stamp
 * `updatedAt`, so that a sync can merge two copies record by record. Another
 * tab writing the notebook is merged in through the `storage` event.
 */
import { computed, effect, signal } from "@preact/signals";
import { l, tr } from "../i18n";
import { merge, normalizeDoc } from "./merge";
import {
  alive,
  type Doc,
  emptyDoc,
  type List,
  newId,
  type Place,
  type Tag,
  type TagColor,
} from "./model";

const KEY = "spots:v1";

/**
 * The tags a new notebook starts with. Fixed ids and a zero timestamp, so two
 * devices that each start a notebook and then sync end up with one set, and any
 * edit wins over the default.
 */
const STARTER_TAGS: { id: string; name: ReturnType<typeof l>; color: TagColor; icon: string }[] = [
  { id: "starter-food", name: l("Food", "Resto"), color: "vermilion", icon: "utensils" },
  { id: "starter-coffee", name: l("Coffee", "Café"), color: "green", icon: "coffee" },
  { id: "starter-drinks", name: l("Drinks", "Bar"), color: "plum", icon: "wine" },
  { id: "starter-shops", name: l("Shops", "Boutique"), color: "mustard", icon: "shop" },
  { id: "starter-see", name: l("To see", "À voir"), color: "cobalt", icon: "landmark" },
];

export function starterDoc(): Doc {
  const doc = emptyDoc();
  for (const t of STARTER_TAGS) {
    doc.tags[t.id] = {
      id: t.id,
      name: tr(t.name),
      color: t.color,
      icon: t.icon,
      createdAt: 0,
      updatedAt: 0,
    };
  }
  return doc;
}

function read(): Doc | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeDoc(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Whether the notebook was found in storage at startup (false on a first visit). */
export const hadNotebook = typeof window !== "undefined" && read() !== null;

export const doc = signal<Doc>(
  typeof window === "undefined" ? emptyDoc() : (read() ?? starterDoc()),
);

/** Set when localStorage refused a write (full, or disabled). */
export const storageError = signal<string | null>(null);

let lastWritten = "";
if (typeof window !== "undefined") {
  effect(() => {
    const json = JSON.stringify(doc.value);
    if (json === lastWritten) return;
    lastWritten = json;
    try {
      localStorage.setItem(KEY, json);
      storageError.value = null;
    } catch (err) {
      storageError.value = err instanceof Error ? err.message : String(err);
    }
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const other = normalizeDoc(JSON.parse(e.newValue));
      if (other) doc.value = merge(doc.value, other);
    } catch {}
  });
}

export const places = computed(() =>
  alive(doc.value.places).sort((a, b) => b.createdAt - a.createdAt),
);
export const tags = computed(() =>
  alive(doc.value.tags).sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name)),
);
export const lists = computed(() =>
  alive(doc.value.lists).sort((a, b) => b.updatedAt - a.updatedAt),
);
export const tagById = computed(() => new Map(tags.value.map((t) => [t.id, t])));
export const listById = computed(() => new Map(lists.value.map((x) => [x.id, x])));

/** The first alive tag of a place, the one its label is printed in. */
export function mainTag(p: Place): Tag | undefined {
  const byId = tagById.value;
  for (const id of p.tagIds) {
    const t = byId.get(id);
    if (t) return t;
  }
  return undefined;
}

function commit(next: Doc): void {
  doc.value = next;
}

export type NewPlace = Omit<Place, "id" | "createdAt" | "updatedAt" | "deletedAt">;

export function addPlace(input: NewPlace): Place {
  const now = Date.now();
  const place: Place = { ...input, id: newId(), createdAt: now, updatedAt: now };
  commit({ ...doc.value, places: { ...doc.value.places, [place.id]: place } });
  return place;
}

/** Changes some fields of a place; a field given as undefined is removed. */
export function updatePlace(
  id: string,
  patch: { [K in keyof Omit<Place, "id" | "createdAt">]?: Place[K] | undefined },
): void {
  const cur = doc.value.places[id];
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: Date.now() } as Record<string, unknown>;
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  commit({ ...doc.value, places: { ...doc.value.places, [id]: next as unknown as Place } });
}

export function deletePlace(id: string): Place | undefined {
  const cur = doc.value.places[id];
  if (!cur) return undefined;
  const now = Date.now();
  commit({
    ...doc.value,
    places: { ...doc.value.places, [id]: { ...cur, deletedAt: now, updatedAt: now } },
  });
  return cur;
}

/** Brings back a place deleted a moment ago (the undo of a deletion). */
export function restorePlace(place: Place): void {
  const { deletedAt: _gone, ...rest } = place;
  commit({
    ...doc.value,
    places: { ...doc.value.places, [place.id]: { ...rest, updatedAt: Date.now() } },
  });
}

export function addTag(input: { name: string; color: TagColor; icon: string }): Tag {
  const now = Date.now();
  const tag: Tag = { ...input, id: newId(), createdAt: now, updatedAt: now };
  commit({ ...doc.value, tags: { ...doc.value.tags, [tag.id]: tag } });
  return tag;
}

export function updateTag(id: string, patch: Partial<Pick<Tag, "name" | "color" | "icon">>): void {
  const cur = doc.value.tags[id];
  if (!cur) return;
  commit({
    ...doc.value,
    tags: { ...doc.value.tags, [id]: { ...cur, ...patch, updatedAt: Date.now() } },
  });
}

/** Deletes a tag. Places keep its id, which no longer resolves: no place is rewritten. */
export function deleteTag(id: string): void {
  const cur = doc.value.tags[id];
  if (!cur) return;
  const now = Date.now();
  commit({
    ...doc.value,
    tags: { ...doc.value.tags, [id]: { ...cur, deletedAt: now, updatedAt: now } },
  });
}

export function addList(input: { name: string; description?: string }): List {
  const now = Date.now();
  const list: List = {
    id: newId(),
    name: input.name,
    description: input.description ?? "",
    createdAt: now,
    updatedAt: now,
  };
  commit({ ...doc.value, lists: { ...doc.value.lists, [list.id]: list } });
  return list;
}

export function updateList(id: string, patch: Partial<Pick<List, "name" | "description">>): void {
  const cur = doc.value.lists[id];
  if (!cur) return;
  commit({
    ...doc.value,
    lists: { ...doc.value.lists, [id]: { ...cur, ...patch, updatedAt: Date.now() } },
  });
}

export function deleteList(id: string): void {
  const cur = doc.value.lists[id];
  if (!cur) return;
  const now = Date.now();
  commit({
    ...doc.value,
    lists: { ...doc.value.lists, [id]: { ...cur, deletedAt: now, updatedAt: now } },
  });
}

/** Adds or removes a place from a list. */
export function toggleInList(placeId: string, listId: string): void {
  const p = doc.value.places[placeId];
  if (!p) return;
  const listIds = p.listIds.includes(listId)
    ? p.listIds.filter((x) => x !== listId)
    : [...p.listIds, listId];
  updatePlace(placeId, { listIds });
}

/** Replaces the notebook (an import, a sync), merged with what is here unless told otherwise. */
export function mergeIn(other: Doc): void {
  commit(merge(doc.value, other));
}

export function replaceDoc(next: Doc): void {
  commit(next);
}
