/**
 * The backup kept in a GitHub repository, by hand: set up once with a token
 * that can only write the contents of that repository, then export or import
 * when asked. Mounted in the Backup section of the Import & export screen.
 */
import { useEffect, useState } from "preact/hooks";
import { l, tr } from "../../i18n";
import { GitHubError } from "../../sync/github";
import { REPO_FILE, REPO_TOKEN_URL, repoFileUrl } from "../../sync/repo";
import {
  exportToRepo,
  forgetRepoTarget,
  importFromRepo,
  loadRepoTarget,
  type RepoLink,
  repoTarget,
  repoTargetKept,
  setUpRepo,
} from "../../sync/repoBackup";
import { Icon } from "../../ui/icons";
import { toast } from "../../ui/ui";

type Text = ReturnType<typeof l>;

const ERRORS: Record<string, Text> = {
  auth: l(
    "GitHub refused this token. Check that you copied it whole.",
    "GitHub refuse ce jeton. Vérifie que tu l'as copié en entier.",
  ),
  forbidden: l(
    "This token cannot write to the repository. Give it access to this repository, with Contents set to “Read and write”.",
    "Ce jeton ne peut pas écrire dans le dépôt. Donne-lui accès à ce dépôt, avec Contents sur « Read and write ».",
  ),
  "not-found": l(
    "Not found: check the repository's name, the token's repository access, and that the file exists.",
    "Introuvable : vérifie le nom du dépôt, l'accès du jeton aux dépôts, et que le fichier existe.",
  ),
  "no-push": l(
    "Your account cannot write to this repository. Pick one you own or can push to.",
    "Ton compte ne peut pas écrire dans ce dépôt. Choisis-en un à toi ou où tu peux pousser.",
  ),
  "bad-repo": l(
    "This is not a repository. Write it as owner/repo, or paste its GitHub link.",
    "Ce n'est pas un dépôt. Écris-le sous la forme propriétaire/dépôt, ou colle son lien GitHub.",
  ),
  conflict: l(
    "The file changed on GitHub at the same time. Try again.",
    "Le fichier a changé sur GitHub au même moment. Réessaie.",
  ),
  "not-a-backup": l(
    "This file is not a spots backup. Choose another file name.",
    "Ce fichier n'est pas une sauvegarde spots. Choisis un autre nom de fichier.",
  ),
  "rate-limit": l(
    "GitHub asks to wait a little. Try again later.",
    "GitHub demande d'attendre un peu. Réessaie plus tard.",
  ),
  network: l(
    "No connection. Try again when you are back online.",
    "Pas de connexion. Réessaie au retour du réseau.",
  ),
  server: l(
    "GitHub ran into an error. Try again in a moment.",
    "GitHub a rencontré une erreur. Réessaie dans un instant.",
  ),
};

function errorText(err: unknown): string {
  const code = err instanceof GitHubError ? err.code : "server";
  return tr((ERRORS[code] ?? ERRORS.server) as Text);
}

export function RepoBackup() {
  useEffect(() => {
    void loadRepoTarget();
  }, []);
  const saved = repoTarget.value;
  if (saved === undefined) return null;
  return saved ? <Saved saved={saved} /> : <SetUp />;
}

