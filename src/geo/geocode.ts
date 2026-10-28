/**
 * Finding places: Photon (komoot's OpenStreetMap geocoder, made for search as
 * you type) for search and reverse lookups, and Nominatim as the fallback for
 * a reverse lookup, at most one request a second as its policy asks. Both are
 * free and keyless; their fair-use rules are why searches are debounced by the
 * caller and cancelled when superseded.
 */
import { lang } from "../i18n";

export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** OpenStreetMap's kind of place ("restaurant", "cafe", "museum"…), to suggest a tag. */
  kind?: string;
  /** A unique key for lists. */
  key: string;
}

const PHOTON = "https://photon.komoot.io";
const NOMINATIM = "https://nominatim.openstreetmap.org";

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  district?: string;
  locality?: string;
  state?: string;
  country?: string;
  osm_key?: string;
  osm_value?: string;
  osm_type?: string;
  osm_id?: number;
  type?: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: PhotonProps;
}

function photonLang(): string {
  return lang.value === "fr" ? "fr" : "en";
}

/** "20 Rue Alibert, 75010 Paris" from Photon's parts, without repeating the name. */
export function formatAddress(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const town = [p.postcode, p.city ?? p.district ?? p.locality].filter(Boolean).join(" ");
  const parts = [street, town];
  if (!street && !town) parts.push(p.state ?? "", p.country ?? "");
  else if (p.country && !town) parts.push(p.country);
  return parts.filter(Boolean).join(", ");
}

export function fromPhoton(f: PhotonFeature): GeoResult | null {
  const c = f.geometry?.coordinates;
  const p = f.properties ?? {};
  if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const address = formatAddress(p);
  const name = p.name ?? ([p.housenumber, p.street].filter(Boolean).join(" ") || address);
  if (!name) return null;
  const kind =
    p.osm_key && p.osm_key !== "place" && p.osm_key !== "highway" ? p.osm_value : undefined;
  return {
    name,
    address: address === name ? "" : address,
    lng: c[0],
    lat: c[1],
    ...(kind ? { kind } : {}),
    key: `${p.osm_type ?? ""}${p.osm_id ?? `${c[0]},${c[1]}`}`,
  };
}

/** Places matching `q`, nearest to `near` first when given. */
export async function search(
  q: string,
  opts: { near?: [number, number]; zoom?: number; signal?: AbortSignal; limit?: number } = {},
): Promise<GeoResult[]> {
  const url = new URL(`${PHOTON}/api/`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(opts.limit ?? 8));
  url.searchParams.set("lang", photonLang());
  if (opts.near) {
    url.searchParams.set("lon", opts.near[0].toFixed(5));
    url.searchParams.set("lat", opts.near[1].toFixed(5));
    url.searchParams.set("zoom", String(Math.round(Math.min(18, Math.max(4, opts.zoom ?? 12)))));
  }
  const res = await fetch(url, opts.signal ? { signal: opts.signal } : {});
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const f of json.features ?? []) {
    const r = fromPhoton(f);
    if (r && !seen.has(r.key)) {
      seen.add(r.key);
      out.push(r);
    }
  }
  return out;
}

let lastNominatim = 0;

async function nominatimReverse(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeoResult | null> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = new URL(`${NOMINATIM}/reverse`);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lng.toFixed(6));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", photonLang());
  // Nominatim asks to know which site sends the request; the page's own policy sends no referrer.
  const res = await fetch(url, { referrerPolicy: "origin", ...(signal ? { signal } : {}) });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    name?: string;
    display_name?: string;
    category?: string;
    type?: string;
    address?: Record<string, string>;
  };
  const a = j.address ?? {};
  const address = formatAddress({
    ...(a.house_number ? { housenumber: a.house_number } : {}),
    ...(a.road ? { street: a.road } : {}),
    ...(a.postcode ? { postcode: a.postcode } : {}),
    ...(a.city || a.town || a.village ? { city: a.city ?? a.town ?? a.village } : {}),
    ...(a.country ? { country: a.country } : {}),
  });
  const name = j.name || address || j.display_name || "";
  if (!name) return null;
  return {
    name,
    address: address === name ? "" : address,
    lat,
    lng,
    key: `nominatim:${lat},${lng}`,
  };
}

/** What is at a point: the nearest named place or address, or null. */
export async function reverse(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<GeoResult | null> {
  try {
    const url = new URL(`${PHOTON}/reverse`);
    url.searchParams.set("lat", lat.toFixed(6));
    url.searchParams.set("lon", lng.toFixed(6));
    url.searchParams.set("lang", photonLang());
    url.searchParams.set("limit", "1");
    const res = await fetch(url, signal ? { signal } : {});
    if (res.ok) {
      const json = (await res.json()) as { features?: PhotonFeature[] };
      const f = json.features?.[0];
      const r = f ? fromPhoton(f) : null;
      if (r) return { ...r, lat, lng };
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return nominatimReverse(lat, lng, signal);
}

/** Distance in metres between two [lng, lat] points (haversine). */
export function distance(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** OpenStreetMap kinds that suggest each starter tag, so a found restaurant lands in Food. */
export const KIND_TO_ICON: Record<string, string> = {
  restaurant: "utensils",
  fast_food: "utensils",
  food_court: "utensils",
  cafe: "coffee",
  bakery: "croissant",
  ice_cream: "ice-cream",
  bar: "wine",
  pub: "beer",
  biergarten: "beer",
  nightclub: "cocktail",
  museum: "landmark",
  attraction: "landmark",
  viewpoint: "camera",
  artwork: "palette",
  gallery: "palette",
  monument: "landmark",
  memorial: "landmark",
  castle: "landmark",
  park: "park",
  garden: "park",
  beach: "beach",
  cinema: "cinema",
  theatre: "cinema",
  hotel: "hotel",
  hostel: "hotel",
  guest_house: "hotel",
  books: "book",
  clothes: "shop",
  gift: "gift",
  supermarket: "store",
  marketplace: "store",
  convenience: "store",
};
