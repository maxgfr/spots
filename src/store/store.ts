/**
 * The notebook in memory and in IndexedDB. `doc` is the one source of truth
 * for the interface; every change goes through the functions here, which stamp
 * `updatedAt`, so that a sync can merge two copies record by record. Another
 * tab writing the notebook is merged in through a BroadcastChannel.
 *
 * Every page of maxgfr.github.io shares this origin's storage, and its one
 * localStorage (a few MB for all of them) fills up: the notebook, which grows,
 * lives in IndexedDB. It used to live in localStorage under `spots:v1`; that
 * copy is merged in and removed once IndexedDB holds it, and is the fallback
 * when IndexedDB refuses a write.
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

/** Where the notebook lived before IndexedDB: now merged in, then removed, and a fallback. */
const KEY = "spots:v1";
const DB_NAME = "spots";
const STORE = "notebook";
const ID = "doc";

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

const legacy = typeof window === "undefined" ? null : read();

export const doc = signal<Doc>(
  typeof window === "undefined" ? emptyDoc() : (legacy ?? starterDoc()),
);

/** Set when the browser refused to keep the notebook (storage full, or disabled). */
export const storageError = signal<string | null>(null);

let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // An open that never settles (another tab holding the database) must not hold the notebook.
    setTimeout(() => reject(new Error("The local database is busy.")), 3000);
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const channel =
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("spots-notebook");
let inLocalStorage = legacy !== null;
let lastWritten = "";
let loaded = false;
/** The latest notebook not yet stored: a page closing loses a write still in flight. */
let pending: string | null = null;

async function persist(d: Doc): Promise<void> {
  const json = JSON.stringify(d);
  if (json === lastWritten) return;
  lastWritten = json;
  pending = json;
  try {
    await idb("readwrite", (s) => s.put(json, ID));
    if (pending === json) pending = null;
    storageError.value = null;
    if (inLocalStorage) {
      inLocalStorage = false;
      try {
        localStorage.removeItem(KEY);
      } catch {}
    }
  } catch (err) {
    try {
      localStorage.setItem(KEY, json);
      if (pending === json) pending = null;
      inLocalStorage = true;
      storageError.value = null;
    } catch {
      storageError.value = err instanceof Error ? err.message : String(err);
    }
  }
  channel?.postMessage(json);
}

/** Resolves once the stored notebook is in `doc` (merged with any edit made meanwhile). */
export const notebookLoaded: Promise<void> =
  typeof window === "undefined"
    ? Promise.resolve()
    : (async () => {
        try {
          const raw = await idb("readonly", (s) => s.get(ID));
          const stored = typeof raw === "string" ? normalizeDoc(JSON.parse(raw)) : null;
          if (stored) doc.value = merge(doc.value, stored);
        } catch {}
        loaded = true;
        await persist(doc.value);
      })();

if (typeof window !== "undefined") {
  effect(() => {
    const d = doc.value;
    if (loaded) void persist(d);
  });
  // Leaving with a write in flight: keep it where a synchronous write can, merged in next time.
  window.addEventListener("pagehide", () => {
    if (!pending) return;
    try {
      localStorage.setItem(KEY, pending);
      inLocalStorage = true;
    } catch {}
  });
  channel?.addEventListener("message", (e: MessageEvent<string>) => {
    try {
      const other = normalizeDoc(JSON.parse(e.data));
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
