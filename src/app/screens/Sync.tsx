/**
 * Connecting GitHub: the notebook is kept in one file of a private repository
 * of the user's (with a token that can only write that repository's contents),
 * or in a secret gist (with a token that can only touch gists). A phone joins
 * by scanning a QR code shown here instead of pasting the token; the QR code
 * hands over the GitHub backup repository too, when one is set. A device not
 * linked yet can scan that QR code from here, or paste its link.
 */
import { useEffect, useState } from "preact/hooks";
import { fmt, l, locale, tr } from "../../i18n";
import { gistUrl, TOKEN_URL } from "../../sync/gist";
import { GitHubError } from "../../sync/github";
import { createPairing, formatCode, PAIR_TTL_MS, type PairAccess } from "../../sync/pair";
import { REPO_TOKEN_URL, repoFileUrl } from "../../sync/repo";
import { loadRepoTarget } from "../../sync/repoBackup";
import {
  connect,
  connectRepo,
  disconnect,
  type Link,
  link,
  linkKept,
  pairAccess,
  syncNow,
  syncStatus,
} from "../../sync/sync";
import { Icon } from "../../ui/icons";
import { copyText, ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { LinkFromDevice } from "./LinkFromDevice";

type Text = ReturnType<typeof l>;
type Backend = Link["kind"];

/** The page that creates the private repository the sync recommends. */
const NEW_REPO_URL = "https://github.com/new?name=spots-data&visibility=private";

/** What each error code means to the user; `REPO_ERRORS` says it for a repository instead. */
export const ERRORS: Record<string, Text> = {
  auth: l(
    "GitHub refused this token. Check that you copied it whole.",
    "GitHub refuse ce jeton. Vérifie que tu l'as copié en entier.",
  ),
  forbidden: l(
    "This token cannot use gists. Give it the account permission “Gists: read and write”.",
    "Ce jeton ne peut pas utiliser les gists. Donne-lui la permission de compte « Gists : lecture et écriture ».",
  ),
  "not-found": l(
    "The gist was not found. Disconnect and connect again.",
    "Le gist est introuvable. Déconnecte puis reconnecte.",
  ),
  "rate-limit": l(
    "GitHub asks to wait a little. Sync will try again later.",
    "GitHub demande d'attendre un peu. La sync réessaiera plus tard.",
  ),
  network: l(
    "No connection. Sync will resume when you are back online.",
    "Pas de connexion. La sync reprendra au retour du réseau.",
  ),
  server: l(
    "GitHub ran into an error. Try again in a moment.",
    "GitHub a rencontré une erreur. Réessaie dans un instant.",
  ),
  "public-repo": l(
    "This repository is public: anyone could read your places. Make it private on GitHub, or choose a private one.",
    "Ce dépôt est public : n'importe qui pourrait lire tes lieux. Rends-le privé sur GitHub, ou choisis-en un privé.",
  ),
  "no-push": l(
    "Your account cannot write to this repository. Pick one you own or can push to.",
    "Ton compte ne peut pas écrire dans ce dépôt. Choisis-en un à toi ou où tu peux pousser.",
  ),
  "bad-repo": l(
    "This is not a repository. Write it as owner/repo, or paste its GitHub link.",
    "Ce n'est pas un dépôt. Écris-le sous la forme propriétaire/dépôt, ou colle son lien GitHub.",
  ),
  "not-a-backup": l(
    "The file spots.json in this repository is not a spots notebook, so sync leaves it alone. Rename it, or choose another repository.",
    "Le fichier spots.json de ce dépôt n'est pas un carnet spots, la sync n'y touche donc pas. Renomme-le, ou choisis un autre dépôt.",
  ),
  conflict: l(
    "The file kept changing on GitHub during the sync. Press Sync now to try again.",
    "Le fichier n'a cessé de changer sur GitHub pendant la sync. Appuie sur Synchroniser pour réessayer.",
  ),
};

const REPO_ERRORS: Record<string, Text> = {
  forbidden: l(
    "This token cannot write to the repository. Give it access to this repository, with Contents set to “Read and write”.",
    "Ce jeton ne peut pas écrire dans le dépôt. Donne-lui accès à ce dépôt, avec Contents sur « Read and write ».",
  ),
  "not-found": l(
    "The repository was not found: check its name, and that the token has access to it.",
    "Le dépôt est introuvable : vérifie son nom, et que le jeton y a accès.",
  ),
};

/** The message for an error code, as it applies to `backend`. */
export function errorText(code: string, backend: Backend): string {
  const text = (backend === "repo" ? REPO_ERRORS[code] : undefined) ?? ERRORS[code];
  return tr(text ?? (ERRORS.server as Text));
}

function errorOf(err: unknown, backend: Backend): string {
  return errorText(err instanceof GitHubError ? err.code : "server", backend);
}

export function syncLabel(): string {
  const s = syncStatus.value;
  if (s.state === "off")
    return tr(l("Not synced: only on this device", "Non synchronisé : seulement sur cet appareil"));
  if (s.state === "syncing") return tr(l("Syncing…", "Synchronisation…"));
  if (s.state === "error") return errorText(s.code, link.value?.kind ?? "gist");
  if (!s.at) return tr(l("Synced with GitHub", "Synchronisé avec GitHub"));
  const time = new Date(s.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return `${tr(l("Synced at", "Synchronisé à"))} ${time}`;
}

/** A QR code as inline SVG, dark modules on white, the quiet zone included in `modules`. */
function Qr({ modules, url }: { modules: boolean[][]; url: string }) {
  const n = modules.length;
  // At least three pixels a module, so a dense code (a backup handed over too) still scans.
  const px = Math.max(240, n * 3);
  let d = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      if (!row[x]) continue;
      let w = 1;
      while (row[x + w]) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w;
    }
  });
  return (
    <svg
      class="qr"
      viewBox={`0 0 ${n} ${n}`}
      width={px}
      height={px}
      style={{ width: `${px}px` }}
      role="img"
      aria-label={tr(l("QR code to link a phone", "QR code pour connecter un téléphone"))}
      data-url={url}
      shape-rendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

interface Shown {
  url: string;
  code: string;
  modules: boolean[][];
  /** The pairing hands over the GitHub backup repository too. */
  backup: boolean;
}

/** The QR code and pairing code a phone needs to join the sync, made afresh each time. */
function LinkPhone({ access }: { access: PairAccess }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [opening, setOpening] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setExpired(true), PAIR_TTL_MS);
    return () => clearTimeout(t);
  }, [shown]);

  const show = async () => {
    setOpening(true);
    try {
      // The backup repository, when one is set, goes along with the sync.
      const saved = await loadRepoTarget();
      const backup = saved && {
        token: saved.token,
        owner: saved.owner,
        repo: saved.repo,
        branch: saved.branch,
        path: saved.path,
      };
      // The QR encoder loads only when a QR code is shown.
      const [pairing, { encode }] = await Promise.all([
        createPairing(
          { ...access, ...(backup ? { backup } : {}) },
          Date.now(),
          location.origin + location.pathname,
        ),
        import("uqr"),
      ]);
      const modules = encode(pairing.url, { ecc: "L", border: 4 }).data;
      setShown({ url: pairing.url, code: pairing.code, modules, backup: !!backup });
      setExpired(false);
    } catch {
      toast(tr(l("The QR code could not be made", "Le QR code n'a pas pu être créé")));
    } finally {
      setOpening(false);
    }
  };

  const open = (
    <button type="button" class="btn" disabled={opening} onClick={() => void show()}>
      <Icon name={opening ? "spinner" : "qr"} size={17} {...(opening ? { class: "spin" } : {})} />
      {expired
        ? tr(l("Show a new QR code", "Afficher un nouveau QR code"))
        : tr(l("Link a phone", "Connecter un téléphone"))}
    </button>
  );
  if (!shown) return open;

  return (
    <section class="pair-box stack" aria-label={tr(l("Link a phone", "Connecter un téléphone"))}>
      {expired ? (
        <>
          <p class="muted small" style={{ margin: 0 }}>
            {tr(
              l(
                "This QR code has expired: they work for 10 minutes.",
                "Ce QR code a expiré : ils marchent 10 minutes.",
              ),
            )}
          </p>
          {open}
        </>
      ) : (
        <>
          <Qr modules={shown.modules} url={shown.url} />
          <p class="small" style={{ margin: 0 }}>
            {tr(
              l(
                "Scan it with your phone's camera, then type this code:",
                "Scanne-le avec l'appareil photo de ton téléphone, puis tape ce code :",
              ),
            )}
          </p>
          <p class="pair-code">{formatCode(shown.code)}</p>
          <p class="hint" style={{ margin: 0 }}>
            {tr(
              shown.backup
                ? l(
                    "Together, the QR code and this code give access to your sync and to your GitHub backup repository: only show them to your own devices. They work for 10 minutes.",
                    "Ensemble, le QR code et ce code donnent accès à ta sync et à ton dépôt de sauvegarde GitHub : ne les montre qu'à tes propres appareils. Ils marchent 10 minutes.",
                  )
                : l(
                    "Together, the QR code and this code give access to your sync: only show them to your own devices. They work for 10 minutes.",
                    "Ensemble, le QR code et ce code donnent accès à ta sync : ne les montre qu'à tes propres appareils. Ils marchent 10 minutes.",
                  ),
            )}
          </p>
        </>
      )}
      <div class="row" style={{ justifyContent: "center" }}>
        {!expired && (
          <button type="button" class="btn" onClick={() => void copyText(shown.url)}>
            <Icon name="copy" size={17} />
            {tr(l("Copy link", "Copier le lien"))}
          </button>
        )}
        <button type="button" class="btn" onClick={() => setShown(null)}>
          {tr(l("Hide", "Masquer"))}
        </button>
      </div>
    </section>
  );
}

