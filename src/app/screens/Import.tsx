/**
 * Bringing places in: a Google Takeout export (the zip as downloaded, or its
 * "Saved Places.json" and saved list CSV files), a Mapstr export (its CSV and
 * GeoJSON, joined into one batch with tags, stars and dates) or a spots backup.
 * The import itself lives in importJob, so it goes on when this screen is left;
 * this screen shows it, and ImportPill shows it over the other screens.
 */
import { useEffect } from "preact/hooks";
import { fmt, l, plural, tr } from "../../i18n";
import { exportBackup } from "../../import/backup";
import { findExisting } from "../../import/enrich";
import { foldName } from "../../share/share";
import { doc, places, tags } from "../../store/store";
import { Icon } from "../../ui/icons";
import { downloadText, ScreenHead } from "../../ui/ui";
import {
  addFiles,
  type Batch,
  error as importError,
  found as importFound,
  progress as importProgress,
  reading as importReading,
  result as importResult,
  reset,
  resultParts,
  run,
} from "../importJob";
import { requestSnap } from "../Sheet";
import { go, route } from "../state";
import { RepoBackup } from "./RepoBackup";
import { S3Backup } from "./S3Backup";

/** The names of the tags an import would create: those no alive tag already has. */
function newTagNames(batches: Batch[]): string[] {
  const known = new Set(tags.value.map((t) => foldName(t.name)));
  const out = new Map<string, string>();
  for (const b of batches)
    for (const p of b.places)
      for (const t of p.tags ?? []) {
        const key = foldName(t.name);
        if (!known.has(key) && !out.has(key)) out.set(key, t.name);
      }
  return [...out.values()];
}

/** The import's progress, shown over the other screens while it runs; a tap opens it. */
export function ImportPill() {
  const p = importProgress.value;
  if (!p || route.value.name === "import") return null;
  return (
    <div class="import-pill">
      <button type="button" class="toast" onClick={() => go({ name: "import" })}>
        <Icon name="spinner" size={16} class="spin" />
        {fmt(l("Importing… {done} / {total}", "Import… {done} / {total}"), p)}
      </button>
    </div>
  );
}

export function Import() {
  const found = importFound.value;
  const reading = importReading.value;
  const progress = importProgress.value;
  const result = importResult.value;
  const error = importError.value;

  useEffect(() => {
    requestSnap("full");
  }, []);

  const pick = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    void addFiles(files);
  };

  // Places already in the notebook are not looked up again.
  const pending = found
    ? found.batches.reduce(
        (n, b) =>
          n + b.places.filter((p) => p.lat === undefined && !findExisting(places.value, p)).length,
        0,
      )
    : 0;
  const count = found ? found.batches.reduce((n, b) => n + b.places.length, 0) : 0;
  const newTags = found ? newTagNames(found.batches).length : 0;
  const counts = result ? resultParts(result) : [];

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

      <div class="stack" style={{ gap: "10px" }}>
        <div class="label">{tr(l("From Mapstr", "Depuis Mapstr"))}</div>
        <ol class="small muted" style={{ margin: 0, paddingLeft: "20px" }}>
          <li>{tr(l("In Mapstr, export your map.", "Dans Mapstr, exporte ta carte."))}</li>
          <li>
            {tr(
              l(
                "Pick both files it gives, the CSV and the GeoJSON, together or one after the other: the CSV carries your stars and dates, the GeoJSON the positions and tag colours.",
                "Choisis les deux fichiers obtenus, le CSV et le GeoJSON, ensemble ou l'un après l'autre : le CSV porte tes étoiles et les dates, le GeoJSON les positions et les couleurs des tags.",
              ),
            )}
          </li>
        </ol>
      </div>

      <label class="btn shell block" style={{ position: "relative" }}>
        <Icon
          name={reading ? "spinner" : "upload"}
          size={18}
          {...(reading ? { class: "spin" } : {})}
        />
        {found
          ? tr(l("Add files", "Ajouter des fichiers"))
          : tr(l("Choose files", "Choisir des fichiers"))}
        <input
          type="file"
          multiple
          accept=".zip,.json,.geojson,.csv,application/zip,application/json,application/geo+json,text/csv"
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
              {newTags > 0 &&
                ` · ${newTags} ${plural(newTags, l("new tag", "nouveau tag"), l("new tags", "nouveaux tags"))}`}
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
          {found.mapstr && !found.mapstr.csv && (
            <p style={{ margin: 0 }}>
              {tr(
                l(
                  "Mapstr GeoJSON found — add the CSV to bring your stars and dates.",
                  "GeoJSON Mapstr trouvé — ajoute le CSV pour avoir tes étoiles et les dates.",
                ),
              )}
            </p>
          )}
          {found.mapstr && !found.mapstr.geo && (
            <p style={{ margin: 0 }}>
              {tr(
                l(
                  "Mapstr CSV only — places will be looked up by address; add the GeoJSON for exact positions.",
                  "CSV Mapstr seul — les lieux seront cherchés par leur adresse ; ajoute le GeoJSON pour des positions exactes.",
                ),
              )}
            </p>
          )}
          <p class="small" style={{ margin: 0 }}>
            {tr(l("Files:", "Fichiers :"))} {found.files.join(", ")}
          </p>
          {found.skipped.length > 0 && (
            <p class="small" style={{ margin: 0 }}>
              {tr(l("Ignored:", "Ignorés :"))} {found.skipped.slice(0, 4).join(", ")}
              {found.skipped.length > 4 ? "…" : ""}
            </p>
          )}
          <div class="actions" style={{ gridTemplateColumns: "2fr 1fr" }}>
            <button type="button" class="btn primary" onClick={() => void run()}>
              {tr(l("Import", "Importer"))}
            </button>
            <button type="button" class="btn" onClick={reset}>
              {tr(l("Clear", "Effacer"))}
            </button>
          </div>
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
            <strong>{counts[0]}</strong>
            {counts.slice(1).map((c) => ` · ${c}`)}
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
        <RepoBackup />
        <S3Backup />
      </div>
    </div>
  );
}
