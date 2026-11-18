import { describe, expect, test } from "bun:test";
import { merge } from "./merge";
import { alive, type Doc, emptyDoc } from "./model";
import { eraseAll, undoErase } from "./reset";

function sample(): Doc {
  const d = emptyDoc();
  d.places.p1 = {
    id: "p1",
    name: "Somewhere",
    address: "",
    lat: 48.8,
    lng: 2.3,
    note: "",
    tagIds: ["t1"],
    listIds: ["l1"],
    state: "try",
    createdAt: 1,
    updatedAt: 1,
  };
  d.places.gone = { ...d.places.p1, id: "gone", deletedAt: 2, updatedAt: 2 };
  d.tags.t1 = { id: "t1", name: "Mine", color: "teal", icon: "pin", createdAt: 1, updatedAt: 1 };
  d.lists.l1 = { id: "l1", name: "Trip", description: "", createdAt: 1, updatedAt: 1 };
  return d;
}

function starter(): Doc {
  const d = emptyDoc();
  d.tags.s1 = {
    id: "s1",
    name: "Food",
    color: "vermilion",
    icon: "utensils",
    createdAt: 0,
    updatedAt: 0,
  };
  return d;
}

describe("eraseAll", () => {
  test("deletes every record and brings the starter tags back", () => {
    const out = eraseAll(sample(), 100, starter());
    expect(alive(out.places)).toEqual([]);
    expect(alive(out.lists)).toEqual([]);
    expect(alive(out.tags).map((t) => t.id)).toEqual(["s1"]);
    expect(out.places.p1?.deletedAt).toBe(100);
    // An older tombstone keeps its own date.
    expect(out.places.gone?.deletedAt).toBe(2);
  });

  test("wins over the copy a sync or another tab still holds", () => {
    const before = sample();
    const merged = merge(eraseAll(before, 100, starter()), before);
    expect(alive(merged.places)).toEqual([]);
    expect(alive(merged.tags).map((t) => t.id)).toEqual(["s1"]);
  });
});

describe("undoErase", () => {
  test("brings back what was alive, and keeps what was added since", () => {
    const before = sample();
    const erased = eraseAll(before, 100, starter());
    erased.places.p2 = { ...(before.places.p1 as NonNullable<Doc["places"][string]>), id: "p2" };
    const out = undoErase(erased, before, 200);
    expect(
      alive(out.places)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p1", "p2"]);
    expect(out.places.p1?.updatedAt).toBe(200);
    expect(out.places.gone?.deletedAt).toBe(2);
    expect(alive(out.lists).map((x) => x.id)).toEqual(["l1"]);
    expect(
      alive(out.tags)
        .map((t) => t.id)
        .sort(),
    ).toEqual(["s1", "t1"]);
  });
});
