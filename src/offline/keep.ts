/**
 * "Keep this area offline": the tiles of the visible area, from just above its
 * zoom down to the source's last level (14 for OpenFreeMap; closer zooms reuse
 * those tiles), handed to the service worker, which stores them in a cache it
 * never trims. Capped, because each zoom level is four times the last.
 */
import type { Map as MLMap } from "maplibre-gl";

export const MAX_TILES = 2500;
/** OpenFreeMap's last tile level, when the source does not say. */
const SOURCE_MAX_ZOOM = 14;

function lng2x(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export interface Area {
  west: number;
  south: number;
  east: number;
  north: number;
  /** The map's zoom when the area was taken. */
  zoom: number;
  /** The source's last tile level. */
  maxZoom: number;
}

/**
 * The tile coordinates covering an area, from one level above its zoom down to the source's last
 * level, or null past `cap` tiles. A map zoomed in past the last level still needs that level.
 */
export function tilesFor(
  area: Area,
  cap = MAX_TILES,
): { z: number; x: number; y: number }[] | null {
  const out: { z: number; x: number; y: number }[] = [];
  const top = Math.min(area.maxZoom, Math.max(0, Math.floor(area.zoom) - 1));
  for (let z = top; z <= area.maxZoom; z++) {
    const x0 = lng2x(area.west, z);
    const x1 = lng2x(area.east, z);
    const y0 = lat2y(area.north, z);
    const y1 = lat2y(area.south, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        out.push({ z, x, y });
        if (out.length > cap) return null;
      }
    }
  }
  return out;
}

/** The tile URL template of the map's vector source. */
async function template(map: MLMap): Promise<string | null> {
  const src = map.getSource("openmaptiles") as { tiles?: string[]; url?: string } | undefined;
  if (src?.tiles?.[0]) return src.tiles[0];
  if (!src?.url) return null;
  const res = await fetch(src.url);
  const j = (await res.json()) as { tiles?: string[] };
  return j.tiles?.[0] ?? null;
}

export function areaOf(map: MLMap): Area {
  const b = map.getBounds();
  const src = map.getSource("openmaptiles") as { maxzoom?: number } | undefined;
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
    zoom: map.getZoom(),
    maxZoom: Math.min(src?.maxzoom ?? SOURCE_MAX_ZOOM, 16),
  };
}

export type KeepResult =
  | { ok: true; total: number; failed: number }
  | { ok: false; reason: "too-big" | "no-worker" | "no-source" };

/** Stores the visible area's tiles for offline use, reporting progress as it goes. */
export async function keepArea(
  map: MLMap,
  onProgress: (done: number, total: number) => void,
): Promise<KeepResult> {
  const tiles = tilesFor(areaOf(map));
  if (!tiles) return { ok: false, reason: "too-big" };
  if (tiles.length === 0) return { ok: false, reason: "no-source" };
  const tpl = await template(map);
  if (!tpl) return { ok: false, reason: "no-source" };
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return { ok: false, reason: "no-worker" };
  const urls = tiles.map((t) =>
    tpl.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y)),
  );
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (
      e: MessageEvent<{ done: number; failed: number; total: number; finished?: boolean }>,
    ) => {
      onProgress(e.data.done, e.data.total);
      if (e.data.finished) resolve({ ok: true, total: e.data.total, failed: e.data.failed });
    };
    worker.postMessage({ type: "keep", urls }, [channel.port2]);
  });
}
