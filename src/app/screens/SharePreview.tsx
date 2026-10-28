/**
 * A list someone shared: read from the link itself, shown on the map as plain
 * rings until the visitor adds it to their own notebook.
 */
import { Marker } from "maplibre-gl";
import { useEffect, useState } from "preact/hooks";
import { fmt, l, plural, tr } from "../../i18n";
import { fitPlaces, mapRef } from "../../map/MapView";
import { decodeShare, importShare, type SharePayload } from "../../share/share";
import type { Place } from "../../store/model";
import { doc, replaceDoc } from "../../store/store";
import { INKS, UNTAGGED } from "../../ui/colors";
import { Icon, TagGlyph } from "../../ui/icons";
import { inkStyle, ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { go } from "../state";

export function SharePreview({ data }: { data: string }) {
  const [payload, setPayload] = useState<SharePayload | null | undefined>(undefined);

  useEffect(() => {
    requestSnap("half");
    let live = true;
    decodeShare(data).then((p) => {
      if (live) setPayload(p);
    });
    return () => {
      live = false;
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.value;
    if (!map || !payload) return;
    const markers = payload.places.map((p) => {
      const el = document.createElement("div");
      el.className = "preview-pin";
      el.title = p.name;
      return new Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    });
    fitPlaces(payload.places as unknown as Place[]);
    return () => {
      for (const m of markers) m.remove();
    };
  }, [payload, mapRef.value]);

  if (payload === undefined)
    return <p class="muted">{tr(l("Opening the list…", "Ouverture de la liste…"))}</p>;
  if (payload === null) {
    return (
      <div class="stack">
        <ScreenHead
          title={tr(l("Shared list", "Liste partagée"))}
          onBack={() => go({ name: "home" }, { replace: true })}
        />
        <p class="muted" style={{ margin: 0 }}>
          {tr(
            l(
              "This link is incomplete or damaged. Ask for it again, and check that it was copied whole.",
              "Ce lien est incomplet ou abîmé. Redemande-le, et vérifie qu'il a été copié en entier.",
            ),
          )}
        </p>
      </div>
    );
  }

  const add = () => {
    const res = importShare(doc.value, payload, Date.now());
    replaceDoc(res.doc);
    go({ name: "list", id: res.listId }, { replace: true });
    toast(
      fmt(l("“{name}” added: {n} new places", "« {name} » ajoutée : {n} nouveaux lieux"), {
        name: payload.list.name,
        n: res.added,
      }),
    );
  };

  const n = payload.places.length;
  return (
    <div class="stack">
      <ScreenHead
        title={payload.list.name}
        onBack={() => go({ name: "home" }, { replace: true })}
      />
      <p class="meta" style={{ margin: "-6px 0 0" }}>
        {tr(l("Shared list", "Liste partagée"))} · {n}{" "}
        {plural(n, l("place", "lieu"), l("places", "lieux"))}
      </p>
      {payload.list.description && <p class="prose">{payload.list.description}</p>}
      <button type="button" class="btn primary block" onClick={add}>
        <Icon name="plus" size={18} />
        {tr(l("Add to my notebook", "Ajouter à mon carnet"))}
      </button>
      <ul class="rows">
        {payload.places.map((p) => {
          const t = p.tags[0] !== undefined ? payload.tags[p.tags[0]] : undefined;
          return (
            <li key={`${p.name}-${p.lat}-${p.lng}`} class="place-row" style={{ cursor: "default" }}>
              <span class="mini" style={inkStyle(t ? INKS[t.color] : UNTAGGED)} aria-hidden="true">
                <TagGlyph icon={t?.icon || "pin"} size={17} />
              </span>
              <span class="row-text">
                <span class="row-name">{p.name}</span>
                <span class="row-meta">{[t?.name, p.address].filter(Boolean).join(" · ")}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
