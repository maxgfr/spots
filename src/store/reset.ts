/**
 * Erasing the whole notebook. Records are not dropped but marked deleted, like any
 * deletion: a sync, or another open tab, would otherwise bring them straight back.
 * The erase reaches GitHub and the other devices at their next sync.
 */
import type { Doc, Entry } from "./model";

function tombstones<T extends Entry>(records: Record<string, T>, now: number): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, r] of Object.entries(records)) {
    out[id] = r.deletedAt === undefined ? { ...r, deletedAt: now, updatedAt: now } : r;
  }
  return out;
}

/** The notebook with every place, tag and list deleted, and the starter tags back as new. */
export function eraseAll(d: Doc, now: number, starter: Doc): Doc {
  const tags = tombstones(d.tags, now);
  for (const t of Object.values(starter.tags)) tags[t.id] = { ...t, updatedAt: now };
  return {
    version: 1,
    places: tombstones(d.places, now),
    tags,
    lists: tombstones(d.lists, now),
  };
}

function revive<T extends Entry>(
  current: Record<string, T>,
  before: Record<string, T>,
  now: number,
): Record<string, T> {
  const out = { ...current };
  for (const [id, r] of Object.entries(before)) {
    if (r.deletedAt !== undefined) continue;
    const { deletedAt: _gone, ...rest } = r;
    out[id] = { ...rest, updatedAt: now } as T;
  }
  return out;
}

/** The undo of an erase: what was alive before comes back, newer than its deletion. */
export function undoErase(current: Doc, before: Doc, now: number): Doc {
  return {
    version: 1,
    places: revive(current.places, before.places, now),
    tags: revive(current.tags, before.tags, now),
    lists: revive(current.lists, before.lists, now),
  };
}
