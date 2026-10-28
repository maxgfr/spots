/**
 * Lists: a city, a trip, a theme. Each can be shown alone on the map and sent
 * as a link that carries the list itself (nothing goes through a server).
 */
import { useEffect, useState } from "preact/hooks";
import { fmt, l, plural, tr } from "../../i18n";
import { fitPlaces } from "../../map/MapView";
import { buildSharePayload, encodeShare } from "../../share/share";
import { addList, deleteList, doc, listById, lists, places, updateList } from "../../store/store";
import { Icon } from "../../ui/icons";
import { copyText, IconButton, ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { filterListId, go } from "../state";
import { PlaceRow } from "./Home";

export function Lists() {
  const [name, setName] = useState("");
  useEffect(() => {
    requestSnap("half");
  }, []);

  const counts = new Map<string, number>();
  for (const p of places.value)
    for (const id of p.listIds) counts.set(id, (counts.get(id) ?? 0) + 1);

  const create = (e: Event) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const x = addList({ name: n });
    setName("");
    go({ name: "list", id: x.id });
  };

  return (
    <div class="stack">
      <ScreenHead title={tr(l("Lists", "Listes"))} />
      {lists.value.length === 0 && (
        <p class="muted" style={{ margin: 0 }}>
          {tr(
            l(
              "Group places for a trip, a city or a theme, then share the list as a link.",
              "Regroupe des lieux pour un voyage, une ville ou un thème, puis partage la liste par un lien.",
            ),
          )}
        </p>
      )}
      {lists.value.length > 0 && (
        <ul class="menu-list">
          {lists.value.map((x) => {
            const n = counts.get(x.id) ?? 0;
            return (
              <li key={x.id}>
                <button
                  type="button"
                  class="menu-item"
                  onClick={() => go({ name: "list", id: x.id })}
                >
                  <Icon name="list" />
                  <span class="menu-text">
                    <strong>{x.name}</strong>
                    <span>
                      {n} {plural(n, l("place", "lieu"), l("places", "lieux"))}
                    </span>
                  </span>
                  <Icon name="next" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form class="row" style={{ flexWrap: "nowrap" }} onSubmit={create}>
        <input
          class="input"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder={tr(l("New list: Lisbon in May…", "Nouvelle liste : Lisbonne en mai…"))}
          aria-label={tr(l("New list name", "Nom de la nouvelle liste"))}
        />
        <button type="submit" class="btn shell" disabled={!name.trim()}>
          <Icon name="plus" size={18} />
          {tr(l("Create", "Créer"))}
        </button>
      </form>
    </div>
  );
}

export function shareUrl(data: string): string {
  return `${location.origin}${location.pathname}#/share/${data}`;
}

export function ListDetail({ id }: { id: string }) {
  const list = listById.value.get(id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list?.name ?? "");
  const [desc, setDesc] = useState(list?.description ?? "");
  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    requestSnap("half");
  }, [id]);

  if (!list) {
    return (
      <div class="stack">
        <ScreenHead title={tr(l("List", "Liste"))} />
        <p class="muted">{tr(l("This list no longer exists.", "Cette liste n'existe plus."))}</p>
      </div>
    );
  }

  const inList = places.value.filter((p) => p.listIds.includes(id));

  const share = async () => {
    setSharing(true);
    try {
      const payload = buildSharePayload(doc.value, id);
      if (!payload) return;
      const url = shareUrl(await encodeShare(payload));
      setLink(url);
      if (navigator.share) {
        try {
          await navigator.share({ title: list.name, url });
          return;
        } catch (err) {
          if ((err as DOMException).name === "AbortError") return;
        }
      }
      await copyText(url);
    } finally {
      setSharing(false);
    }
  };

  const remove = () => {
    deleteList(id);
    if (filterListId.value === id) filterListId.value = null;
    go({ name: "lists" }, { replace: true });
    toast(
      fmt(
        l(
          "“{name}” deleted. Its places stay in your notebook.",
          "« {name} » supprimée. Ses lieux restent dans ton carnet.",
        ),
        { name: list.name },
      ),
    );
  };

  return (
    <div class="stack">
      <ScreenHead title={list.name}>
        <IconButton
          icon="edit"
          label={tr(l("Rename", "Renommer"))}
          onClick={() => setEditing(!editing)}
        />
      </ScreenHead>
      {editing ? (
        <form
          class="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) updateList(id, { name: name.trim(), description: desc.trim() });
            setEditing(false);
          }}
        >
          <label class="field">
            <span class="label">{tr(l("Name", "Nom"))}</span>
            <input class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="label">{tr(l("Description", "Description"))}</span>
            <textarea class="input" value={desc} onInput={(e) => setDesc(e.currentTarget.value)} />
          </label>
          <div class="row">
            <button type="submit" class="btn shell">
              {tr(l("Save", "Enregistrer"))}
            </button>
            <button type="button" class="btn danger" onClick={remove}>
              <Icon name="trash" size={17} />
              {tr(l("Delete the list", "Supprimer la liste"))}
            </button>
          </div>
        </form>
      ) : (
        list.description && (
          <p class="prose muted" style={{ marginTop: "-6px" }}>
            {list.description}
          </p>
        )
      )}
      <div class="actions" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button
          type="button"
          class="btn"
          onClick={() => {
            filterListId.value = id;
            fitPlaces(inList);
            go({ name: "home" });
          }}
          disabled={inList.length === 0}
        >
          <Icon name="map" size={17} />
          {tr(l("Show on map", "Voir sur la carte"))}
        </button>
        <button
          type="button"
          class="btn primary"
          onClick={share}
          disabled={inList.length === 0 || sharing}
        >
          <Icon name="share" size={17} />
          {tr(l("Share", "Partager"))}
        </button>
      </div>
      {link && (
        <div class="notice">
          <p style={{ margin: "0 0 8px" }}>
            {tr(
              l(
                "The link carries the list itself: names, addresses, notes and tags. Whoever opens it can add the list to their own notebook.",
                "Le lien contient la liste elle-même : noms, adresses, notes et tags. Qui l'ouvre peut l'ajouter à son propre carnet.",
              ),
            )}
          </p>
          <button type="button" class="btn" onClick={() => void copyText(link)}>
            <Icon name="copy" size={16} />
            {tr(l("Copy the link", "Copier le lien"))}
          </button>
        </div>
      )}
      {inList.length === 0 ? (
        <p class="muted" style={{ margin: 0 }}>
          {tr(
            l(
              "No place in this list yet. Open a place and add it from its sheet.",
              "Aucun lieu dans cette liste. Ouvre un lieu et ajoute-le depuis sa fiche.",
            ),
          )}
        </p>
      ) : (
        <ul class="rows">
          {inList.map((p) => (
            <li key={p.id}>
              <PlaceRow place={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
