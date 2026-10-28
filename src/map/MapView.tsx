/**
 * The map: every place as a die-cut label (a white rim around the tag's ink,
 * the tag's glyph printed on it), clustered when zoomed out. A label's shape
 * says the place's state: a ring for "to try", a filled label once visited, a
 * second ring for a favourite. The selected place is lifted off the map as a
 * label that sticks itself on, and every other label fades behind it.
 *
 * Pressing the map (a long press, or a right click) starts a new place there.
 */
import { effect, signal } from "@preact/signals";
import type { Feature, FeatureCollection, Point } from "geojson";
import type {
  GeoJSONSource,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  Map as MLMap,
} from "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import {
  dark,
  draft,
  go,
  lastView,
  passesFilters,
  route,
  selectedId,
  startDraft,
  userPosition,
} from "../app/state";
import { reverse } from "../geo/geocode";
import { l, tr } from "../i18n";
import type { Place } from "../store/model";
import { mainTag, places } from "../store/store";
import { INKS, type Ink, UNTAGGED } from "../ui/colors";
import { iconSvg, TagGlyph } from "../ui/icons";
import { groundColor, mapStyle, recolorOps } from "./style";

/** The live map, once it has loaded. */
export const mapRef = signal<MLMap | null>(null);
/** The map's centre, [lng, lat], and zoom, kept current as it moves. */
export const mapCenter = signal<[number, number]>([2.35, 48.86]);
export const mapZoom = signal(4);
/** How much of the map the sheet covers, so the map can centre places in what stays visible. */
export const sheetInset = signal<{ bottom: number; left: number }>({ bottom: 0, left: 0 });

const SOURCE = "spots";
const LABEL_LAYERS = [
  "spots-shadow",
  "spots-ring2",
  "spots-rim",
  "spots-body",
  "spots-glyph",
  "spots-name",
];
const BODY = 10;

function inkOf(p: Place): Ink {
  const t = mainTag(p);
  return t ? INKS[t.color] : UNTAGGED;
}

function iconOf(p: Place): string {
  return mainTag(p)?.icon ?? "pin";
}

function glyphId(icon: string, color: string): string {
  return `g:${icon}:${color.slice(1)}`;
}

function featureCollection(list: Place[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: list.map((p): Feature<Point> => {
      const ink = inkOf(p);
      const icon = iconOf(p);
      const glyphColor = p.state === "try" ? ink.fill : ink.on;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          name: p.name,
          state: p.state,
          fill: ink.fill,
          glyph: glyphId(icon, glyphColor),
        },
      };
    }),
  };
}

