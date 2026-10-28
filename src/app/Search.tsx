/**
 * The search field in the top bar. It finds the user's own places first, then
 * places on OpenStreetMap near the map's centre, and recognises a pasted maps
 * link or coordinates. Picking a result opens the place, or starts pinning it.
 */
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { distance, type GeoResult, KIND_TO_ICON, search } from "../geo/geocode";
import { type ParsedLink, parseMapLink } from "../geo/links";
import { formatDistance, l, tr } from "../i18n";
import { mapCenter, mapZoom, showPoint } from "../map/MapView";
import type { Place } from "../store/model";
import { places, tagById, tags } from "../store/store";
import { Icon } from "../ui/icons";
import { Mini } from "../ui/ui";
import { go, startDraft } from "./state";

/** Focus requests from elsewhere (the pin button). */
export const focusSearch = signal(0);

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Own places matching every word of the query, by name, address, note or tag. */
export function matchPlaces(q: string, list: Place[]): Place[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const byId = tagById.value;
  return list.filter((p) => {
    const hay = fold(
      [p.name, p.address, p.note, ...p.tagIds.map((id) => byId.get(id)?.name ?? "")].join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}

/** The tag a found place probably belongs to, from its OpenStreetMap kind. */
export function suggestTag(kind: string | undefined): string[] {
  if (!kind) return [];
  const icon = KIND_TO_ICON[kind];
  if (!icon) return [];
  const t = tags.value.find((x) => x.icon === icon);
  return t ? [t.id] : [];
}

type Item =
  | { kind: "own"; place: Place }
  | { kind: "geo"; result: GeoResult }
  | { kind: "link"; link: ParsedLink };

export function Search() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState<GeoResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSearch.value > 0) {
      input.current?.focus();
      setOpen(true);
    }
  }, [focusSearch.value]);

  const link = q.trim() ? parseMapLink(q) : null;
  const own = link ? [] : matchPlaces(q, places.value).slice(0, 5);

  useEffect(() => {
    const text = q.trim();
    if (link || text.length < 3) {
      setGeo([]);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const found = await search(text, {
          near: mapCenter.value,
          zoom: mapZoom.value,
          signal: ctrl.signal,
        });
        setGeo(found);
        setStatus("idle");
      } catch {
        if (!ctrl.signal.aborted) setStatus("error");
      }
    }, 320);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, link === null]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const items: Item[] = [
    ...(link ? [{ kind: "link" as const, link }] : []),
    ...own.map((place) => ({ kind: "own" as const, place })),
    ...geo.map((result) => ({ kind: "geo" as const, result })),
  ];

  const close = () => {
    setOpen(false);
    setQ("");
    input.current?.blur();
  };

  const pick = (item: Item) => {
    if (item.kind === "own") {
      go({ name: "place", id: item.place.id });
      showPoint(item.place.lng, item.place.lat, 15);
    } else if (item.kind === "geo") {
      const r = item.result;
      startDraft({
        name: r.name,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        note: "",
        tagIds: suggestTag(r.kind),
        listIds: [],
        source: "search",
      });
      showPoint(r.lng, r.lat, 16);
    } else {
      const k = item.link;
      if (k.lat !== undefined && k.lng !== undefined) {
        const provider = k.provider === "coords" || k.provider === "geo";
        startDraft({
          name: k.name ?? "",
          address: "",
          lat: k.lat,
          lng: k.lng,
          note: "",
          tagIds: [],
          listIds: [],
          ...(provider ? {} : { url: k.url }),
          source: "link",
        });
        showPoint(k.lng, k.lat, 16);
      } else if (k.query || k.name) {
        setQ(k.query ?? k.name ?? "");
        return;
      } else return;
    }
    close();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const item = items[active] ?? items[0];
      if (item) pick(item);
    }
  };

  const showList = open && q.trim().length > 0;
  const here = mapCenter.value;

  return (
    <div class="search" ref={root}>
      <label class="search-field">
        <Icon name="search" size={18} />
        <span class="sr-only">{tr(l("Search", "Rechercher"))}</span>
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellcheck={false}
          aria-controls="search-results"
          placeholder={tr(l("Search a place, paste a link…", "Chercher un lieu, coller un lien…"))}
          value={q}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
        {status === "loading" && <Icon name="spinner" size={18} class="spin" />}
        {q && (
          <button
            type="button"
            class="clear-btn"
            aria-label={tr(l("Clear", "Effacer"))}
            onClick={() => {
              setQ("");
              input.current?.focus();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </label>
      {showList && (
        <ul class="results" id="search-results" aria-label={tr(l("Results", "Résultats"))}>
          {link && (
            <li>
              <ResultButton
                selected={active === 0}
                onPick={() => pick({ kind: "link", link })}
                icon="link"
                name={
                  link.unresolvable
                    ? tr(
                        l(
                          "Short links cannot be opened here",
                          "Les liens courts ne s'ouvrent pas ici",
                        ),
                      )
                    : link.lat !== undefined
                      ? tr(l("Pin this link", "Épingler ce lien"))
                      : tr(l("Search this name", "Chercher ce nom"))
                }
                meta={
                  link.unresolvable
                    ? tr(
                        l(
                          "Open it in your browser first, then paste the full address",
                          "Ouvre-le d'abord dans ton navigateur, puis colle l'adresse complète",
                        ),
                      )
                    : (link.name ??
                      (link.lat !== undefined
                        ? `${link.lat.toFixed(5)}, ${link.lng?.toFixed(5)}`
                        : (link.query ?? "")))
                }
              />
            </li>
          )}
          {own.length > 0 && <li class="results-head">{tr(l("Your places", "Tes lieux"))}</li>}
          {own.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                class="result"
                data-active={active === i + (link ? 1 : 0)}
                onClick={() => pick({ kind: "own", place: p })}
              >
                <Mini place={p} size={28} />
                <span class="result-text">
                  <span class="result-name">{p.name}</span>
                  <span class="result-meta">
                    {[tagById.value.get(p.tagIds[0] ?? "")?.name, p.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {geo.length > 0 && <li class="results-head">{tr(l("On the map", "Sur la carte"))}</li>}
          {geo.map((r, i) => (
            <li key={r.key}>
              <ResultButton
                selected={active === i + own.length + (link ? 1 : 0)}
                onPick={() => pick({ kind: "geo", result: r })}
                icon="plus"
                name={r.name}
                meta={[r.address, formatDistance(distance(here, [r.lng, r.lat]))]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </li>
          ))}
          {status === "error" && (
            <li class="results-note">
              {tr(
                l(
                  "The search service did not answer. Check your connection and try again.",
                  "Le service de recherche n'a pas répondu. Vérifie ta connexion et réessaie.",
                ),
              )}
            </li>
          )}
          {status === "idle" &&
            !link &&
            own.length === 0 &&
            geo.length === 0 &&
            q.trim().length >= 3 && (
              <li class="results-note">{tr(l("Nothing found.", "Rien trouvé."))}</li>
            )}
          {q.trim().length > 0 && q.trim().length < 3 && own.length === 0 && !link && (
            <li class="results-note">{tr(l("Keep typing…", "Continue à taper…"))}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ResultButton({
  selected,
  onPick,
  icon,
  name,
  meta,
}: {
  selected: boolean;
  onPick: () => void;
  icon: "plus" | "link";
  name: string;
  meta: string;
}) {
  return (
    <button type="button" class="result" data-active={selected} onClick={onPick}>
      <span class="result-pin">
        <Icon name={icon} size={16} />
      </span>
      <span class="result-text">
        <span class="result-name">{name}</span>
        {meta && <span class="result-meta">{meta}</span>}
      </span>
    </button>
  );
}
