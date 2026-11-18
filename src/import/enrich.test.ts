import { describe, expect, test } from "bun:test";
import type { Place } from "../store/model";
import { enrichPatch, findExisting, type Incoming } from "./enrich";

function place(over: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Chez Odette",
    address: "12 Rue des Lilas, 75019 Paris, France",
    lat: 48.877,
    lng: 2.39,
    note: "",
    tagIds: ["t1"],
    listIds: [],
    state: "visited",
    source: "mapstr",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function incoming(over: Partial<Incoming> = {}): Incoming {
  return { note: "", tagIds: ["t1"], state: "visited", source: "mapstr", ...over };
}

describe("findExisting", () => {
  const places = [place(), place({ id: "p2", name: "Holybelly", address: "", lat: 48.87 })];

  test("matches the same name and address, folded, without a position", () => {
    expect(
      findExisting(places, {
        name: "chez  odette",
        address: "12 rue des lilas, 75019 PARIS, France",
      })?.id,
    ).toBe("p1");
  });

  test("does not match the same name at another address without a position", () => {
    expect(findExisting(places, { name: "Chez Odette", address: "40 Avenue Verte" })).toBe(
      undefined,
    );
  });

  test("an empty address is no match by itself", () => {
    expect(findExisting(places, { name: "Holybelly", address: "" })).toBe(undefined);
  });

  test("matches the same name within 50 m", () => {
    expect(
      findExisting(places, { name: "Holybelly", address: "" }, { lat: 48.8701, lng: 2.39 })?.id,
    ).toBe("p2");
    expect(
      findExisting(places, { name: "Holybelly", address: "" }, { lat: 48.88, lng: 2.39 }),
    ).toBe(undefined);
  });
});

describe("enrichPatch", () => {
  test("is empty when the import brings nothing new", () => {
    expect(enrichPatch(place({ rating: 4 }), incoming({ rating: 3 }))).toEqual({});
  });

  test("fills the stars and the note when the place has none", () => {
    expect(enrichPatch(place(), incoming({ rating: 4.5, note: "Great ravioli" }))).toEqual({
      rating: 4.5,
      note: "Great ravioli",
    });
  });

  test("keeps the owner's note and stars", () => {
    expect(
      enrichPatch(place({ note: "Mine", rating: 2 }), incoming({ note: "Theirs", rating: 5 })),
    ).toEqual({});
  });

  test("adds the tags the place lacks, keeping its own first", () => {
    expect(enrichPatch(place(), incoming({ tagIds: ["t2", "t1"] }))).toEqual({
      tagIds: ["t1", "t2"],
    });
  });

  test("raises a Mapstr place's state, never lowers it", () => {
    expect(enrichPatch(place(), incoming({ state: "favorite" }))).toEqual({ state: "favorite" });
    expect(enrichPatch(place({ state: "favorite" }), incoming({ state: "try" }))).toEqual({});
    expect(enrichPatch(place({ state: "try" }), incoming({ state: "visited" }))).toEqual({
      state: "visited",
    });
  });

  test("leaves the state of a place that does not come from Mapstr", () => {
    expect(enrichPatch(place({ source: "search" }), incoming({ state: "favorite" }))).toEqual({});
    expect(enrichPatch(place(), incoming({ state: "favorite", source: "google" }))).toEqual({});
  });
});