/** Draws a tag glyph into the map's image set (once per glyph and colour). */
async function ensureGlyph(map: MLMap, id: string): Promise<void> {
  if (map.hasImage(id)) return;
  const [, icon = "pin", hex = "ffffff"] = id.split(":");
  const px = 48;
  const img = new Image(px, px);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(icon, `#${hex}`, px))}`;
  await img.decode();
  if (map.hasImage(id)) return;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, px, px);
  map.addImage(id, ctx.getImageData(0, 0, px, px), { pixelRatio: 2 });
}

function addLayers(map: MLMap): void {
  map.addSource(SOURCE, {
    type: "geojson",
    data: featureCollection([]),
    cluster: true,
    clusterRadius: 44,
    clusterMaxZoom: 12,
  });
  const single: maplibregl.ExpressionSpecification = ["!", ["has", "point_count"]];
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: SOURCE,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#1f3fa8",
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: SOURCE,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 13,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#ffffff" },
  });
  map.addLayer({
    id: "spots-shadow",
    type: "circle",
    source: SOURCE,
    filter: single,
    paint: {
      "circle-radius": BODY + 3.5,
      "circle-color": "rgba(0,0,0,0.3)",
      "circle-blur": 0.6,
      "circle-translate": [0, 2],
    },
  });
  map.addLayer({
    id: "spots-ring2",
    type: "circle",
    source: SOURCE,
    filter: ["all", single, ["==", ["get", "state"], "favorite"]] as maplibregl.FilterSpecification,
    paint: {
      "circle-radius": BODY + 6,
      "circle-opacity": 0,
      "circle-stroke-width": 2.5,
      "circle-stroke-color": ["get", "fill"],
    },
  });
  map.addLayer({
    id: "spots-rim",
    type: "circle",
    source: SOURCE,
    filter: single,
    paint: { "circle-radius": BODY + 3, "circle-color": "#ffffff" },
  });
  map.addLayer({
    id: "spots-body",
    type: "circle",
    source: SOURCE,
    filter: single,
    paint: {
      "circle-radius": ["case", ["==", ["get", "state"], "try"], BODY - 1.3, BODY],
      "circle-color": ["case", ["==", ["get", "state"], "try"], "#ffffff", ["get", "fill"]],
      "circle-stroke-width": ["case", ["==", ["get", "state"], "try"], 2.6, 0],
      "circle-stroke-color": ["get", "fill"],
    },
  });
  map.addLayer({
    id: "spots-glyph",
    type: "symbol",
    source: SOURCE,
    filter: single,
    layout: {
      "icon-image": ["get", "glyph"],
      "icon-size": 0.58,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: "spots-name",
    type: "symbol",
    source: SOURCE,
    filter: single,
    minzoom: 14.5,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-anchor": "top",
      "text-offset": [0, 1.45],
      "text-max-width": 9,
      "text-optional": true,
    },
    paint: { "text-halo-width": 1.6 },
  });
}

function paintNames(map: MLMap, isDark: boolean): void {
  map.setPaintProperty("spots-name", "text-color", isDark ? "#eef0f8" : "#16182a");
  map.setPaintProperty("spots-name", "text-halo-color", isDark ? "#131a2e" : "#ffffff");
}

/** Fades every label but the selected one, which is drawn by the sticker marker instead. */
function applySelection(map: MLMap, id: string | null): void {
  const single = ["!", ["has", "point_count"]];
  for (const layer of LABEL_LAYERS) {
    const base =
      layer === "spots-ring2" ? ["all", single, ["==", ["get", "state"], "favorite"]] : single;
    map.setFilter(
      layer,
      (id ? ["all", base, ["!=", ["get", "id"], id]] : base) as maplibregl.FilterSpecification,
    );
    const opacity = id ? 0.32 : 1;
    if (layer === "spots-glyph") map.setPaintProperty(layer, "icon-opacity", opacity);
    else if (layer === "spots-name") map.setPaintProperty(layer, "text-opacity", opacity);
    else if (layer === "spots-ring2") map.setPaintProperty(layer, "circle-stroke-opacity", opacity);
    else {
      map.setPaintProperty(layer, "circle-opacity", opacity);
      if (layer === "spots-body") map.setPaintProperty(layer, "circle-stroke-opacity", opacity);
    }
  }
  for (const layer of ["clusters", "cluster-count"]) {
    if (layer === "clusters") map.setPaintProperty(layer, "circle-opacity", id ? 0.4 : 1);
    else map.setPaintProperty(layer, "text-opacity", id ? 0.4 : 1);
  }
}

/** The selected place's label, as an element that can animate onto the map. */
function Sticker({ place }: { place: Place }) {
  const ink = inkOf(place);
  return (
    <div
      class={`sticker state-${place.state}`}
      style={{ "--fill": ink.fill, "--on": ink.on } as Record<string, string>}
    >
      <span class="sticker-body">
        <TagGlyph icon={iconOf(place)} size={22} />
      </span>
      {place.name && <span class="sticker-name">{place.name}</span>}
    </div>
  );
}

function stickerElement(place: Place): HTMLElement {
  const el = document.createElement("div");
  el.className = "sticker-anchor";
  render(<Sticker place={place} />, el);
  return el;
}

/** Moves the map so a point sits in the part the sheet leaves visible. */
export function showPoint(lng: number, lat: number, zoom?: number): void {
  const map = mapRef.value;
  if (!map) return;
  const inset = sheetInset.value;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.easeTo({
    center: [lng, lat],
    ...(zoom !== undefined ? { zoom: Math.max(map.getZoom(), zoom) } : {}),
    padding: { top: 60, bottom: inset.bottom + 20, left: inset.left + 20, right: 20 },
    duration: reduce ? 0 : 650,
  });
}

/** Frames all the given places, or does nothing when there are none. */
export function fitPlaces(list: Place[]): void {
  const map = mapRef.value;
  if (!map || list.length === 0) return;
  const first = list[0] as Place;
  if (list.length === 1) {
    showPoint(first.lng, first.lat, 15);
    return;
  }
  const bounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
  for (const p of list) bounds.extend([p.lng, p.lat]);
  const inset = sheetInset.value;
  map.fitBounds(bounds, {
    padding: { top: 90, bottom: inset.bottom + 40, left: inset.left + 40, right: 40 },
    maxZoom: 15,
    duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
  });
}

const LONG_PRESS_MS = 520;

export function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(new URL("./maplibre-gl-worker.mjs", document.baseURI).href);
    const view = lastView.value;
    const map = new maplibregl.Map({
      container: container.current,
      style: mapStyle(dark.value),
      center: view ? [view.lng, view.lat] : [8, 47],
      zoom: view ? view.zoom : 3.6,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      fadeDuration: 150,
    });
    map.touchZoomRotate.disableRotation();
    // Top right, under the filters: the sheet covers the bottom of the map on a phone.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
    container.current.style.background = groundColor(dark.value);

    const disposers: (() => void)[] = [];
    let sticker: maplibregl.Marker | null = null;
    let draftMarker: maplibregl.Marker | null = null;
    let me: maplibregl.Marker | null = null;

    map.on("load", () => {
      // The attribution stays one tap away (and in full in the menu) instead of covering the map.
      container.current
        ?.querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
      addLayers(map);
      paintNames(map, dark.value);
      mapRef.value = map;

      disposers.push(
        effect(() => {
          const list = places.value.filter(passesFilters);
          const fc = featureCollection(list);
          Promise.all(
            [...new Set(fc.features.map((f) => String(f.properties?.glyph)))].map((id: string) =>
              ensureGlyph(map, id),
            ),
          ).catch(() => {});
          (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(fc);
        }),
      );

      disposers.push(
        effect(() => {
          const id = selectedId.value;
          const place = id ? places.value.find((p) => p.id === id) : undefined;
          applySelection(map, place ? place.id : null);
          sticker?.remove();
          sticker = null;
          if (place) {
            sticker = new maplibregl.Marker({ element: stickerElement(place) })
              .setLngLat([place.lng, place.lat])
              .addTo(map);
            placeStrip();
          }
        }),
      );

      disposers.push(
        effect(() => {
          const d = draft.value;
          const onNew = route.value.name === "new";
          if (!d || !onNew) {
            draftMarker?.remove();
            draftMarker = null;
            return;
          }
          if (!draftMarker) {
            const el = document.createElement("div");
            el.className = "draft-pin";
            el.setAttribute(
              "aria-label",
              tr(l("New place: drag to adjust", "Nouveau lieu : glisser pour ajuster")),
            );
            draftMarker = new maplibregl.Marker({ element: el, draggable: true })
              .setLngLat([d.lng, d.lat])
              .addTo(map);
            draftMarker.on("dragend", () => {
              const pos = draftMarker?.getLngLat();
              const cur = draft.value;
              if (pos && cur) draft.value = { ...cur, lat: pos.lat, lng: pos.lng };
            });
          } else {
            const at = draftMarker.getLngLat();
            if (at.lat !== d.lat || at.lng !== d.lng) draftMarker.setLngLat([d.lng, d.lat]);
          }
        }),
      );

      disposers.push(
        effect(() => {
          const pos = userPosition.value;
          if (!pos) {
            me?.remove();
            me = null;
            return;
          }
          if (!me) {
            const el = document.createElement("div");
            el.className = "me-dot";
            me = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(map);
          } else me.setLngLat(pos);
        }),
      );

      disposers.push(
        effect(() => {
          const isDark = dark.value;
          for (const [layer, prop, value] of recolorOps(isDark)) {
            if (map.getLayer(layer))
              map.setPaintProperty(
                layer,
                prop as Parameters<MLMap["setPaintProperty"]>[1],
                value as Parameters<MLMap["setPaintProperty"]>[2],
              );
          }
          paintNames(map, isDark);
          if (container.current) container.current.style.background = groundColor(isDark);
        }),
      );
    });

    // The selected label's name strip runs to the right of the pin, or to its left near the right
    // edge, so it stays on screen and clear of the floating controls.
    const placeStrip = () => {
      if (!sticker) return;
      const x = map.project(sticker.getLngLat()).x;
      sticker.getElement().classList.toggle("flip", x > map.getContainer().clientWidth / 2);
    };
    map.on("move", placeStrip);

    const openFeature = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") go({ name: "place", id });
    };
    for (const layer of ["spots-body", "spots-glyph", "spots-rim"]) {
      map.on("click", layer, openFeature);
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }
    map.on("click", "clusters", async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (!f || typeof clusterId !== "number") return;
      const zoom = await (map.getSource(SOURCE) as GeoJSONSource).getClusterExpansionZoom(
        clusterId,
      );
      const [lng, lat] = (f.geometry as Point).coordinates as [number, number];
      map.easeTo({ center: [lng, lat], zoom });
    });

    // Pressing the map pins a new place there.
    const pinAt = async (lng: number, lat: number) => {
      const d = {
        name: "",
        address: "",
        lat,
        lng,
        note: "",
        tagIds: [],
        listIds: [],
        source: "map" as const,
        resolving: true,
      };
      startDraft(d);
      try {
        const found = await reverse(lat, lng);
        const cur = draft.value;
        if (!cur || cur.lat !== lat || cur.lng !== lng) return;
        draft.value = {
          ...cur,
          resolving: false,
          name: cur.name || found?.name || "",
          address: cur.address || found?.address || "",
        };
      } catch {
        const cur = draft.value;
        if (cur) draft.value = { ...cur, resolving: false };
      }
    };
    map.on("contextmenu", (e: maplibregl.MapMouseEvent) => {
      void pinAt(e.lngLat.lng, e.lngLat.lat);
    });
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let pressStart: { x: number; y: number } | null = null;
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressStart = null;
    };
    map.on("touchstart", (e: MapLayerTouchEvent) => {
      if (e.originalEvent.touches.length !== 1) return cancelPress();
      const t = e.originalEvent.touches[0];
      if (!t) return;
      pressStart = { x: t.clientX, y: t.clientY };
      const at = e.lngLat;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        pressStart = null;
        navigator.vibrate?.(12);
        void pinAt(at.lng, at.lat);
      }, LONG_PRESS_MS);
    });
    map.on("touchmove", (e: MapLayerTouchEvent) => {
      const t = e.originalEvent.touches[0];
      if (!pressStart || !t) return;
      if (Math.hypot(t.clientX - pressStart.x, t.clientY - pressStart.y) > 8) cancelPress();
    });
    map.on("touchend", cancelPress);
    map.on("touchcancel", cancelPress);
    map.on("movestart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) cancelPress();
    });

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    map.on("moveend", () => {
      const c = map.getCenter();
      mapCenter.value = [c.lng, c.lat];
      mapZoom.value = map.getZoom();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        lastView.value = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
      }, 400);
    });
    const c0 = map.getCenter();
    mapCenter.value = [c0.lng, c0.lat];
    mapZoom.value = map.getZoom();

    return () => {
      for (const d of disposers) d();
      cancelPress();
      mapRef.value = null;
      map.remove();
    };
  }, []);

  return (
    <div
      ref={container}
      class="map"
      role="application"
      aria-label={tr(l("Map of your places", "Carte de tes lieux"))}
    />
  );
}