function SetUp() {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = token.trim() !== "" && repo.trim() !== "";

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { exported } = await setUpRepo(token, repo, file.trim() || undefined);
      toast(
        exported
          ? tr(l("Notebook saved to GitHub", "Carnet enregistré sur GitHub"))
          : tr(
              l(
                "Repository saved. It already holds a backup: import it, or export over it.",
                "Dépôt enregistré. Il contient déjà une sauvegarde : importe-la, ou exporte par-dessus.",
              ),
            ),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="stack" style={{ gap: "10px" }} onSubmit={submit}>
      <p class="small muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Or keep the backup in a GitHub repository of yours: each export is a commit, and the repository's history keeps every version.",
            "Ou garde la sauvegarde dans un de tes dépôts GitHub : chaque export est un commit, et l'historique du dépôt garde toutes les versions.",
          ),
        )}
      </p>
      <ol class="stack small" style={{ margin: 0, paddingLeft: "20px", gap: "8px" }}>
        <li>
          {tr(l("Create a fine-grained token: ", "Crée un jeton fin (fine-grained) : "))}
          <a href={REPO_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {tr(l("open GitHub", "ouvrir GitHub"))}
          </a>
          .
        </li>
        <li>
          {tr(
            l(
              "Under “Repository access”, choose “Only select repositories” and pick your repository.",
              "Dans « Repository access », choisis « Only select repositories » et prends ton dépôt.",
            ),
          )}
        </li>
        <li>
          {tr(
            l(
              "Under “Repository permissions”, set Contents to “Read and write”. Nothing else is needed.",
              "Dans « Repository permissions », mets Contents sur « Read and write ». Rien d'autre n'est nécessaire.",
            ),
          )}
        </li>
        <li>
          {tr(
            l(
              "Generate it, copy it and paste it here with the repository's name.",
              "Génère-le, copie-le et colle-le ici avec le nom du dépôt.",
            ),
          )}
        </li>
      </ol>
      <label class="field">
        <span class="label">{tr(l("Token", "Jeton"))}</span>
        <input
          class="input"
          type="password"
          autoComplete="off"
          spellcheck={false}
          value={token}
          onInput={(e) => setToken(e.currentTarget.value)}
          placeholder="github_pat_…"
        />
      </label>
      <label class="field">
        <span class="label">{tr(l("Repository", "Dépôt"))}</span>
        <input
          class="input"
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          value={repo}
          onInput={(e) => setRepo(e.currentTarget.value)}
          placeholder={tr(l("owner/repo or its link", "propriétaire/dépôt ou son lien"))}
        />
      </label>
      <label class="field">
        <span class="label">{tr(l("File (optional)", "Fichier (facultatif)"))}</span>
        <input
          class="input"
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          value={file}
          onInput={(e) => setFile(e.currentTarget.value)}
          placeholder={REPO_FILE}
        />
      </label>
      <p class="hint" style={{ margin: 0 }}>
        {tr(
          l(
            "The token is stored in this browser only and sent to api.github.com only.",
            "Le jeton est gardé dans ce navigateur seulement et envoyé à api.github.com seulement.",
          ),
        )}
      </p>
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <button type="submit" class="btn" disabled={busy || !ready}>
        <Icon name={busy ? "spinner" : "github"} size={17} {...(busy ? { class: "spin" } : {})} />
        {tr(l("Save to GitHub", "Enregistrer sur GitHub"))}
      </button>
    </form>
  );
}

function Saved({ saved }: { saved: RepoLink }) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: "export" | "import") => {
    setBusy(what);
    setError(null);
    try {
      if (what === "export") {
        await exportToRepo(saved.token, saved);
        toast(tr(l("Notebook saved to GitHub", "Carnet enregistré sur GitHub")));
      } else {
        const n = await importFromRepo(saved.token, saved);
        toast(
          tr(
            n.places === 1
              ? l("Merged 1 place from GitHub", "1 lieu fusionné depuis GitHub")
              : l(
                  `Merged ${n.places} places from GitHub`,
                  `${n.places} lieux fusionnés depuis GitHub`,
                ),
          ),
        );
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="stack" style={{ gap: "10px" }}>
      <div class="notice">
        <strong>{saved.login ? `@${saved.login}` : "GitHub"}</strong>
        <p style={{ margin: "4px 0 0" }}>
          <a href={repoFileUrl(saved)} target="_blank" rel="noopener noreferrer">
            {`${saved.owner}/${saved.repo} · ${saved.path}`}
          </a>
        </p>
      </div>
      {repoTargetKept.value ? null : (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {tr(
            l(
              "This browser's storage for the site is full or blocked: the repository is remembered for this page only.",
              "Le stockage du navigateur pour ce site est plein ou bloqué : le dépôt n'est retenu que pour cette page.",
            ),
          )}
        </p>
      )}
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div class="row">
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => void run("export")}
        >
          <Icon
            name={busy === "export" ? "spinner" : "upload"}
            size={17}
            {...(busy === "export" ? { class: "spin" } : {})}
          />
          {tr(l("Export to GitHub", "Exporter vers GitHub"))}
        </button>
        <button
          type="button"
          class="btn"
          disabled={busy !== null}
          onClick={() => void run("import")}
        >
          <Icon
            name={busy === "import" ? "spinner" : "download"}
            size={17}
            {...(busy === "import" ? { class: "spin" } : {})}
          />
          {tr(l("Import from GitHub", "Importer depuis GitHub"))}
        </button>
      </div>
      <button
        type="button"
        class="btn danger"
        disabled={busy !== null}
        onClick={() => {
          void forgetRepoTarget();
          toast(
            tr(
              l(
                "Repository forgotten on this device. The file stays on GitHub.",
                "Dépôt oublié sur cet appareil. Le fichier reste sur GitHub.",
              ),
            ),
          );
        }}
      >
        {tr(l("Forget this repository", "Oublier ce dépôt"))}
      </button>
    </div>
  );
}
