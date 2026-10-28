/**
 * The notebook: places, tags and lists, each keyed by id. Every record carries
 * `updatedAt` (ms since epoch) and, once deleted, `deletedAt`: a deletion is a
 * tombstone kept for a while so that a sync does not bring the record back.
 */

/** How a place stands for its owner. Drawn by the shape of its label, never by colour. */
export type PlaceState = "try" | "visited" | "favorite";

/** Where a place came from. */
export type PlaceSource = "search" | "map" | "link" | "google" | "ai" | "share" | "import";

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  tagIds: string[];
  listIds: string[];
  state: PlaceState;
  /** A link to the place: its website or the maps link it was pinned from. */
  url?: string;
  source?: PlaceSource;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

/** The label inks a tag can take. */
export const TAG_COLORS = [
  "vermilion",
  "cobalt",
  "mustard",
  "green",
  "plum",
  "teal",
  "rose",
  "ink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
  /** A key of TAG_ICONS (src/ui/icons.ts). */
  icon: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface List {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Doc {
  version: 1;
  places: Record<string, Place>;
  tags: Record<string, Tag>;
  lists: Record<string, List>;
}

/** Any record of the notebook. */
export type Entry = Place | Tag | List;

export function emptyDoc(): Doc {
  return { version: 1, places: {}, tags: {}, lists: {} };
}

export function newId(): string {
  return crypto.randomUUID();
}

/** The records that are not deleted, in insertion order. */
export function alive<T extends Entry>(records: Record<string, T>): T[] {
  return Object.values(records).filter((r) => r.deletedAt === undefined);
}
