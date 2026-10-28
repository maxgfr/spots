import { describe, expect, test } from "bun:test";
import type { Doc } from "../store/model";
import { emptyDoc } from "../store/model";
import { exportBackup, parseBackup } from "./backup";

function sample(): Doc {
  const doc = emptyDoc();
  doc.lists.l = { id: "l", name: "Paris", description: "", createdAt: 1, updatedAt: 1 };
  doc.places.p = {
    id: "p",
    name: "Septime",
    address: "80 Rue de Charonne",
    lat: 48.8533,
    lng: 2.3807,
    note: "",
    tagIds: [],
    listIds: ["l"],
    state: "favorite",
    createdAt: 1,
    updatedAt: 2,
  };
  return doc;
}

describe("backup", () => {
  test("export shape", () => {
    const text = exportBackup(sample(), Date.UTC(2026, 9, 28, 12));
    const parsed = JSON.parse(text);
    expect(parsed.app).toBe("spots");
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe("2026-10-28T12:00:00.000Z");
    expect(text).toContain('\n  "doc": {');
  });

  test("round trip", () => {
    expect(parseBackup(exportBackup(sample(), 0))).toEqual(sample());
  });

  test("accepts a bare doc", () => {
    expect(parseBackup(JSON.stringify(sample()))).toEqual(sample());
  });

  test("normalizes the content", () => {
    const text = JSON.stringify({
      app: "spots",
      version: 1,
      doc: { version: 1, places: { bad: { id: "bad", lat: "x", lng: 0 } } },
    });
    expect(parseBackup(text)).toEqual(emptyDoc());
  });

  test("rejects anything else", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup("[]")).toBeNull();
    expect(parseBackup('{"app":"other","version":1,"doc":{"version":1}}')).toBeNull();
    expect(parseBackup('{"app":"spots","version":2,"doc":{"version":1}}')).toBeNull();
    expect(parseBackup('{"app":"spots","version":1}')).toBeNull();
  });
});
