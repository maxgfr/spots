/**
 * Recognises a pasted maps link (Google Maps, Apple Maps, OpenStreetMap, `geo:` URIs) or bare
 * coordinates, and pulls out what it can: coordinates, a place name, a search query. The text
 * may be a whole shared message; the first link in it is used. Short links (maps.app.goo.gl and
 * the like) cannot be followed from the browser across origins, so they come back flagged
 * `unresolvable`.
 */

export type LinkProvider = "google" | "apple" | "osm" | "geo" | "coords";

export interface ParsedLink {
  lat?: number;
  lng?: number;
  /** The label of the place, when the link names it. */
  name?: string;
  /** Text to geocode (a search or an address), when the link carries one. */
  query?: string;
  /** The link itself; for bare coordinates, the text as pasted. */
  url: string;
  provider: LinkProvider;
  /** A short link that would need to be followed by a server to say where it points. */
  unresolvable?: true;
}

interface Coords {
  lat: number;
  lng: number;
}

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const COORDS_RE = new RegExp(String.raw`^\s*(${NUM})\s*,\s*(${NUM})\s*$`);
const DEC = String.raw`[-+]?\d{1,3}\.\d+`;
const BARE_COORDS_RE = new RegExp(
  String.raw`^\s*(${DEC})\s*°?\s*([NS])?\s*(?:[,;]\s*|\s+)(${DEC})\s*°?\s*([EWO])?\s*$`,
  "i",
);

function valid(lat: number, lng: number): Coords | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** Whether a text is shaped like "48.87,2.37", in range or not. */
function isCoordsText(text: string | null | undefined): boolean {
  return text ? COORDS_RE.test(text) : false;
}

/** "48.87,2.37" (as found in a query parameter) as coordinates. */
function coordsOf(text: string | null | undefined): Coords | undefined {
  if (!text) return undefined;
  const m = COORDS_RE.exec(text);
  return m ? valid(Number(m[1]), Number(m[2])) : undefined;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text.replace(/\+/g, " ");
  }
}

function clean(text: string | null | undefined): string | undefined {
  const t = text?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

function result(
  provider: LinkProvider,
  url: string,
  coords: Coords | undefined,
  name?: string,
  query?: string,
): ParsedLink | null {
  const out: ParsedLink = { url, provider };
  if (coords) {
    out.lat = coords.lat;
    out.lng = coords.lng;
  }
  if (name) out.name = name;
  if (query) out.query = query;
  return coords || name || query ? out : null;
}

function parseBareCoords(text: string): ParsedLink | null {
  const m = BARE_COORDS_RE.exec(text);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() !== "E") lng = -Math.abs(lng);
  const coords = valid(lat, lng);
  return coords ? { ...coords, url: text.trim(), provider: "coords" } : null;
}

function parseGeo(uri: string): ParsedLink | null {
  const body = uri.replace(/^geo:/i, "");
  const [path = "", search = ""] = body.split("?", 2);
  const [lat = "", lng = ""] = (path.split(";")[0] ?? "").split(",");
  let coords = lat.trim() && lng.trim() ? valid(Number(lat), Number(lng)) : undefined;
  // geo:0,0 means "no position, search for q instead".
  if (coords && coords.lat === 0 && coords.lng === 0) coords = undefined;
  let name: string | undefined;
  let query: string | undefined;
  const q = new URLSearchParams(search).get("q");
  if (q) {
    // Android writes "geo:0,0?q=48.87,2.37(Label)".
    const m = /^([^()]*)(?:\(([^)]*)\))?\s*$/.exec(q);
    const head = clean(m?.[1] ?? q);
    name = clean(m?.[2]);
    const inQuery = coordsOf(head);
    if (inQuery) coords ??= inQuery;
    // Coordinates out of range are dropped, not taken as a name.
    else if (!isCoordsText(head)) {
      if (coords) name ??= head;
      else query = head;
    }
  }
  return result("geo", uri, coords, name, query);
}

function isGoogleHost(host: string): boolean {
  return /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(host);
}

