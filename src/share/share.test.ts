import { describe, expect, test } from "bun:test";
import type { Doc } from "../store/model";
import { alive, emptyDoc } from "../store/model";
import type { SharePayload } from "./share";
import {
  buildSharePayload,
  decodeShare,
  encodeShare,
  foldName,
  importShare,
  MAX_SHARE_PLACES,
} from "./share";

const payload: SharePayload = {
  v: 1,
  list: { name: "Paris bistrots", description: "Les meilleurs, d'après moi 🍷" },
  tags: [
    { name: "Bistrot", color: "vermilion", icon: "fork" },
    { name: "Terrasse", color: "green", icon: "sun" },
  ],
  places: [
    {
      name: "Le Petit Cambodge",
      address: "20 Rue Alibert, 75010 Paris",
      lat: 48.8738,
      lng: 2.3705,
      note: "Bobun!",
      tags: [0, 1],
      url: "https://www.google.com/maps/place/Le+Petit+Cambodge",
      state: "favorite",
    },
    { name: "Septime", address: "", lat: 48.8533, lng: 2.3807, note: "", tags: [0] },
  ],
};

async function encodeRaw(value: unknown): Promise<string> {
  return encodeShare(value as SharePayload);
}

function sampleDoc(): Doc {
  const doc = emptyDoc();
  doc.lists.l1 = { id: "l1", name: "Paris", description: "Weekend", createdAt: 1, updatedAt: 1 };
  doc.lists.gone = {
    id: "gone",
    name: "Old",
    description: "",
    createdAt: 1,
    updatedAt: 2,
    deletedAt: 2,
  };
  doc.tags.t1 = {
    id: "t1",
    name: "Café",
    color: "mustard",
    icon: "cup",
    createdAt: 1,
    updatedAt: 1,
  };
  doc.tags.t2 = { id: "t2", name: "Unused", color: "ink", icon: "", createdAt: 1, updatedAt: 1 };
  doc.tags.t3 = {
    id: "t3",
    name: "Dead",
    color: "ink",
    icon: "",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: 1,
  };
  const base = { address: "", note: "", state: "try" as const, createdAt: 1, updatedAt: 1 };
  doc.places.p1 = {
    ...base,
    id: "p1",
    name: "Café de Flore",
    lat: 48.8541,
    lng: 2.3326,
    tagIds: ["t1", "t3"],
    listIds: ["l1"],
  };
  doc.places.p2 = {
    ...base,
    id: "p2",
    name: "Elsewhere",
    lat: 1,
    lng: 1,
    tagIds: ["t2"],
    listIds: [],
  };
  doc.places.p3 = {
    ...base,
    id: "p3",
    name: "Deleted",
    lat: 1,
    lng: 1,
    tagIds: [],
    listIds: ["l1"],
    deletedAt: 1,
  };
  return doc;
}

describe("encodeShare / decodeShare", () => {
  test("round trip", async () => {
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload);
  });

  test("the encoding is URL-safe", async () => {
    const big: SharePayload = {
      ...payload,
      places: Array.from({ length: 200 }, (_, i) => ({
        name: `Place ${i} ÿ?&#/+=`,
        address: "",
        lat: i / 10,
        lng: -i / 10,
        note: String(Math.random()),
        tags: [],
      })),
    };
    const encoded = await encodeShare(big);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
    expect((await decodeShare(encoded))?.places).toHaveLength(200);
  });

  test("garbage gives null", async () => {
    for (const data of ["", "!!!", "abc", "a", "%%%", "AAAAAAAAAAAA", "x".repeat(1001)]) {
      expect(await decodeShare(data)).toBeNull();
    }
    expect(await decodeShare(await encodeRaw("hello"))).toBeNull();
    expect(await decodeShare(await encodeRaw({ ...payload, v: 2 }))).toBeNull();
    expect(await decodeShare(await encodeRaw({ ...payload, tags: "x" }))).toBeNull();
  });

  test("rejects malformed places", async () => {
    const place = payload.places[0];
    const bad = [
      { ...place, lat: "48" },
      { ...place, lng: null },
      { ...place, tags: [5] },
      { ...place, tags: [0.5] },
      { ...place, name: 3 },
    ];
    for (const p of bad) {
      expect(await decodeShare(await encodeRaw({ ...payload, places: [p] }))).toBeNull();
    }
  });

  test("coerces what can be coerced", async () => {
    const decoded = await decodeShare(
      await encodeRaw({
        v: 1,
        list: { name: "L" },
        tags: [{ name: "T", color: "pink" }],
        places: [
          { name: "P", lat: 100, lng: -200, tags: [0], state: "meh", url: "javascript:alert(1)" },
        ],
      }),
    );
    expect(decoded).toEqual({
      v: 1,
      list: { name: "L", description: "" },
      tags: [{ name: "T", color: "ink", icon: "" }],
      places: [{ name: "P", address: "", lat: 90, lng: -180, note: "", tags: [0], state: "try" }],
    });
  });

  test("caps the number of places", async () => {
    const many = Array.from({ length: MAX_SHARE_PLACES + 5 }, () => payload.places[1]);
    const decoded = await decodeShare(await encodeRaw({ ...payload, places: many }));
    expect(decoded?.places).toHaveLength(MAX_SHARE_PLACES);
  });
});

