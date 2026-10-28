/**
 * The resting screen: the places that pass the filters, nearest first (to the
 * user when located, otherwise to the map's centre), in dense ruled rows. On a
 * first visit it says how to pin the first place.
 */
import { useEffect, useState } from "preact/hooks";
import { distance } from "../../geo/geocode";
import { fmt, formatDistance, l, plural, tr } from "../../i18n";
import { mapCenter, showPoint } from "../../map/MapView";
import type { Place } from "../../store/model";
import { listById, places, tagById } from "../../store/store";
import { Icon } from "../../ui/icons";
import { IconButton, Mini } from "../../ui/ui";
import { focusSearch } from "../Search";
import { currentSnap, requestSnap } from "../Sheet";
import { filterListId, filterTagIds, go, passesFilters, userPosition } from "../state";

type Sort = "near" | "recent";

export function Home() {
  const [sort, setSort] = useState<Sort>("near");
  useEffect(() => {
    requestSnap("peek");
  }, []);

  const all = places.value;
  if (all.length === 0) return <FirstVisit />;

  const origin = userPosition.value ?? mapCenter.value;
  const shown = all.filter(passesFilters);
  const withDist = shown.map((p) => ({ p, d: distance(origin, [p.lng, p.lat]) }));
  if (sort === "near") withDist.sort((a, b) => a.d - b.d);
  const list = filterListId.value ? listById.value.get(filterListId.value) : undefined;
  const filtered = filterTagIds.value.length > 0 || list !== undefined;

  return (
    <div>
      <div class="row" style={{ marginBottom: "6px" }}>
        <h2 class="title" style={{ fontSize: "26px", margin: 0 }}>
          {shown.length} {plural(shown.length, l("spot", "spot"), l("spots", "spots"))}
          {sort === "near" && !list ? ` ${tr(l("around", "autour"))}` : ""}
        </h2>
        <span class="spacer" />
        <button
          type="button"
          class="icon-btn list-toggle"
          aria-label={
            currentSnap.value === "full"
              ? tr(l("Show the map", "Afficher la carte"))
              : tr(l("Show the list", "Afficher la liste"))
          }
          onClick={() => requestSnap(currentSnap.value === "full" ? "peek" : "full")}
        >
          <Icon name={currentSnap.value === "full" ? "map" : "list"} />
        </button>
      </div>
      <div class="chip-row">
        <button
          type="button"
          class="chip"
          onClick={() => setSort(sort === "near" ? "recent" : "near")}
          title={tr(l("Change the order", "Changer l'ordre"))}
        >
          <Icon name={sort === "near" ? "locate" : "stamp"} size={16} />
          {sort === "near" ? tr(l("Nearest", "Proches")) : tr(l("Latest", "Récents"))}
        </button>
        <button type="button" class="chip" onClick={() => go({ name: "lists" })}>
          <Icon name="list" size={16} />
          {list ? list.name : tr(l("Lists", "Listes"))}
        </button>
        {list && (
          <IconButton
            icon="close"
            label={tr(l("Show every list", "Afficher toutes les listes"))}
            onClick={() => {
              filterListId.value = null;
            }}
          />
        )}
        <button type="button" class="chip" onClick={() => go({ name: "tags" })}>
          <Icon name="tag" size={16} />
          {tr(l("Tags", "Tags"))}
        </button>
        <button type="button" class="chip" onClick={() => go({ name: "ai" })}>
          <Icon name="sparkles" size={16} />
          {tr(l("Ask", "Demander"))}
        </button>
      </div>
      {shown.length === 0 && filtered ? (
        <div class="notice">
          <p style={{ margin: "0 0 10px" }}>
            {tr(l("No place matches these filters.", "Aucun lieu ne correspond à ces filtres."))}
          </p>
          <button
            type="button"
            class="btn"
            onClick={() => {
              filterTagIds.value = [];
              filterListId.value = null;
            }}
          >
            {tr(l("Clear filters", "Retirer les filtres"))}
          </button>
        </div>
      ) : (
        <ul class="rows">
          {withDist.map(({ p, d }) => (
            <li key={p.id}>
              <PlaceRow place={p} meters={d} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlaceRow({ place, meters }: { place: Place; meters?: number }) {
  const byId = tagById.value;
  const tagNames = place.tagIds.map((id) => byId.get(id)?.name).filter(Boolean);
  const meta = [tagNames.join(", "), place.address].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      class="place-row"
      onClick={() => {
        go({ name: "place", id: place.id });
        showPoint(place.lng, place.lat, 15);
      }}
    >
      <Mini place={place} />
      <span class="row-text">
        <span class="row-name">{place.name}</span>
        {meta && <span class="row-meta">{meta}</span>}
      </span>
      {meters !== undefined && <span class="row-side">{formatDistance(meters)}</span>}
    </button>
  );
}

function FirstVisit() {
  return (
    <div class="empty stack">
      <h2 class="title">{tr(l("Your notebook is empty", "Ton carnet est vide"))}</h2>
      <p class="muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Pin the places you love or want to try. They stay in this browser: no account, nothing sent anywhere unless you sync.",
            "Épingle les lieux que tu aimes ou que tu veux tester. Ils restent dans ce navigateur : pas de compte, rien n'est envoyé ailleurs sauf si tu synchronises.",
          ),
        )}
      </p>
      <div class="stack" style={{ gap: "8px" }}>
        <button
          type="button"
          class="btn primary block"
          onClick={() => {
            focusSearch.value++;
          }}
        >
          <Icon name="search" size={18} />
          {tr(l("Find a place to pin", "Chercher un lieu à épingler"))}
        </button>
        <button type="button" class="btn block" onClick={() => go({ name: "import" })}>
          <Icon name="upload" size={18} />
          {tr(l("Import from Google Maps", "Importer depuis Google Maps"))}
        </button>
        <button type="button" class="btn block" onClick={() => go({ name: "ai" })}>
          <Icon name="sparkles" size={18} />
          {tr(l("Describe places to the AI", "Décrire des lieux à l'IA"))}
        </button>
      </div>
      <p class="hint" style={{ margin: 0 }}>
        {fmt(
          l(
            "Tip: {press} the map to pin the spot under your finger.",
            "Astuce : {press} sur la carte pour épingler l'endroit sous ton doigt.",
          ),
          {
            press: tr(
              matchMedia("(pointer: coarse)").matches
                ? l("press and hold", "appuie longuement")
                : l("right-click", "fais un clic droit"),
            ),
          },
        )}
      </p>
    </div>
  );
}
