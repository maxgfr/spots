/**
 * The menu: sync, import and export, the AI, the offline map, language and
 * theme, and what leaves the device.
 */
import { useEffect, useState } from "preact/hooks";
import { aiLabel } from "../../ai/settings";
import { LANGS, type Lang, l, lang, setLang, tr } from "../../i18n";
import { mapRef } from "../../map/MapView";
import { keepArea, MAX_TILES } from "../../offline/keep";
import { places, storageError } from "../../store/store";
import { Icon, type IconName } from "../../ui/icons";
import { ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { go, type Route, type Theme, theme } from "../state";
import { syncLabel } from "./Sync";

function Item({ icon, title, sub, to }: { icon: IconName; title: string; sub: string; to: Route }) {
  return (
    <li>
      <button type="button" class="menu-item" onClick={() => go(to)}>
        <Icon name={icon} />
        <span class="menu-text">
          <strong>{title}</strong>
          <span>{sub}</span>
        </span>
        <Icon name="next" />
      </button>
    </li>
  );
}

export function Menu() {
  const [keeping, setKeeping] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    requestSnap("full");
  }, []);

  const keep = async () => {
    const map = mapRef.value;
    if (!map) return;
    setKeeping({ done: 0, total: 0 });
    const res = await keepArea(map, (done, total) => setKeeping({ done, total }));
    setKeeping(null);
    if (res.ok) {
      toast(
        res.failed > 0
          ? tr(
              l(
                "Area kept, with a few tiles missing",
                "Zone gardée, avec quelques tuiles manquantes",
              ),
            )
          : tr(l("This area works offline now", "Cette zone fonctionne hors ligne")),
      );
    } else if (res.reason === "too-big") {
      toast(
        tr(
          l(
            `This area is too large: zoom in to a city or less (at most ${MAX_TILES} tiles).`,
            `Cette zone est trop grande : zoome sur une ville ou moins (${MAX_TILES} tuiles au plus).`,
          ),
        ),
      );
    } else {
      toast(
        tr(
          l(
            "Offline maps need the installed app: reload the page once, then try again.",
            "La carte hors ligne a besoin de l'app installée : recharge la page une fois, puis réessaie.",
          ),
        ),
      );
    }
  };

  const themes: { id: Theme; label: ReturnType<typeof l> }[] = [
    { id: "system", label: l("Auto", "Auto") },
    { id: "light", label: l("Light", "Clair") },
    { id: "dark", label: l("Dark", "Sombre") },
  ];

  return (
    <div class="stack">
      <ScreenHead title={tr(l("Menu", "Menu"))} noBack />
      {storageError.value && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {tr(
            l(
              "This browser refused to save your notebook (storage full or disabled). Download a backup now.",
              "Ce navigateur refuse d'enregistrer ton carnet (stockage plein ou désactivé). Télécharge une sauvegarde maintenant.",
            ),
          )}
        </p>
      )}
      <ul class="menu-list">
        <Item
          icon="github"
          title={tr(l("GitHub sync", "Sync GitHub"))}
          sub={syncLabel()}
          to={{ name: "sync" }}
        />
        <Item
          icon="upload"
          title={tr(l("Import & export", "Import et export"))}
          sub={tr(l("Google Maps, JSON backup", "Google Maps, sauvegarde JSON"))}
          to={{ name: "import" }}
        />
        <Item
          icon="sparkles"
          title={tr(l("AI", "IA"))}
          sub={aiLabel()}
          to={{ name: "ai-settings" }}
        />
        <Item
          icon="list"
          title={tr(l("Lists", "Listes"))}
          sub={tr(l("Group and share places", "Regrouper et partager des lieux"))}
          to={{ name: "lists" }}
        />
        <Item
          icon="tag"
          title={tr(l("Tags", "Tags"))}
          sub={tr(l("Names, inks and glyphs", "Noms, encres et pictos"))}
          to={{ name: "tags" }}
        />
        <li>
          <button
            type="button"
            class="menu-item"
            onClick={() => void keep()}
            disabled={keeping !== null}
          >
            <Icon name="keep" />
            <span class="menu-text">
              <strong>{tr(l("Keep this area offline", "Garder cette zone hors ligne"))}</strong>
              <span>
                {keeping
                  ? `${keeping.done} / ${keeping.total || "…"}`
                  : tr(
                      l(
                        "The map you see now, down to street level",
                        "La carte visible, jusqu'au niveau des rues",
                      ),
                    )}
              </span>
            </span>
          </button>
        </li>
      </ul>

      <div class="field">
        <span class="label">{tr(l("Language", "Langue"))}</span>
        <fieldset class="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {LANGS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={lang.value === x.id}
              onClick={() => setLang(x.id as Lang)}
            >
              {x.name}
            </button>
          ))}
        </fieldset>
      </div>
      <div class="field">
        <span class="label">{tr(l("Theme", "Thème"))}</span>
        <fieldset class="segmented">
          {themes.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={theme.value === x.id}
              onClick={() => {
                theme.value = x.id;
              }}
            >
              {tr(x.label)}
            </button>
          ))}
        </fieldset>
      </div>

      <div class="section stack small" style={{ gap: "8px" }}>
        <div class="label">{tr(l("What leaves this device", "Ce qui sort de cet appareil"))}</div>
        <p class="muted" style={{ margin: 0 }}>
          {tr(
            l(
              `Your ${places.value.length} places live in this browser. The map loads its tiles from OpenFreeMap; searches go to Photon (komoot) and Nominatim (OpenStreetMap). Only if you turn them on: your notebook goes to your own GitHub gist, and what you send to the AI goes to the provider you chose.`,
              `Tes ${places.value.length} lieux vivent dans ce navigateur. La carte charge ses tuiles depuis OpenFreeMap ; les recherches vont à Photon (komoot) et Nominatim (OpenStreetMap). Seulement si tu les actives : ton carnet va dans ton propre gist GitHub, et ce que tu envoies à l'IA va au fournisseur choisi.`,
            ),
          )}
        </p>
        <p class="muted" style={{ margin: 0 }}>
          {tr(l("Map data", "Données"))} ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenStreetMap
          </a>{" "}
          ·{" "}
          <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
            OpenFreeMap
          </a>{" "}
          · © OpenMapTiles ·{" "}
          <a href="https://github.com/maxgfr/spots" target="_blank" rel="noopener noreferrer">
            {tr(l("Source code", "Code source"))}
          </a>
        </p>
      </div>
    </div>
  );
}
