/**
 * An imported place that is already in the notebook: finding it, and filling what it lacks
 * (stars, tags, a note, a state that went further) without undoing the owner's edits. This is
 * what lets the second half of a Mapstr export, imported later, enrich the places of the first.
 */
import { distanceMeters, foldName } from "../share/share";
import type { Place, PlaceSource, PlaceState } from "../store/model";

/**
 * The alive place an imported one already is: the same name and address (folded), or the same
 * name within 50 m when the imported position is known.
 */
export function findExisting(
  places: Place[],
  imported: { name: string; address: string },
  at?: { lat: number; lng: number },
): Place | undefined {
  const name = foldName(imported.name);
  const address = foldName(imported.address);
  return places.find(
    (p) =>
      foldName(p.name) === name &&
      ((address !== "" && foldName(p.address) === address) ||
        (at !== undefined && distanceMeters(p.lat, p.lng, at.lat, at.lng) < 50)),
  );
}

/** What an import knows of a place, its tags already resolved to ids. */
export interface Incoming {
  note: string;
  tagIds: string[];
  rating?: number;
  state: PlaceState;
  source: PlaceSource;
}

export type EnrichPatch = Partial<Pick<Place, "rating" | "note" | "tagIds" | "state">>;

const RANK: Record<PlaceState, number> = { try: 0, visited: 1, favorite: 2 };

/**
 * The changes an imported place brings to one already there, gaps only: stars and a note when
 * it has none, the tags it lacks, and a state raised (never lowered) when both come from Mapstr.
 * Empty when there is nothing to add.
 */
export function enrichPatch(existing: Place, incoming: Incoming): EnrichPatch {
  const patch: EnrichPatch = {};
  if (existing.rating === undefined && incoming.rating !== undefined) {
    patch.rating = incoming.rating;
  }
  if (existing.note.trim() === "" && incoming.note.trim() !== "") patch.note = incoming.note;
  const tagIds = [...new Set([...existing.tagIds, ...incoming.tagIds])];
  if (tagIds.length > existing.tagIds.length) patch.tagIds = tagIds;
  if (
    incoming.source === "mapstr" &&
    existing.source === "mapstr" &&
    RANK[incoming.state] > RANK[existing.state]
  ) {
    patch.state = incoming.state;
  }
  return patch;
}
