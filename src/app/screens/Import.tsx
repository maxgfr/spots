/**
 * Bringing places in: a Google Takeout export (the zip as downloaded, or its
 * "Saved Places.json" and saved list CSV files) or a spots backup. Google's
 * lists rarely carry coordinates, so those places are found by name, one at a
 * time, and the ones that cannot be found are listed rather than guessed.
 */
import { unzipSync } from "fflate";
import { useEffect, useState } from "preact/hooks";
import { search } from "../../geo/geocode";
import { fmt, l, plural, tr } from "../../i18n";
import { exportBackup, parseBackup } from "../../import/backup";
import {
  listNameFromFile,
  parseSavedListCsv,
  parseSavedPlaces,
  type TakeoutPlace,
} from "../../import/takeout";
import { fitPlaces } from "../../map/MapView";
import { distanceMeters, foldName } from "../../share/share";
import type { Doc, PlaceState } from "../../store/model";
import { addList, addPlace, doc, lists, mergeIn, places } from "../../store/store";
import { Icon } from "../../ui/icons";
import { downloadText, ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { go } from "../state";

interface Batch {
  /** The list these places go to, or null for none. */
  list: string | null;
  state: PlaceState;
  places: TakeoutPlace[];
}

interface Found {
  batches: Batch[];
  backup: Doc | null;
  skipped: string[];
}

const FAVOURITE_LISTS = /^(favou?rites?|favoris|starred|lieux favoris|adresses favorites)/i;

function stateForList(name: string): PlaceState {
  return FAVOURITE_LISTS.test(name.trim()) ? "favorite" : "try";
}

async function readFiles(files: File[]): Promise<Found> {
  const out: Found = { batches: [], backup: null, skipped: [] };
  const entries: { name: string; text: string }[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = unzipSync(new Uint8Array(await f.arrayBuffer()), {
        filter: (file) => /\.(json|csv)$/i.test(file.name),
      });
      const dec = new TextDecoder();
      for (const [name, data] of Object.entries(zip))
        entries.push({ name, text: dec.decode(data) });
    } else entries.push({ name: f.name, text: await f.text() });
  }
  for (const e of entries) {
    if (/\.csv$/i.test(e.name)) {
      const list = parseSavedListCsv(e.text);
      if (list.length > 0) {
        const name = listNameFromFile(e.name);
        out.batches.push({ list: name, state: stateForList(name), places: list });
      } else out.skipped.push(e.name);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(e.text);
    } catch {
      out.skipped.push(e.name);
      continue;
    }
    const backup = parseBackup(e.text);
    if (backup && Object.keys(backup.places).length + Object.keys(backup.lists).length > 0) {
      out.backup = backup;
      continue;
    }
    const saved = parseSavedPlaces(json);
    if (saved.length > 0) {
      // Saved Places.json holds the starred places.
      out.batches.push({ list: null, state: "favorite", places: saved });
    } else out.skipped.push(e.name);
  }
  return out;
}

