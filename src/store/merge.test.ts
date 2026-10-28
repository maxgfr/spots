import { describe, expect, test } from "bun:test";
import { merge, normalizeDoc, purgeTombstones, sameDoc } from "./merge";
import type { Doc, Place, Tag } from "./model";
import { emptyDoc } from "./model";

function place(id: string, updatedAt: number, extra: Partial<Place> = {}): Place {
  return {
    id,
    name: `Place ${id}`,
    address: "",
    lat: 48.87,
    lng: 2.37,
    note: "",
    tagIds: [],
    listIds: [],
    state: "try",
    createdAt: 1,
    updatedAt,
    ...extra,
  };
}

function docOf(...places: Place[]): Doc {
  const doc = emptyDoc();
  for (const p of places) doc.places[p.id] = p;
  return doc;
}

describe("merge", () => {
  test("unions records by id", () => {
    const merged = merge(docOf(place("a", 1)), docOf(place("b", 1)));
    expect(Object.keys(merged.places).sort()).toEqual(["a", "b"]);
  });

  test("keeps the most recent version on conflict", () => {
    const a = docOf(place("x", 10, { name: "old" }));
    const b = docOf(place("x", 20, { name: "new" }));
    expect(merge(a, b).places.x?.name).toBe("new");
    expect(merge(b, a).places.x?.name).toBe("new");
  });

  test("breaks ties deterministically", () => {
    const a = docOf(place("x", 10, { name: "alpha" }));
    const b = docOf(place("x", 10, { name: "beta" }));
    expect(merge(a, b).places.x?.name).toBe(merge(b, a).places.x?.name ?? "");
  });

  test("a newer tombstone wins", () => {
    const live = docOf(place("x", 10));
    const dead = docOf(place("x", 20, { deletedAt: 20 }));
    expect(merge(live, dead).places.x?.deletedAt).toBe(20);
    expect(merge(dead, live).places.x?.deletedAt).toBe(20);
  });

  test("an older tombstone loses to a later edit", () => {
    const dead = docOf(place("x", 10, { deletedAt: 10 }));
    const edited = docOf(place("x", 20, { name: "revived" }));
    expect(merge(dead, edited).places.x?.deletedAt).toBeUndefined();
    expect(merge(edited, dead).places.x?.name).toBe("revived");
  });

  test("does not mutate its inputs", () => {
    const a = docOf(place("x", 10));
    const b = docOf(place("x", 20), place("y", 1));
    const before = JSON.stringify([a, b]);
    merge(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

/** A small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDoc(next: () => number): Doc {
  const doc = emptyDoc();
  const ids = ["a", "b", "c", "d", "e"];
  const int = (n: number) => Math.floor(next() * n);
  for (const id of ids) {
    if (next() < 0.4) continue;
    const updatedAt = int(4);
    const p = place(id, updatedAt, { name: ["x", "y", "z"][int(3)] ?? "x" });
    if (next() < 0.3) p.deletedAt = updatedAt;
    doc.places[id] = p;
  }
  for (const id of ids.slice(0, 3)) {
    if (next() < 0.5) continue;
    const tag: Tag = {
      id,
      name: ["food", "bar"][int(2)] ?? "food",
      color: "ink",
      icon: "",
      createdAt: 0,
      updatedAt: int(3),
    };
    doc.tags[id] = tag;
  }
  return doc;
}

describe("merge laws (seeded fuzz)", () => {
  const next = rng(42);
  const cases = Array.from({ length: 300 }, () => [
    randomDoc(next),
    randomDoc(next),
    randomDoc(next),
  ]);

  test("commutative", () => {
    for (const [a, b] of cases) {
      if (!a || !b) continue;
      expect(sameDoc(merge(a, b), merge(b, a))).toBe(true);
    }
  });

  test("associative", () => {
    for (const [a, b, c] of cases) {
      if (!a || !b || !c) continue;
      expect(sameDoc(merge(merge(a, b), c), merge(a, merge(b, c)))).toBe(true);
    }
  });

  test("idempotent", () => {
    for (const [a, b] of cases) {
      if (!a || !b) continue;
      expect(sameDoc(merge(a, a), a)).toBe(true);
      const ab = merge(a, b);
      expect(sameDoc(merge(ab, b), ab)).toBe(true);
    }
  });
});

describe("purgeTombstones", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1000 * day;

  test("drops old tombstones only", () => {
    const doc = docOf(
      place("old", now - 100 * day, { deletedAt: now - 100 * day }),
      place("recent", now - 10 * day, { deletedAt: now - 10 * day }),
      place("alive", now - 500 * day),
    );
    expect(Object.keys(purgeTombstones(doc, now).places).sort()).toEqual(["alive", "recent"]);
    expect(Object.keys(purgeTombstones(doc, now, 5 * day).places)).toEqual(["alive"]);
    expect(Object.keys(doc.places)).toHaveLength(3);
  });
});

describe("sameDoc", () => {
  test("ignores key order", () => {
    const a = docOf(place("a", 1), place("b", 2));
    const b = docOf(place("b", 2), place("a", 1));
    expect(sameDoc(a, b)).toBe(true);
    expect(sameDoc(a, docOf(place("a", 1)))).toBe(false);
  });
});

describe("normalizeDoc", () => {
  test("rejects what is not a doc", () => {
    expect(normalizeDoc(null)).toBeNull();
    expect(normalizeDoc("doc")).toBeNull();
    expect(normalizeDoc([])).toBeNull();
    expect(normalizeDoc({ hello: 1 })).toBeNull();
    expect(normalizeDoc({ version: 2, places: {} })).toBeNull();
  });

  test("fills missing collections", () => {
    expect(normalizeDoc({ version: 1 })).toEqual(emptyDoc());
    expect(normalizeDoc({ places: {} })).toEqual(emptyDoc());
  });

  test("keeps a valid doc as is", () => {
    const doc = docOf(place("a", 1, { url: "https://example.com", source: "map" }));
    doc.tags.t = {
      id: "t",
      name: "Food",
      color: "cobalt",
      icon: "fork",
      createdAt: 1,
      updatedAt: 2,
    };
    doc.lists.l = { id: "l", name: "Paris", description: "", createdAt: 1, updatedAt: 1 };
    expect(normalizeDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  test("drops malformed records and coerces fields", () => {
    const doc = normalizeDoc({
      version: 1,
      places: {
        ok: {
          id: "ok",
          name: "Bar",
          lat: 123,
          lng: -500,
          state: "loved",
          tagIds: ["t", 3, "t"],
          url: "javascript:alert(1)",
          source: "nowhere",
          updatedAt: 5,
        },
        nan: { id: "nan", name: "x", lat: Number.NaN, lng: 2 },
        str: { id: "str", name: "x", lat: "48", lng: 2 },
        junk: 42,
      },
      tags: { t: { id: "t", name: "Food", color: "pink" } },
      lists: "nope",
    });
    expect(doc).not.toBeNull();
    expect(Object.keys(doc?.places ?? {})).toEqual(["ok"]);
    const p = doc?.places.ok;
    expect(p?.lat).toBe(90);
    expect(p?.lng).toBe(-180);
    expect(p?.state).toBe("try");
    expect(p?.tagIds).toEqual(["t"]);
    expect(p?.listIds).toEqual([]);
    expect(p?.address).toBe("");
    expect(p?.createdAt).toBe(5);
    expect(p && "url" in p).toBe(false);
    expect(p && "source" in p).toBe(false);
    expect(doc?.tags.t?.color).toBe("ink");
    expect(doc?.tags.t?.icon).toBe("");
    expect(doc?.lists).toEqual({});
  });

  test("uses the key when the id is missing", () => {
    const doc = normalizeDoc({ lists: { l1: { name: "Paris" } } });
    expect(doc?.lists.l1?.id).toBe("l1");
  });
});
