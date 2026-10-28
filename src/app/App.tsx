/**
 * The app: the cobalt top bar with search, the tag filters over the map, the
 * floating controls (locate, pin), and the sheet holding the current screen.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { reverse } from "../geo/geocode";
import { l, tr } from "../i18n";
import { MapView, mapCenter, sheetInset, showPoint } from "../map/MapView";
import { tags } from "../store/store";
import { INKS } from "../ui/colors";
import { Icon, TagGlyph } from "../ui/icons";
import { inkStyle, Toasts, toast } from "../ui/ui";
import { focusSearch, Search } from "./Search";
import { currentSnap, Sheet } from "./Sheet";
import { Ai } from "./screens/Ai";
import { AiSettings } from "./screens/AiSettings";
import { Home } from "./screens/Home";
import { Import } from "./screens/Import";
import { ListDetail, Lists } from "./screens/Lists";
import { Menu } from "./screens/Menu";
import { EditPlace, NewPlace } from "./screens/PlaceForm";
import { PlaceView } from "./screens/PlaceView";
import { SharePreview } from "./screens/SharePreview";
import { Sync } from "./screens/Sync";
import { Tags } from "./screens/Tags";
import { draft, filterTagIds, go, route, startDraft, userPosition } from "./state";

function Screen() {
  const r = route.value;
  switch (r.name) {
    case "place":
      return <PlaceView id={r.id} />;
    case "edit":
      return <EditPlace id={r.id} />;
    case "new":
      return <NewPlace />;
    case "lists":
      return <Lists />;
    case "list":
      return <ListDetail id={r.id} />;
    case "tags":
      return <Tags />;
    case "menu":
      return <Menu />;
    case "sync":
      return <Sync />;
    case "import":
      return <Import />;
    case "ai":
      return <Ai />;
    case "ai-settings":
      return <AiSettings />;
    case "share":
      return <SharePreview data={r.data} />;
    default:
      return <Home />;
  }
}

function Filters() {
  const on = filterTagIds.value;
  if (tags.value.length === 0) return null;
  return (
    <fieldset class="filters" aria-label={tr(l("Filter by tag", "Filtrer par tag"))}>
      {tags.value.map((t) => {
        const pressed = on.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            class="filter"
            aria-pressed={pressed}
            style={inkStyle(INKS[t.color])}
            onClick={() => {
              filterTagIds.value = pressed ? on.filter((x) => x !== t.id) : [...on, t.id];
            }}
          >
            <span class="filter-dot">
              <TagGlyph icon={t.icon} size={14} />
            </span>
            {t.name}
          </button>
        );
      })}
    </fieldset>
  );
}

let watching = false;

function locate(then?: (pos: [number, number]) => void): void {
  if (!navigator.geolocation) {
    toast(
      tr(l("This browser cannot tell where you are", "Ce navigateur ne sait pas te localiser")),
    );
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const pos: [number, number] = [p.coords.longitude, p.coords.latitude];
      userPosition.value = pos;
      if (then) then(pos);
      else showPoint(pos[0], pos[1], 15);
      if (!watching) {
        watching = true;
        navigator.geolocation.watchPosition(
          (w) => {
            userPosition.value = [w.coords.longitude, w.coords.latitude];
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 15000 },
        );
      }
    },
    (err) => {
      toast(
        err.code === err.PERMISSION_DENIED
          ? tr(
              l(
                "Location is blocked for this site in your browser settings",
                "La localisation est bloquée pour ce site dans les réglages du navigateur",
              ),
            )
          : tr(l("Your position could not be found", "Ta position est introuvable")),
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
}

/** Starts a place at a point and fills in what is there. */
async function pinPoint(lng: number, lat: number): Promise<void> {
  startDraft({
    name: "",
    address: "",
    lat,
    lng,
    note: "",
    tagIds: [],
    listIds: [],
    source: "map",
    resolving: true,
  });
  showPoint(lng, lat, 16);
  try {
    const found = await reverse(lat, lng);
    const cur = draft.value;
    if (cur && cur.lat === lat && cur.lng === lng) {
      draft.value = {
        ...cur,
        resolving: false,
        name: cur.name || found?.name || "",
        address: cur.address || found?.address || "",
      };
    }
  } catch {
    const cur = draft.value;
    if (cur) draft.value = { ...cur, resolving: false };
  }
}

function PinMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as Element).closest?.(".pin-btn")
      )
        onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  const coarse = matchMedia("(pointer: coarse)").matches;
  const items: { icon: Parameters<typeof Icon>[0]["name"]; label: string; run: () => void }[] = [
    {
      icon: "search",
      label: tr(l("Search a place or paste a link", "Chercher un lieu ou coller un lien")),
      run: () => focusSearch.value++,
    },
    {
      icon: "plus",
      label: tr(l("Pin the centre of the map", "Épingler le centre de la carte")),
      run: () => void pinPoint(mapCenter.value[0], mapCenter.value[1]),
    },
    {
      icon: "locate",
      label: tr(l("Pin where I am", "Épingler là où je suis")),
      run: () => locate((p) => void pinPoint(p[0], p[1])),
    },
    {
      icon: "sparkles",
      label: tr(l("Describe places to the AI", "Décrire des lieux à l'IA")),
      run: () => go({ name: "ai" }),
    },
  ];
  return (
    <ul class="pin-menu" ref={ref}>
      {items.map((it) => (
        <li key={it.label}>
          <button
            type="button"
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <Icon name={it.icon} size={19} />
            {it.label}
          </button>
        </li>
      ))}
      <li class="hint">
        {coarse
          ? tr(l("Or press and hold the map", "Ou appuie longuement sur la carte"))
          : tr(l("Or right-click the map", "Ou fais un clic droit sur la carte"))}
      </li>
    </ul>
  );
}

export function App() {
  const [pinOpen, setPinOpen] = useState(false);
  const r = route.value;
  const wide = sheetInset.value.left > 0;
  // On a wide screen the controls clear the map attribution in the corner.
  const floatBottom = wide ? 40 : sheetInset.value.bottom + 14;
  const hideFloat = !wide && sheetInset.value.bottom > window.innerHeight * 0.6;

  return (
    <div class="app" data-sheet={wide ? "side" : currentSnap.value}>
      <MapView />
      <header class="topbar">
        <button
          type="button"
          class="wordmark"
          onClick={() => go({ name: "home" })}
          aria-label={tr(l("spots, back to the map", "spots, retour à la carte"))}
        >
          spots
          <span class="wordmark-dot" />
        </button>
        <Search />
        <button
          type="button"
          class="bar-btn"
          aria-label={tr(l("Menu", "Menu"))}
          aria-pressed={r.name === "menu"}
          onClick={() => (r.name === "menu" ? go({ name: "home" }) : go({ name: "menu" }))}
        >
          <Icon name={r.name === "menu" ? "close" : "menu"} size={24} />
        </button>
      </header>
      <Filters />
      {!hideFloat && (
        <div class="float" style={{ bottom: `${floatBottom}px` }}>
          {pinOpen && <PinMenu onClose={() => setPinOpen(false)} />}
          <button
            type="button"
            class="round-btn"
            aria-label={tr(l("Show where I am", "Afficher ma position"))}
            aria-pressed={userPosition.value !== null}
            onClick={() => locate()}
          >
            <Icon name="locate" size={21} />
          </button>
          <button
            type="button"
            class="pin-btn"
            aria-expanded={pinOpen}
            aria-haspopup="menu"
            onClick={() => setPinOpen(!pinOpen)}
          >
            <Icon name="plus" size={22} />
            {tr(l("Pin", "Épingler"))}
          </button>
        </div>
      )}
      <Sheet>
        <Screen />
      </Sheet>
      <Toasts />
    </div>
  );
}
