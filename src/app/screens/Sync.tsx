/**
 * Connecting GitHub: the user creates a token that can only read and write
 * gists, pastes it once, and the notebook is kept in a secret gist of theirs.
 */
import { useEffect, useState } from "preact/hooks";
import { l, locale, tr } from "../../i18n";
import { GistError, gistUrl, TOKEN_URL } from "../../sync/gist";
import { connect, disconnect, link, syncNow, syncStatus } from "../../sync/sync";
import { Icon } from "../../ui/icons";
import { ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";

const ERRORS: Record<string, ReturnType<typeof l>> = {
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
};

export function syncLabel(): string {
  const s = syncStatus.value;
  if (s.state === "off")
    return tr(l("Not synced: only on this device", "Non synchronisé : seulement sur cet appareil"));
  if (s.state === "syncing") return tr(l("Syncing…", "Synchronisation…"));
  if (s.state === "error") return tr(ERRORS[s.code] ?? (ERRORS.server as ReturnType<typeof l>));
  if (!s.at) return tr(l("Synced with GitHub", "Synchronisé avec GitHub"));
  const time = new Date(s.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return `${tr(l("Synced at", "Synchronisé à"))} ${time}`;
}

export function Sync() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestSnap("full");
  }, []);

  const linked = link.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await connect(token);
      setToken("");
      toast(tr(l("Connected to GitHub", "Connecté à GitHub")));
    } catch (err) {
      const code = err instanceof GistError ? err.code : "server";
      setError(tr(ERRORS[code] ?? (ERRORS.server as ReturnType<typeof l>)));
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    const s = syncStatus.value;
    return (
      <div class="stack">
        <ScreenHead title={tr(l("GitHub sync", "Sync GitHub"))} />
        <div class="notice">
          <strong>{linked.login ? `@${linked.login}` : "GitHub"}</strong>
          <p style={{ margin: "4px 0 0" }} role="status">
            {syncLabel()}
          </p>
        </div>
        <p class="muted small" style={{ margin: 0 }}>
          {tr(
            l(
              "Your notebook is kept in a secret gist of yours. Open spots on another device and connect the same account to find it there. Each sync keeps the newer edit of every place; the gist's history keeps every version.",
              "Ton carnet est gardé dans un gist secret à toi. Ouvre spots sur un autre appareil et connecte le même compte pour l'y retrouver. Chaque sync garde la modification la plus récente de chaque lieu ; l'historique du gist garde toutes les versions.",
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
          <a class="btn" href={gistUrl(linked.gistId)} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={17} />
            {tr(l("Open the gist", "Ouvrir le gist"))}
          </a>
        </div>
        <button
          type="button"
          class="btn danger"
          onClick={() => {
            disconnect();
            toast(
              tr(
                l(
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

  return (
    <form class="stack" onSubmit={submit}>
      <ScreenHead title={tr(l("GitHub sync", "Sync GitHub"))} />
      <p class="muted" style={{ margin: 0 }}>
        {tr(
          l(
            "Keep your notebook in sync across devices, in a secret gist on your own GitHub account. No server in between.",
            "Synchronise ton carnet entre tes appareils, dans un gist secret de ton propre compte GitHub. Aucun serveur entre les deux.",
          ),
        )}
      </p>
      <ol class="stack small" style={{ margin: 0, paddingLeft: "20px", gap: "8px" }}>
        <li>
          {tr(l("Create a fine-grained token: ", "Crée un jeton fin (fine-grained) : "))}
          <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
            {tr(l("open GitHub", "ouvrir GitHub"))}
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
      <button type="submit" class="btn primary block" disabled={busy || !token.trim()}>
        <Icon name={busy ? "spinner" : "github"} size={18} {...(busy ? { class: "spin" } : {})} />
        {tr(l("Connect", "Connecter"))}
      </button>
    </form>
  );
}