/** Where a linked device syncs, and what to tell about it. */
function Linked({ linked }: { linked: Link }) {
  const s = syncStatus.value;
  const repo = linked.kind === "repo" ? linked : null;
  const open =
    linked.kind === "repo"
      ? { href: repoFileUrl(linked), label: l("Open the file", "Ouvrir le fichier") }
      : { href: gistUrl(linked.gistId), label: l("Open the gist", "Ouvrir le gist") };
  return (
    <div class="stack">
      <ScreenHead title={tr(l("GitHub sync", "Sync GitHub"))} />
      <div class="notice">
        <strong>{linked.login ? `@${linked.login}` : "GitHub"}</strong>
        <p style={{ margin: "4px 0 0" }}>
          {repo ? `${repo.owner}/${repo.repo} · ${repo.path}` : tr(l("Secret gist", "Gist secret"))}
        </p>
        <p style={{ margin: "4px 0 0" }} role="status">
          {syncLabel()}
        </p>
      </div>
      {linkKept.value ? null : (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {tr(
            l(
              "This browser's storage for the site is full or blocked: the connection lasts for this page only, connect again after a reload.",
              "Le stockage du navigateur pour ce site est plein ou bloqué : la connexion ne dure que pour cette page, reconnecte-toi après un rechargement.",
            ),
          )}
        </p>
      )}
      <p class="muted small" style={{ margin: 0 }}>
        {repo
          ? fmt(
              l(
                "Your notebook is kept in {repo}, a private repository of yours: only you, and the people you give access to it, can read it. Link a phone below, or connect another device with the same repository. Each sync keeps the newer edit of every place and is a commit: the repository's history keeps every version.",
                "Ton carnet est gardé dans {repo}, un dépôt privé à toi : seuls toi et les personnes à qui tu y donnes accès pouvez le lire. Connecte un téléphone ci-dessous, ou un autre appareil avec le même dépôt. Chaque sync garde la modification la plus récente de chaque lieu et fait un commit : l'historique du dépôt garde toutes les versions.",
              ),
              { repo: `${repo.owner}/${repo.repo}` },
            )
          : tr(
              l(
                "Your notebook is kept in a secret gist of yours. A secret gist is not listed, but anyone who has its link can read it: for a sync only you can read, disconnect and choose a private repository. Open spots on another device and connect the same account to find it there. Each sync keeps the newer edit of every place; the gist's history keeps every version.",
                "Ton carnet est gardé dans un gist secret à toi. Un gist secret n'est listé nulle part, mais n'importe qui ayant son lien peut le lire : pour une sync que toi seul peux lire, déconnecte et choisis un dépôt privé. Ouvre spots sur un autre appareil et connecte le même compte pour l'y retrouver. Chaque sync garde la modification la plus récente de chaque lieu ; l'historique du gist garde toutes les versions.",
              ),
            )}
      </p>
      <div class="row">
        <button
          type="button"
          class="btn shell"
          disabled={s.state === "syncing"}
          onClick={() => void syncNow()}
        >
          <Icon name="sync" size={17} {...(s.state === "syncing" ? { class: "spin" } : {})} />
          {tr(l("Sync now", "Synchroniser"))}
        </button>
        <a class="btn" href={open.href} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={17} />
          {tr(open.label)}
        </a>
      </div>
      <LinkPhone access={pairAccess(linked)} />
      <button
        type="button"
        class="btn danger"
        onClick={() => {
          disconnect();
          toast(
            tr(
              repo
                ? l(
                    "Disconnected. The file stays in your repository.",
                    "Déconnecté. Le fichier reste dans ton dépôt.",
                  )
                : l(
                    "Disconnected. The gist stays on GitHub.",
                    "Déconnecté. Le gist reste sur GitHub.",
                  ),
            ),
          );
        }}
      >
        {tr(l("Disconnect this device", "Déconnecter cet appareil"))}
      </button>
    </div>
  );
}