export function Import() {
  const [found, setFound] = useState<Found | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    added: number;
    existing: number;
    missing: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestSnap("full");
  }, []);

  const pick = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    setReading(true);
    setError(null);
    setResult(null);
    try {
      const f = await readFiles(files);
      if (f.batches.length === 0 && !f.backup) {
        setError(
          tr(
            l(
              "No places found in these files. Pick the Takeout zip, “Saved Places.json”, the CSV files of your saved lists, or a spots backup.",
              "Aucun lieu trouvé dans ces fichiers. Choisis le zip Takeout, « Saved Places.json », les fichiers CSV de tes listes enregistrées, ou une sauvegarde spots.",
            ),
          ),
        );
        setFound(null);
      } else setFound(f);
    } catch {
      setError(tr(l("These files could not be read.", "Impossible de lire ces fichiers.")));
    } finally {
      setReading(false);
    }
  };

  const run = async () => {
    if (!found) return;
    if (found.backup) {
      mergeIn(found.backup);
      toast(tr(l("Backup merged into your notebook", "Sauvegarde fusionnée dans ton carnet")));
    }
    const total = found.batches.reduce((n, b) => n + b.places.length, 0);
    let done = 0;
    let added = 0;
    let existing = 0;
    const missing: string[] = [];
    const listIds = new Map<string, string>();
    const addedPlaces = [];
    setProgress({ done, total });
    for (const batch of found.batches) {
      let listId: string | null = null;
      if (batch.list) {
        const same = lists.value.find((x) => foldName(x.name) === foldName(batch.list ?? ""));
        listId = listIds.get(batch.list) ?? same?.id ?? addList({ name: batch.list }).id;
        listIds.set(batch.list, listId);
      }
      for (const t of batch.places) {
        let lat = t.lat;
        let lng = t.lng;
        let address = t.address;
        if (lat === undefined || lng === undefined) {
          try {
            const [hit] = await search([t.name, t.address].filter(Boolean).join(" "), { limit: 1 });
            if (hit) {
              lat = hit.lat;
              lng = hit.lng;
              address ||= hit.address;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 350));
        }
        done++;
        setProgress({ done, total });
        if (lat === undefined || lng === undefined) {
          missing.push(t.name);
          continue;
        }
        const name = foldName(t.name);
        const dupe = places.value.find(
          (p) => foldName(p.name) === name && distanceMeters(p.lat, p.lng, lat, lng) < 50,
        );
        if (dupe) {
          existing++;
          continue;
        }
        addedPlaces.push(
          addPlace({
            name: t.name,
            address,
            lat,
            lng,
            note: t.note,
            tagIds: [],
            listIds: listId ? [listId] : [],
            state: batch.state,
            ...(t.url && /^https?:\/\//.test(t.url) ? { url: t.url } : {}),
            source: "google",
          }),
        );
        added++;
      }
    }
    setProgress(null);
    setFound(null);
    setResult({ added, existing, missing });
    if (addedPlaces.length > 0) fitPlaces(addedPlaces);
  };

  const pending = found
    ? found.batches.reduce((n, b) => n + b.places.filter((p) => p.lat === undefined).length, 0)
    : 0;
  const count = found ? found.batches.reduce((n, b) => n + b.places.length, 0) : 0;

  return (
    <div class="stack">
      <ScreenHead title={tr(l("Import & export", "Import et export"))} />

      <div class="stack" style={{ gap: "10px" }}>
        <div class="label">{tr(l("From Google Maps", "Depuis Google Maps"))}</div>
        <ol class="small muted" style={{ margin: 0, paddingLeft: "20px" }}>
          <li>
            {tr(l("On ", "Sur "))}
            <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer">
              takeout.google.com
            </a>
            {tr(
              l(
                ", keep only “Maps (your places)” and “Saved”, and export.",
                ", ne garde que « Maps (vos adresses) » et « Enregistré », puis exporte.",
              ),
            )}
          </li>
          <li>{tr(l("Pick the zip you receive, as it is.", "Choisis le zip reçu, tel quel."))}</li>
        </ol>
      </div>

      <label class="btn shell block" style={{ position: "relative" }}>
        <Icon
          name={reading ? "spinner" : "upload"}
          size={18}
          {...(reading ? { class: "spin" } : {})}
        />
        {tr(l("Choose files", "Choisir des fichiers"))}
        <input
          type="file"
          multiple
          accept=".zip,.json,.csv,application/zip,application/json,text/csv"
          class="sr-only"
          onChange={pick}
          disabled={reading || progress !== null}
        />
      </label>
      <p class="hint" style={{ margin: "-6px 0 0" }}>
        {tr(
          l(
            "The files are read in this browser. Places without coordinates are looked up by name on photon.komoot.io.",
            "Les fichiers sont lus dans ce navigateur. Les lieux sans coordonnées sont cherchés par leur nom sur photon.komoot.io.",
          ),
        )}
      </p>

      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {found && !progress && (
        <div class="notice stack" style={{ gap: "10px" }}>
          {count > 0 && (
            <p style={{ margin: 0 }}>
              <strong>
                {count} {plural(count, l("place", "lieu"), l("places", "lieux"))}
              </strong>
              {found.batches.some((b) => b.list) &&
                ` · ${found.batches.filter((b) => b.list).length} ${plural(found.batches.filter((b) => b.list).length, l("list", "liste"), l("lists", "listes"))}`}
              {pending > 0 &&
                ` · ${fmt(l("{n} to look up by name (about {s} s)", "{n} à chercher par leur nom (environ {s} s)"), { n: pending, s: Math.ceil(pending * 0.6) })}`}
            </p>
          )}
          {found.backup && (
            <p style={{ margin: 0 }}>
              {tr(
                l(
                  "A spots backup, merged with your notebook (the newer edit of each place wins).",
                  "Une sauvegarde spots, fusionnée avec ton carnet (la modification la plus récente de chaque lieu l'emporte).",
                ),
              )}
            </p>
          )}
          {found.skipped.length > 0 && (
            <p class="small" style={{ margin: 0 }}>
              {tr(l("Ignored:", "Ignorés :"))} {found.skipped.slice(0, 4).join(", ")}
              {found.skipped.length > 4 ? "…" : ""}
            </p>
          )}
          <button type="button" class="btn primary" onClick={() => void run()}>
            {tr(l("Import", "Importer"))}
          </button>
        </div>
      )}

      {progress && (
        <div class="stack" style={{ gap: "8px" }} role="status">
          <div class="progress">
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <span class="small muted">
            {progress.done} / {progress.total}
          </span>
        </div>
      )}

      {result && (
        <div class="notice stack" style={{ gap: "8px" }} role="status">
          <p style={{ margin: 0 }}>
            <strong>
              {result.added}{" "}
              {plural(
                result.added,
                l("place added", "lieu ajouté"),
                l("places added", "lieux ajoutés"),
              )}
            </strong>
            {result.existing > 0 &&
              ` · ${result.existing} ${plural(result.existing, l("already there", "déjà présent"), l("already there", "déjà présents"))}`}
          </p>
          {result.missing.length > 0 && (
            <details>
              <summary>
                {fmt(l("{n} not found on the map", "{n} introuvables sur la carte"), {
                  n: result.missing.length,
                })}
              </summary>
              <p class="small" style={{ margin: "6px 0 0" }}>
                {result.missing.join(" · ")}
              </p>
            </details>
          )}
          <button type="button" class="btn" onClick={() => go({ name: "home" })}>
            {tr(l("See them on the map", "Les voir sur la carte"))}
          </button>
        </div>
      )}

      <div class="section stack" style={{ gap: "10px" }}>
        <div class="label">{tr(l("Backup", "Sauvegarde"))}</div>
        <p class="small muted" style={{ margin: 0 }}>
          {tr(
            l(
              "Everything in one JSON file: places, tags, lists. Import it here on any device to merge it back.",
              "Tout dans un fichier JSON : lieux, tags, listes. Importe-le ici sur n'importe quel appareil pour le fusionner.",
            ),
          )}
        </p>
        <button
          type="button"
          class="btn"
          onClick={() => {
            const day = new Date().toISOString().slice(0, 10);
            downloadText(`spots-${day}.json`, exportBackup(doc.value, Date.now()));
          }}
        >
          <Icon name="download" size={17} />
          {tr(l("Download a backup", "Télécharger une sauvegarde"))}
        </button>
      </div>
    </div>
  );
}