describe("buildSharePayload", () => {
  test("keeps the list's alive places and the alive tags they use", () => {
    const built = buildSharePayload(sampleDoc(), "l1");
    expect(built).toEqual({
      v: 1,
      list: { name: "Paris", description: "Weekend" },
      tags: [{ name: "Café", color: "mustard", icon: "cup" }],
      places: [
        {
          name: "Café de Flore",
          address: "",
          lat: 48.8541,
          lng: 2.3326,
          note: "",
          tags: [0],
          state: "try",
        },
      ],
    });
  });

  test("null for a missing or deleted list", () => {
    expect(buildSharePayload(sampleDoc(), "nope")).toBeNull();
    expect(buildSharePayload(sampleDoc(), "gone")).toBeNull();
  });
});

describe("importShare", () => {
  test("adds a list, places and missing tags without touching the input", () => {
    const doc = sampleDoc();
    const before = JSON.stringify(doc);
    const { doc: out, listId, added } = importShare(doc, payload, 500);
    expect(JSON.stringify(doc)).toBe(before);
    expect(added).toBe(2);
    expect(out.lists[listId]).toMatchObject({ name: "Paris bistrots", createdAt: 500 });
    const mine = alive(out.places).filter((p) => p.listIds.includes(listId));
    expect(mine.map((p) => p.name)).toEqual(["Le Petit Cambodge", "Septime"]);
    expect(mine[0]).toMatchObject({ source: "share", state: "favorite", updatedAt: 500 });
    expect(mine[1]?.state).toBe("try");
    expect(alive(out.tags).map((t) => t.name)).toEqual(["Café", "Unused", "Bistrot", "Terrasse"]);
  });

  test("reuses tags by folded name", () => {
    const doc = sampleDoc();
    const shared: SharePayload = {
      ...payload,
      tags: [
        { name: "  CAFE ", color: "plum", icon: "x" },
        { name: "Dead", color: "ink", icon: "" },
      ],
      places: [{ name: "Ten Belles", address: "", lat: 48.87, lng: 2.36, note: "", tags: [0, 1] }],
    };
    const { doc: out } = importShare(doc, shared, 500);
    const place = alive(out.places).find((p) => p.name === "Ten Belles");
    expect(place?.tagIds[0]).toBe("t1");
    // "Dead" is a tombstone: a new tag is made instead of reviving it.
    expect(place?.tagIds[1]).not.toBe("t3");
    expect(out.tags[place?.tagIds[1] ?? ""]?.name).toBe("Dead");
  });

  test("does not duplicate a place already pinned nearby", () => {
    const doc = sampleDoc();
    const shared: SharePayload = {
      ...payload,
      tags: [{ name: "Unshared", color: "ink", icon: "" }],
      places: [
        // 10 m away, same name modulo accents and case.
        { name: "cafe de flore", address: "", lat: 48.85419, lng: 2.3326, note: "", tags: [0] },
        // Same name but 2 km away: a different place.
        { name: "Café de Flore", address: "", lat: 48.872, lng: 2.3326, note: "", tags: [] },
      ],
    };
    const { doc: out, listId, added } = importShare(doc, shared, 500);
    expect(added).toBe(1);
    expect(out.places.p1?.listIds).toEqual(["l1", listId]);
    expect(out.places.p1?.updatedAt).toBe(500);
    expect(doc.places.p1?.listIds).toEqual(["l1"]);
    // The tag was only needed by the skipped place, so it is not created.
    expect(alive(out.tags).some((t) => t.name === "Unshared")).toBe(false);
  });

  test("dedupes repeated places inside the payload", () => {
    const one = payload.places[1];
    if (!one) throw new Error("fixture");
    const { added } = importShare(emptyDoc(), { ...payload, places: [one, one] }, 1);
    expect(added).toBe(1);
  });
});

test("foldName", () => {
  expect(foldName("  Café   de FLORE ")).toBe("cafe de flore");
});
