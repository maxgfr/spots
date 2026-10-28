import { describe, expect, test } from "bun:test";
import { tilesFor } from "./keep";

const paris = { west: 2.33, south: 48.85, east: 2.39, north: 48.88 };

describe("tilesFor", () => {
  test("covers the area from one level above the zoom down to the source's last level", () => {
    const tiles = tilesFor({ ...paris, zoom: 13.4, maxZoom: 14 });
    expect(tiles).not.toBeNull();
    const zooms = new Set(tiles?.map((t) => t.z));
    expect([...zooms].sort()).toEqual([12, 13, 14]);
  });

  test("a map zoomed in past the last level still keeps that level", () => {
    const tiles = tilesFor({ ...paris, zoom: 17, maxZoom: 14 });
    expect(tiles?.length).toBeGreaterThan(0);
    expect(tiles?.every((t) => t.z === 14)).toBe(true);
  });

  test("refuses an area past the cap", () => {
    expect(
      tilesFor({ west: -10, south: 40, east: 10, north: 55, zoom: 6, maxZoom: 14 }),
    ).toBeNull();
  });
});