function parseGoogle(url: URL): ParsedLink | null {
  const href = url.href;
  const full = decode(url.pathname + url.search);
  const params = url.searchParams;

  let name: string | undefined;
  let query: string | undefined;
  let coords: Coords | undefined;

  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(full);
  if (pin) coords = valid(Number(pin[1]), Number(pin[2]));

  const place = /\/maps\/place\/([^/?#]+)/.exec(url.pathname);
  if (place?.[1]) {
    const text = decode(place[1]);
    const asCoords = coordsOf(text);
    if (asCoords) coords ??= asCoords;
    else if (!isCoordsText(text)) name = clean(text);
  }

  const search = /\/maps\/search\/([^/?#]+)/.exec(url.pathname);
  if (search?.[1]) {
    const text = decode(search[1]);
    const asCoords = coordsOf(text);
    if (asCoords) coords ??= asCoords;
    else if (!isCoordsText(text)) query = clean(text);
  }

  for (const key of ["q", "query", "destination", "daddr"]) {
    const value = params.get(key);
    if (!value) continue;
    const asCoords = coordsOf(value);
    if (asCoords) coords ??= asCoords;
    else if (!isCoordsText(value)) query ??= clean(value);
  }

  coords ??= coordsOf(params.get("ll")) ?? coordsOf(params.get("center"));

  if (!coords) {
    const view = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url.pathname);
    if (view) coords = valid(Number(view[1]), Number(view[2]));
  }

  return result("google", href, coords, name, query);
}

function parseApple(url: URL): ParsedLink | null {
  const params = url.searchParams;
  const coords =
    coordsOf(params.get("coordinate")) ??
    coordsOf(params.get("ll")) ??
    coordsOf(params.get("q")) ??
    coordsOf(params.get("sll"));
  const q = clean(params.get("q"));
  const qIsCoords = isCoordsText(q);
  const address = clean(params.get("address"));
  let name = clean(params.get("name"));
  let query: string | undefined;
  if (q && !qIsCoords) {
    if (coords) name ??= q;
    else query = q;
  }
  if (address) query = address;
  return result("apple", url.href, coords, name, query);
}

function parseOsm(url: URL): ParsedLink | null {
  const params = url.searchParams;
  let coords = valid(
    Number(params.get("mlat") ?? Number.NaN),
    Number(params.get("mlon") ?? Number.NaN),
  );
  if (!coords) {
    const m = /map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(url.hash);
    if (m) coords = valid(Number(m[1]), Number(m[2]));
  }
  const q = clean(params.get("query"));
  coords ??= coordsOf(q);
  return result("osm", url.href, coords, undefined, isCoordsText(q) ? undefined : q);
}

const URL_RE = /\b(?:https?:\/\/|geo:)[^\s<>"'`]+/i;
const BARE_HOST_RE =
  /\b(?:(?:www\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com|maps\.apple\/|(?:www\.)?openstreetmap\.org|osm\.org\/)[^\s<>"'`]*/i;

/** The first link in a piece of text, without trailing punctuation. */
function findLink(text: string): string | undefined {
  const m = URL_RE.exec(text) ?? BARE_HOST_RE.exec(text);
  if (!m) return undefined;
  let link = m[0].replace(/[.,;:!?)\]}»]+$/, "");
  if (!/^(?:https?:\/\/|geo:)/i.test(link)) link = `https://${link}`;
  return link;
}

/**
 * Parses a pasted maps link, `geo:` URI or bare coordinates ("48.8738, 2.3705"). Returns null
 * when nothing usable is found.
 */
export function parseMapLink(input: string): ParsedLink | null {
  const text = input.trim();
  if (text === "") return null;

  const bare = parseBareCoords(text);
  if (bare) return bare;

  // A geo: URI may hold spaces in its label, so take it whole when it is all there is.
  const link = /^geo:/i.test(text) ? text : findLink(text);
  if (!link) return null;
  if (/^geo:/i.test(link)) return parseGeo(link);

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();

  if (
    host === "maps.app.goo.gl" ||
    host === "g.page" ||
    (host === "goo.gl" && url.pathname.startsWith("/maps"))
  ) {
    return { url: url.href, provider: "google", unresolvable: true };
  }
  if (host === "maps.apple" || host === "www.maps.apple") {
    return { url: url.href, provider: "apple", unresolvable: true };
  }
  if (isGoogleHost(host) && (host.startsWith("maps.") || url.pathname.startsWith("/maps"))) {
    return parseGoogle(url);
  }
  if (host === "maps.apple.com" || host === "beta.maps.apple.com") return parseApple(url);
  if (/^(?:www\.)?(?:openstreetmap\.org|osm\.org)$/.test(host)) return parseOsm(url);
  return null;
}
