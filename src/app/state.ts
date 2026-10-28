/**
 * Interface state: the route (in the URL hash, so the back button and links
 * work), the filters, the place being drafted, the user's position, the theme
 * and the last map view. Preferences survive reloads; the rest does not.
 */
import { computed, effect, signal } from "@preact/signals";
import type { Place, PlaceSource } from "../store/model";

export type Route =
  | { name: "home" }
  | { name: "place"; id: string }
  | { name: "edit"; id: string }
  | { name: "new" }
  | { name: "lists" }
  | { name: "list"; id: string }
  | { name: "tags" }
  | { name: "menu" }
  | { name: "sync" }
  | { name: "import" }
  | { name: "ai" }
  | { name: "ai-settings" }
  | { name: "share"; data: string };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [head = "", ...rest] = h.split("/");
  const arg = rest.join("/");
  switch (head) {
    case "p":
      return rest[1] === "edit" && rest[0]
        ? { name: "edit", id: rest[0] }
        : arg
          ? { name: "place", id: arg }
          : { name: "home" };
    case "new":
      return { name: "new" };
    case "lists":
      return { name: "lists" };
    case "list":
      return arg ? { name: "list", id: arg } : { name: "lists" };
    case "tags":
      return { name: "tags" };
    case "menu":
      return { name: "menu" };
    case "sync":
      return { name: "sync" };
    case "import":
      return { name: "import" };
    case "ai":
      return arg === "settings" ? { name: "ai-settings" } : { name: "ai" };
    case "share":
      return arg ? { name: "share", data: arg } : { name: "home" };
    default:
      return { name: "home" };
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case "home":
      return "#/";
    case "place":
      return `#/p/${r.id}`;
    case "edit":
      return `#/p/${r.id}/edit`;
    case "list":
      return `#/list/${r.id}`;
    case "ai-settings":
      return "#/ai/settings";
    case "share":
      return `#/share/${r.data}`;
    default:
      return `#/${r.name}`;
  }
}

export const route = signal<Route>(
  typeof location === "undefined" ? { name: "home" } : parseRoute(location.hash),
);

/** How many screens this tab pushed: going back past them would leave the app. */
let depth = 0;

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    route.value = parseRoute(location.hash);
  });
  window.addEventListener("popstate", () => {
    depth = Math.max(0, depth - 1);
  });
}

export function go(r: Route, opts: { replace?: boolean } = {}): void {
  const target = href(r);
  if (opts.replace) history.replaceState(null, "", target);
  else if (location.hash !== target) {
    history.pushState(null, "", target);
    depth++;
  }
  route.value = r;
}

/** Back to the previous screen when this tab has one, otherwise to `fallback`. */
export function back(fallback: Route = { name: "home" }): void {
  if (depth > 0) history.back();
  else go(fallback, { replace: true });
}

/** The place the map shows as selected: the one open in the sheet. */
export const selectedId = computed(() => {
  const r = route.value;
  return r.name === "place" || r.name === "edit" ? r.id : null;
});

/** A place being pinned, before it is saved. */
export interface Draft {
  name: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  tagIds: string[];
  listIds: string[];
  url?: string;
  source: PlaceSource;
  /** Still looking up the address of a point pressed on the map. */
  resolving?: boolean;
}

export const draft = signal<Draft | null>(null);

export function startDraft(d: Draft): void {
  draft.value = d;
  go({ name: "new" });
}

export const filterTagIds = signal<string[]>([]);
export const filterListId = signal<string | null>(null);
export const searchText = signal("");

/** The user's position once they allowed it, [lng, lat]. */
export const userPosition = signal<[number, number] | null>(null);

/** Places that pass the current tag and list filters (search text is applied by the views). */
export function passesFilters(p: Place): boolean {
  const tagsOn = filterTagIds.value;
  if (tagsOn.length > 0 && !p.tagIds.some((t) => tagsOn.includes(t))) return false;
  const list = filterListId.value;
  if (list && !p.listIds.includes(list)) return false;
  return true;
}

export type Theme = "system" | "light" | "dark";

interface Prefs {
  theme: Theme;
  view: { lng: number; lat: number; zoom: number } | null;
}

const PREFS_KEY = "spots:prefs";

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const theme: Theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system";
      const v = raw.view;
      const view =
        v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && Number.isFinite(v.zoom)
          ? { lng: v.lng, lat: v.lat, zoom: v.zoom }
          : null;
      return { theme, view };
    }
  } catch {}
  return { theme: "system", view: null };
}

const initialPrefs =
  typeof window === "undefined" ? { theme: "system" as Theme, view: null } : readPrefs();
export const theme = signal<Theme>(initialPrefs.theme);
export const lastView = signal<Prefs["view"]>(initialPrefs.view);

const systemDark = signal(
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches,
);
if (typeof matchMedia !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    systemDark.value = e.matches;
  });
}

/** The theme in effect: the user's choice, or the system's. */
export const dark = computed(() =>
  theme.value === "system" ? systemDark.value : theme.value === "dark",
);

if (typeof window !== "undefined") {
  effect(() => {
    document.documentElement.dataset.theme = dark.value ? "dark" : "light";
  });
  effect(() => {
    const prefs: Prefs = { theme: theme.value, view: lastView.value };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  });
}