/** The steps to make a private repository and a token that can only write its contents. */
function RepoSteps() {
  return (
    <ol class="stack small" style={{ margin: 0, paddingLeft: "20px", gap: "8px" }}>
      <li>
        {tr(l("Create a private repository: ", "Crée un dépôt privé : "))}
        <a href={NEW_REPO_URL} target="_blank" rel="noopener noreferrer">
          {tr(l("new repository", "nouveau dépôt"))}
        </a>
        {tr(l(". Keep it private.", ". Laisse-le privé."))}
      </li>
      <li>
        {tr(l("Create a fine-grained token: ", "Crée un jeton fin (fine-grained) : "))}
        <a href={REPO_TOKEN_URL} target="_blank" rel="noopener noreferrer">
          {tr(l("new token", "nouveau jeton"))}
        </a>
        .
      </li>
      <li>
        {tr(
          l(
            "Under “Repository access”, choose “Only select repositories” and pick that repository.",
            "Dans « Repository access », choisis « Only select repositories » et prends ce dépôt.",
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
  );
}

/** The steps to make a token that can only read and write gists. */
function GistSteps() {
  return (
    <ol class="stack small" style={{ margin: 0, paddingLeft: "20px", gap: "8px" }}>
      <li>
        {tr(l("Create a fine-grained token: ", "Crée un jeton fin (fine-grained) : "))}
        <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
          {tr(l("new token", "nouveau jeton"))}
        </a>
        .
      </li>
      <li>
        {tr(
          l(
            "Under “Account permissions”, set Gists to “Read and write”. Nothing else is needed.",
            "Dans « Account permissions », mets Gists sur « Read and write ». Rien d'autre n'est nécessaire.",
          ),
        )}
      </li>
      <li>
        {tr(l("Generate it, copy it and paste it here.", "Génère-le, copie-le et colle-le ici."))}
      </li>
    </ol>
  );
}

export function Sync() {
  const [backend, setBackend] = useState<Backend>("repo");
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestSnap("full");
  }, []);

  const linked = link.value;
  if (linked) return <Linked linked={linked} />;

  const ready = token.trim() !== "" && (backend === "gist" || repo.trim() !== "");

  const choose = (next: Backend) => {
    setBackend(next);
    setError(null);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      if (backend === "repo") await connectRepo(token, repo);
      else await connect(token);
      setToken("");
      setRepo("");
      toast(tr(l("Connected to GitHub", "Connecté à GitHub")));
    } catch (err) {
      setError(errorOf(err, backend));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="stack">
      <ScreenHead title={tr(l("GitHub sync", "Sync GitHub"))} />
      <p class="muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Keep your notebook in sync across devices, on your own GitHub account. No server in between.",
            "Synchronise ton carnet entre tes appareils, sur ton propre compte GitHub. Aucun serveur entre les deux.",
          ),
        )}
      </p>
      <LinkFromDevice />
      <form class="stack section" onSubmit={submit}>
        <div class="field">
          <span class="label">{tr(l("Keep it in", "Le garder dans"))}</span>
          <fieldset
            class="segmented"
            style={{ gridTemplateColumns: "1fr 1fr" }}
            aria-label={tr(l("Keep it in", "Le garder dans"))}
          >
            <button type="button" aria-pressed={backend === "repo"} onClick={() => choose("repo")}>
              {tr(l("Private repository", "Dépôt privé"))}
            </button>
            <button type="button" aria-pressed={backend === "gist"} onClick={() => choose("gist")}>
              {tr(l("Secret gist", "Gist secret"))}
            </button>
          </fieldset>
        </div>
        <p class="small" style={{ margin: 0 }}>
          {backend === "repo"
            ? tr(
                l(
                  "Recommended. A private repository can only be read by you and the people you give access to it. The notebook is one file in it, and every sync is a commit, so its history keeps every version.",
                  "Recommandé. Un dépôt privé ne peut être lu que par toi et les personnes à qui tu y donnes accès. Le carnet y est un seul fichier, et chaque sync est un commit : son historique garde toutes les versions.",
                ),
              )
            : tr(
                l(
                  "A secret gist is not listed anywhere, but anyone who has its link can read it: GitHub has no truly private gist. Choose a private repository to keep your places to yourself.",
                  "Un gist secret n'est listé nulle part, mais n'importe qui ayant son lien peut le lire : GitHub n'a pas de gist vraiment privé. Choisis un dépôt privé pour garder tes lieux pour toi.",
                ),
              )}
        </p>
        {backend === "repo" ? <RepoSteps /> : <GistSteps />}
        {backend === "repo" && (
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
        )}
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
        <button type="submit" class="btn primary block" disabled={busy || !ready}>
          <Icon name={busy ? "spinner" : "github"} size={18} {...(busy ? { class: "spin" } : {})} />
          {tr(l("Connect", "Connecter"))}
        </button>
      </form>
    </div>
  );
}
