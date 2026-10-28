/**
 * The basemap: OpenFreeMap's Positron style (bundled, so the map does not wait
 * for a style request), recoloured layer by layer into a quiet cobalt-tinted
 * ground that the saturated labels sit on. Two palettes, light for daylight in
 * the street and dark for the evening; the tiles are the same.
 */
import type { StyleSpecification } from "maplibre-gl";
import positron from "./positron.json";

interface Ground {
  land: string;
  residential: string;
  park: string;
  water: string;
  waterLine: string;
  building: string;
  buildingLine: string;
  roadMajor: string;
  roadCasing: string;
  roadMinor: string;
  path: string;
  rail: string;
  boundary: string;
  label: string;
  labelStrong: string;
  waterLabel: string;
  halo: string;
}

const LIGHT: Ground = {
  land: "#e9edf6",
  residential: "#e4e9f4",
  park: "#d3e4d6",
  water: "#bccdee",
  waterLine: "#a9bfe8",
  building: "#dbe1ef",
  buildingLine: "#cfd7ea",
  roadMajor: "#ffffff",
  roadCasing: "#d3daeb",
  roadMinor: "#f7f9fd",
  path: "#e1e6f2",
  rail: "#cdd5e8",
  boundary: "#9aa6c8",
  label: "#5a6386",
  labelStrong: "#2a3150",
  waterLabel: "#3a57a8",
  halo: "#f2f5fb",
};

const DARK: Ground = {
  land: "#131a2e",
  residential: "#151d33",
  park: "#14291f",
  water: "#0c1d45",
  waterLine: "#16295a",
  building: "#1b2440",
  buildingLine: "#222c4b",
  roadMajor: "#2c3757",
  roadCasing: "#1e2742",
  roadMinor: "#222b47",
  path: "#1f2843",
  rail: "#27304d",
  boundary: "#4e5a80",
  label: "#8f9abd",
  labelStrong: "#d6dbec",
  waterLabel: "#7f9be0",
  halo: "#131a2e",
};

type Layer = StyleSpecification["layers"][number];

function paintFor(id: string, type: string, g: Ground): Record<string, unknown> | null {
  if (type === "background") return { "background-color": g.land };
  if (id === "park" || id === "landcover_wood") return { "fill-color": g.park, "fill-opacity": 1 };
  if (id === "water") return { "fill-color": g.water };
  if (id === "waterway") return { "line-color": g.waterLine };
  if (id === "landuse_residential") return { "fill-color": g.residential };
  if (id.startsWith("landcover_")) return { "fill-color": g.land };
  if (id === "building") return { "fill-color": g.building, "fill-outline-color": g.buildingLine };
  if (id === "aeroway-area") return { "fill-color": g.residential };
  if (id.startsWith("aeroway")) return { "line-color": g.path };
  if (id === "road_area_pier") return { "fill-color": g.land };
  if (id === "road_pier") return { "line-color": g.land };
  if (id === "highway_path") return { "line-color": g.path };
  if (id === "highway_minor") return { "line-color": g.roadMinor };
  if (id.endsWith("_casing")) return { "line-color": g.roadCasing };
  if (id.endsWith("_inner")) return { "line-color": g.roadMajor };
  if (id.endsWith("_subtle")) return { "line-color": g.roadCasing };
  if (id.endsWith("_dashline")) return { "line-color": g.land };
  if (id.startsWith("railway")) return { "line-color": g.rail };
  if (id.startsWith("boundary")) return { "line-color": g.boundary };
  if (id.startsWith("water_name") || id === "waterway_line_label")
    return { "text-color": g.waterLabel, "text-halo-color": g.halo };
  if (id.startsWith("label_city") || id.startsWith("label_country") || id === "label_state")
    return { "text-color": g.labelStrong, "text-halo-color": g.halo };
  if (type === "symbol") return { "text-color": g.label, "text-halo-color": g.halo };
  return null;
}

/** Road shields need a sprite this style does not draw from; they are left out. */
function keep(layer: Layer): boolean {
  return !layer.id.includes("shield");
}

/** The basemap in the given palette. */
export function mapStyle(dark: boolean): StyleSpecification {
  const g = dark ? DARK : LIGHT;
  const base = positron as unknown as StyleSpecification;
  const layers = base.layers.filter(keep).map((layer): Layer => {
    const paint = paintFor(layer.id, layer.type, g);
    if (!paint) return layer;
    return { ...layer, paint: { ...(("paint" in layer && layer.paint) || {}), ...paint } } as Layer;
  });
  return { ...base, layers };
}

/**
 * The paint changes that turn a loaded map from one palette into the other,
 * so the theme switches without reloading the style (and the places on it).
 */
export function recolorOps(dark: boolean): [layer: string, prop: string, value: unknown][] {
  const g = dark ? DARK : LIGHT;
  const ops: [string, string, unknown][] = [];
  for (const layer of (positron as unknown as StyleSpecification).layers) {
    const paint = paintFor(layer.id, layer.type, g);
    if (paint) for (const [k, v] of Object.entries(paint)) ops.push([layer.id, k, v]);
  }
  return ops;
}

/** The colour of the map's ground, for what is shown before tiles arrive. */
export function groundColor(dark: boolean): string {
  return (dark ? DARK : LIGHT).land;
}
