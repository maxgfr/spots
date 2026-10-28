/**
 * Pinning a new place (from the draft) or editing one: name, address, note,
 * tags, lists, state and link. New tags and lists can be made on the spot.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { search } from "../../geo/geocode";
import { l, tr } from "../../i18n";
import { showPoint } from "../../map/MapView";
import { type PlaceState, TAG_COLORS } from "../../store/model";
import {
  addList,
  addPlace,
  addTag,
  deletePlace,
  doc,
  lists,
  restorePlace,
  tags,
  updatePlace,
} from "../../store/store";
import { INKS } from "../../ui/colors";
import { Icon, TagGlyph } from "../../ui/icons";
import { inkStyle, ScreenHead, StateToggles, tagInk, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { back, type Draft, draft, go } from "../state";

interface Form extends Draft {
  state: PlaceState;
}

export function NewPlace() {
  const d = draft.value;
  if (!d) {
    return (
      <div class="stack">
        <ScreenHead title={tr(l("New place", "Nouveau lieu"))} />
        <p class="muted">
          {tr(
            l(
              "Search a place above, or press and hold the map where it is.",
              "Cherche un lieu en haut, ou appuie longuement sur la carte à son emplacement.",
            ),
          )}
        </p>
      </div>
    );
  }
  return <PlaceForm initial={{ ...d, state: "try" }} />;
}

export function EditPlace({ id }: { id: string }) {
  const p = doc.value.places[id];
  if (!p)
    return <p class="muted">{tr(l("This place no longer exists.", "Ce lieu n'existe plus."))}</p>;
  return (
    <PlaceForm
      id={id}
      initial={{
        name: p.name,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        note: p.note,
        tagIds: p.tagIds,
        listIds: p.listIds,
        ...(p.url ? { url: p.url } : {}),
        source: p.source ?? "map",
        state: p.state,
      }}
    />
  );
}

function PlaceForm({ id, initial }: { id?: string; initial: Form }) {
  const [f, setF] = useState<Form>(initial);
  const [newTag, setNewTag] = useState<string | null>(null);
  const [newList, setNewList] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = id === undefined;

  useEffect(() => {
    requestSnap("full");
  }, []);

  // The draft keeps moving while this form is open: a dragged pin, an address found late.
  const live = draft.value;
  useEffect(() => {
    if (!isNew || !live) return;
    setF((cur) => ({
      ...cur,
      lat: live.lat,
      lng: live.lng,
      name: cur.name || live.name,
      address: cur.address || live.address,
      resolving: live.resolving ?? false,
    }));
  }, [live?.lat, live?.lng, live?.name, live?.address, live?.resolving]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }));
  const toggle = (k: "tagIds" | "listIds", value: string) =>
    setF((cur) => ({
      ...cur,
      [k]: cur[k].includes(value) ? cur[k].filter((x) => x !== value) : [...cur[k], value],
    }));

  const save = (e: Event) => {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) {
      setError(tr(l("Give the place a name.", "Donne un nom au lieu.")));
      return;
    }
    const url = f.url?.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setError(tr(l("The link must start with https://", "Le lien doit commencer par https://")));
      return;
    }
    const fields = {
      name,
      address: f.address.trim(),
      lat: f.lat,
      lng: f.lng,
      note: f.note.trim(),
      tagIds: f.tagIds,
      listIds: f.listIds,
      state: f.state,
      ...(url ? { url } : {}),
    };
    if (isNew) {
      const p = addPlace({ ...fields, source: f.source });
      draft.value = null;
      go({ name: "place", id: p.id }, { replace: true });
      toast(tr(l("Pinned", "Épinglé")));
    } else {
      updatePlace(id, { ...fields, url: url || undefined });
      back({ name: "place", id });
    }
  };

  const remove = () => {
    if (!id) return;
    const gone = deletePlace(id);
    go({ name: "home" }, { replace: true });
    if (gone)
      toast(tr(l("Place deleted", "Lieu supprimé")), {
        label: tr(l("Undo", "Annuler")),
        run: () => restorePlace(gone),
      });
  };

  const findAddress = async () => {
    const q = [f.name, f.address].filter(Boolean).join(" ");
    if (!q.trim()) return;
    setLocating(true);
    setError(null);
    try {
      const [hit] = await search(q, { near: [f.lng, f.lat], zoom: 13, limit: 1 });
      if (hit) {
        setF((cur) => ({
          ...cur,
          lat: hit.lat,
          lng: hit.lng,
          address: cur.address || hit.address,
        }));
        if (isNew && draft.value) draft.value = { ...draft.value, lat: hit.lat, lng: hit.lng };
        showPoint(hit.lng, hit.lat, 16);
      } else
        setError(tr(l("No match for this address.", "Aucune correspondance pour cette adresse.")));
    } catch {
      setError(
        tr(l("The search service did not answer.", "Le service de recherche n'a pas répondu.")),
      );
    } finally {
      setLocating(false);
    }
  };

  const createTag = () => {
    const name = newTag?.trim();
    if (!name) return setNewTag(null);
    const used = new Set(tags.value.map((t) => t.color));
    const color = TAG_COLORS.find((c) => !used.has(c)) ?? "ink";
    const t = addTag({ name, color, icon: "pin" });
    setF((cur) => ({ ...cur, tagIds: [...cur.tagIds, t.id] }));
    setNewTag(null);
  };

  const createList = () => {
    const name = newList?.trim();
    if (!name) return setNewList(null);
    const x = addList({ name });
    setF((cur) => ({ ...cur, listIds: [...cur.listIds, x.id] }));
    setNewList(null);
  };

  return (
    <form class="stack" onSubmit={save} noValidate>
      <ScreenHead
        title={isNew ? tr(l("New place", "Nouveau lieu")) : tr(l("Edit", "Modifier"))}
        onBack={() => {
          if (isNew) draft.value = null;
          back(id ? { name: "place", id } : { name: "home" });
        }}
      />
      {isNew && (
        <p class="hint" style={{ margin: "-8px 0 0" }}>
          {f.resolving
            ? tr(l("Looking up this spot…", "Recherche de l'adresse…"))
            : tr(
                l(
                  "Drag the red pin to adjust the spot.",
                  "Glisse le pin rouge pour ajuster l'emplacement.",
                ),
              )}
        </p>
      )}
      <label class="field">
        <span class="label">{tr(l("Name", "Nom"))}</span>
        <input
          class="input"
          value={f.name}
          onInput={(e) => set("name", e.currentTarget.value)}
          placeholder={tr(l("Le Petit Cambodge", "Le Petit Cambodge"))}
          autoComplete="off"
          required
        />
      </label>
      <label class="field">
        <span class="label">{tr(l("Address", "Adresse"))}</span>
        <div class="row" style={{ flexWrap: "nowrap" }}>
          <input
            class="input"
            value={f.address}
            onInput={(e) => set("address", e.currentTarget.value)}
            autoComplete="off"
          />
          <button
            type="button"
            class="btn"
            onClick={findAddress}
            disabled={locating}
            title={tr(l("Move the pin to this address", "Placer le pin à cette adresse"))}
          >
            <Icon
              name={locating ? "spinner" : "locate"}
              size={17}
              {...(locating ? { class: "spin" } : {})}
            />
            <span class="sr-only">
              {tr(l("Move the pin to this address", "Placer le pin à cette adresse"))}
            </span>
          </button>
        </div>
      </label>

      <div class="field">
        <span class="label">{tr(l("Tags", "Tags"))}</span>
        <div class="chips">
          {tags.value.map((t) => (
            <button
              key={t.id}
              type="button"
              class="chip"
              aria-pressed={f.tagIds.includes(t.id)}
              style={inkStyle(INKS[t.color])}
              onClick={() => toggle("tagIds", t.id)}
            >
              <TagGlyph icon={t.icon} size={15} />
              {t.name}
            </button>
          ))}
          {newTag === null ? (
            <button type="button" class="chip" onClick={() => setNewTag("")}>
              <Icon name="plus" size={15} />
              {tr(l("New tag", "Nouveau tag"))}
            </button>
          ) : (
            <InlineAdd
              value={newTag}
              onInput={setNewTag}
              onDone={createTag}
              onCancel={() => setNewTag(null)}
              label={tr(l("Tag name", "Nom du tag"))}
            />
          )}
        </div>
      </div>

      <div class="field">
        <span class="label">{tr(l("Lists", "Listes"))}</span>
        <div class="chips">
          {lists.value.map((x) => (
            <button
              key={x.id}
              type="button"
              class="chip"
              aria-pressed={f.listIds.includes(x.id)}
              onClick={() => toggle("listIds", x.id)}
            >
              {x.name}
            </button>
          ))}
          {newList === null ? (
            <button type="button" class="chip" onClick={() => setNewList("")}>
              <Icon name="plus" size={15} />
              {tr(l("New list", "Nouvelle liste"))}
            </button>
          ) : (
            <InlineAdd
              value={newList}
              onInput={setNewList}
              onDone={createList}
              onCancel={() => setNewList(null)}
              label={tr(l("List name", "Nom de la liste"))}
            />
          )}
        </div>
      </div>

      <div class="field">
        <span class="label">{tr(l("State", "État"))}</span>
        <StateToggles
          value={f.state}
          ink={tagInk(tags.value.find((t) => f.tagIds.includes(t.id)))}
          onChange={(v) => set("state", v)}
        />
      </div>

      <label class="field">
        <span class="label">{tr(l("Note", "Note"))}</span>
        <textarea
          class="input"
          value={f.note}
          onInput={(e) => set("note", e.currentTarget.value)}
          placeholder={tr(
            l(
              "Who told you, what to order, when to go…",
              "Qui te l'a conseillé, quoi commander, quand y aller…",
            ),
          )}
        />
      </label>
      <label class="field">
        <span class="label">{tr(l("Link", "Lien"))}</span>
        <input
          class="input"
          type="url"
          inputMode="url"
          value={f.url ?? ""}
          onInput={(e) => set("url", e.currentTarget.value)}
          placeholder="https://"
        />
      </label>

      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" class="btn primary block">
        <Icon name="check" size={18} />
        {isNew ? tr(l("Pin it", "Épingler")) : tr(l("Save", "Enregistrer"))}
      </button>
      {!isNew && (
        <button type="button" class="btn danger block" onClick={remove}>
          <Icon name="trash" size={18} />
          {tr(l("Delete this place", "Supprimer ce lieu"))}
        </button>
      )}
    </form>
  );
}

function InlineAdd({
  value,
  onInput,
  onDone,
  onCancel,
  label,
}: {
  value: string;
  onInput: (v: string) => void;
  onDone: () => void;
  onCancel: () => void;
  label: string;
}) {
  // Enter finishes, and the blur that follows when the field goes away must not finish twice.
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };
  return (
    <span class="row" style={{ flexWrap: "nowrap" }}>
      <input
        class="input"
        style={{ minHeight: "36px", padding: "6px 12px", width: "170px" }}
        value={value}
        aria-label={label}
        placeholder={label}
        // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked for it.
        autoFocus
        onInput={(e) => onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish();
          }
          if (e.key === "Escape") {
            finished.current = true;
            onCancel();
          }
        }}
        onBlur={finish}
      />
    </span>
  );
}
