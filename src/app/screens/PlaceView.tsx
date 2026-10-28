/**
 * A place, as its baggage tag: name in display caps, stamped once visited,
 * address, tags, note, the state switch in the label's own shapes, and the
 * perforated stub at the foot with where the place came from.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { distance } from "../../geo/geocode";
import { formatDistance, l, locale, tr } from "../../i18n";
import { mapCenter, showPoint } from "../../map/MapView";
import type { Place, PlaceState } from "../../store/model";
import { doc, listById, mainTag, tagById, toggleInList, updatePlace } from "../../store/store";
import { Icon, TagGlyph } from "../../ui/icons";
import { IconButton, inkStyle, StateToggles, tagInk, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { back, go, userPosition } from "../state";

const SOURCES: Record<string, ReturnType<typeof l>> = {
  search: l("from a search", "par la recherche"),
  map: l("from the map", "depuis la carte"),
  link: l("from a link", "depuis un lien"),
  google: l("from Google Maps", "depuis Google Maps"),
  ai: l("by the AI", "par l'IA"),
  share: l("from a shared list", "depuis une liste partagée"),
  import: l("from a backup", "depuis une sauvegarde"),
};

export function directionsUrl(p: Place): string {
  const apple = /iPad|iPhone|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
  return apple
    ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

export function osmUrl(p: Place): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat.toFixed(6)}&mlon=${p.lng.toFixed(6)}#map=18/${p.lat.toFixed(6)}/${p.lng.toFixed(6)}`;
}

async function sharePlace(p: Place): Promise<void> {
  const text = [p.name, p.address, osmUrl(p)].filter(Boolean).join("\n");
  if (navigator.share) {
    try {
      await navigator.share({ title: p.name, text });
      return;
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(tr(l("Place copied", "Lieu copié")));
  } catch {
    toast(tr(l("Could not share this place", "Impossible de partager ce lieu")));
  }
}

export function PlaceView({ id }: { id: string }) {
  const place = doc.value.places[id];
  const [stamped, setStamped] = useState(false);
  const shown = useRef<string | null>(null);

  useEffect(() => {
    requestSnap("half");
  }, [id]);
  useEffect(() => {
    if (place && shown.current !== id) {
      shown.current = id;
      showPoint(place.lng, place.lat);
    }
  }, [id, place !== undefined]);

  if (!place || place.deletedAt !== undefined) {
    return (
      <div class="stack">
        <p class="muted">
          {tr(
            l("This place is no longer in your notebook.", "Ce lieu n'est plus dans ton carnet."),
          )}
        </p>
        <button type="button" class="btn" onClick={() => go({ name: "home" }, { replace: true })}>
          {tr(l("Back to the map", "Retour à la carte"))}
        </button>
      </div>
    );
  }

  const byTag = tagById.value;
  const placeTags = place.tagIds.map((t) => byTag.get(t)).filter((t) => t !== undefined);
  const byList = listById.value;
  const placeLists = place.listIds.map((x) => byList.get(x)).filter((x) => x !== undefined);
  const origin = userPosition.value ?? mapCenter.value;
  const d = distance(origin, [place.lng, place.lat]);
  const added = new Date(place.createdAt).toLocaleDateString(locale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const setState = (s: PlaceState) => {
    if (s === place.state) return;
    updatePlace(place.id, { state: s });
    setStamped(s !== "try");
  };

  return (
    <article>
      <div class="screen-head" style={{ marginBottom: 0 }}>
        <IconButton icon="back" label={tr(l("Back", "Retour"))} onClick={() => back()} />
        <span class="spacer" />
        <IconButton
          icon="share"
          label={tr(l("Share", "Partager"))}
          onClick={() => void sharePlace(place)}
        />
        <IconButton
          icon="edit"
          label={tr(l("Edit", "Modifier"))}
          onClick={() => go({ name: "edit", id: place.id })}
        />
      </div>
      <div class="title-row">
        <h1 class="title">{place.name || tr(l("Unnamed place", "Lieu sans nom"))}</h1>
        {place.state !== "try" && (
          <span class={stamped ? "stamp fresh" : "stamp"}>
            {place.state === "favorite" ? tr(l("Favourite", "Favori")) : tr(l("Visited", "Visité"))}
          </span>
        )}
      </div>
      <p class="meta" style={{ margin: "6px 0 0" }}>
        {[place.address, formatDistance(d)].filter(Boolean).join(" · ")}
      </p>
      {placeTags.length > 0 && (
        <div class="chips" style={{ marginTop: "14px" }}>
          {placeTags.map((t) => (
            <span key={t.id} class="chip ink" style={inkStyle(tagInk(t))}>
              <TagGlyph icon={t.icon} size={15} />
              {t.name}
            </span>
          ))}
        </div>
      )}
      {place.note && (
        <p class="prose" style={{ marginTop: "14px" }}>
          {place.note}
        </p>
      )}

      <div style={{ marginTop: "18px" }}>
        <StateToggles value={place.state} ink={tagInk(mainTag(place))} onChange={setState} />
      </div>

      <div class="actions" style={{ marginTop: "12px" }}>
        <a class="btn" href={directionsUrl(place)} target="_blank" rel="noopener noreferrer">
          <Icon name="route" size={17} />
          {tr(l("Go", "Y aller"))}
        </a>
        {place.url ? (
          <a class="btn" href={place.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={17} />
            {tr(l("Link", "Lien"))}
          </a>
        ) : (
          <a
            class="btn"
            href={osmUrl(place)}
            target="_blank"
            rel="noopener noreferrer"
            title={tr(l("Open in OpenStreetMap", "Ouvrir dans OpenStreetMap"))}
          >
            <Icon name="external" size={17} />
            {tr(l("Open", "Ouvrir"))}
          </a>
        )}
        <button type="button" class="btn" onClick={() => showPoint(place.lng, place.lat, 17)}>
          <Icon name="locate" size={17} />
          {tr(l("Zoom", "Zoomer"))}
        </button>
      </div>

      <div class="section">
        <div class="label" style={{ marginBottom: "8px" }}>
          {tr(l("Lists", "Listes"))}
        </div>
        <div class="chips">
          {placeLists.map((x) => (
            <button
              key={x.id}
              type="button"
              class="chip"
              aria-pressed="true"
              onClick={() => toggleInList(place.id, x.id)}
              aria-label={`${x.name}: ${tr(l("remove from this list", "retirer de cette liste"))}`}
            >
              {x.name}
              <Icon name="close" size={14} />
            </button>
          ))}
          <button type="button" class="chip" onClick={() => go({ name: "edit", id: place.id })}>
            <Icon name="plus" size={15} />
            {tr(l("Add to a list", "Ajouter à une liste"))}
          </button>
        </div>
      </div>

      <div class="stub">
        <span class="small muted" style={{ flex: 1 }}>
          {tr(l("Pinned", "Épinglé le"))} {added}
          {place.source && SOURCES[place.source]
            ? ` ${tr(SOURCES[place.source] as ReturnType<typeof l>)}`
            : ""}
        </span>
      </div>
    </article>
  );
}
