/**
 * Choosing the AI: a provider and model from the catalog with the user's own
 * key, or a local server (Ollama, LM Studio). The key is encrypted in this
 * browser and only ever sent to that provider.
 */
import { ENDPOINT_PRESETS } from "llm-connect";
import { useEffect, useState } from "preact/hooks";
import { llm, llmState, loadLlmSettings, modelLabel, savedSettings } from "../../ai/settings";
import { l, lang, tr } from "../../i18n";
import { Icon } from "../../ui/icons";
import { ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { back } from "../state";

const TEST_ERRORS: Record<string, ReturnType<typeof l>> = {
  auth: l("The provider refused this key.", "Le fournisseur refuse cette clé."),
  cors: l(
    "No answer: the key was refused, or the network blocked the request.",
    "Pas de réponse : clé refusée, ou requête bloquée par le réseau.",
  ),
  http: l("The provider answered with an error.", "Le fournisseur a répondu par une erreur."),
  timeout: l(
    "The provider took too long to answer.",
    "Le fournisseur a mis trop de temps à répondre.",
  ),
  config: l(
    "Something is missing: a model or a key.",
    "Il manque quelque chose : un modèle ou une clé.",
  ),
  insecure: l(
    "A server on another machine must use https.",
    "Un serveur sur une autre machine doit être en https.",
  ),
};

export function AiSettings() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestSnap("full");
    void loadLlmSettings().then(() => {
      llm.open();
      if (!llm.getState().saved) llm.setLanguage(lang.value);
    });
  }, []);

  const s = llmState.value;
  const d = s.draft;
  const saved = savedSettings();

  const save = async (e: Event) => {
    e.preventDefault();
    setError(null);
    const res = await llm.save();
    if (res.ok) {
      toast(tr(l("AI ready", "IA prête")));
      back({ name: "ai" });
    } else {
      setError(
        res.reason === "insecure-endpoint"
          ? tr(TEST_ERRORS.insecure as ReturnType<typeof l>)
          : res.reason === "invalid-endpoint"
            ? tr(
                l("This server address is not valid.", "L'adresse de ce serveur n'est pas valide."),
              )
            : tr(TEST_ERRORS.config as ReturnType<typeof l>),
      );
    }
  };

  const test = s.testResult;

  return (
    <form class="stack" onSubmit={save}>
      <ScreenHead title={tr(l("AI settings", "Réglages de l'IA"))} />
      <p class="muted small" style={{ margin: 0 }}>
        {tr(
          l(
            "spots has no AI of its own: it calls the provider you choose, with your key, straight from this browser. Only what you ask it to read is sent.",
            "spots n'a pas d'IA à lui : il appelle le fournisseur que tu choisis, avec ta clé, directement depuis ce navigateur. Seul ce que tu lui demandes de lire est envoyé.",
          ),
        )}
      </p>
      {saved && (
        <div class="notice">
          {tr(l("In use:", "Utilisé :"))} <strong>{modelLabel(saved)}</strong>
        </div>
      )}

      <fieldset class="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button type="button" aria-pressed={!d.custom} onClick={() => llm.toggleCustom(false)}>
          {tr(l("A provider", "Un fournisseur"))}
        </button>
        <button type="button" aria-pressed={d.custom} onClick={() => llm.toggleCustom(true)}>
          {tr(l("A local server", "Un serveur local"))}
        </button>
      </fieldset>

      {d.custom ? (
        <>
          <div class="chips">
            {Object.values(ENDPOINT_PRESETS).map((p) => (
              <button key={p.id} type="button" class="chip" onClick={() => llm.applyPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
          <label class="field">
            <span class="label">{tr(l("Server address", "Adresse du serveur"))}</span>
            <input
              class="input"
              value={d.customEndpoint}
              inputMode="url"
              onInput={(e) => llm.setEndpoint(e.currentTarget.value)}
              placeholder="http://localhost:11434/v1"
            />
          </label>
          <label class="field">
            <span class="label">{tr(l("Model", "Modèle"))}</span>
            <input
              class="input"
              value={d.customModel}
              onInput={(e) => llm.setCustomModel(e.currentTarget.value)}
              placeholder="llama3.2"
            />
          </label>
          <p class="hint" style={{ margin: 0 }}>
            {tr(
              l(
                "The server must accept requests from this site (for Ollama: OLLAMA_ORIGINS=https://maxgfr.github.io).",
                "Le serveur doit accepter les requêtes de ce site (pour Ollama : OLLAMA_ORIGINS=https://maxgfr.github.io).",
              ),
            )}
          </p>
        </>
      ) : (
        <>
          {s.catalogStatus === "loading" && (
            <p class="hint">
              {tr(l("Loading the model catalog…", "Chargement du catalogue de modèles…"))}
            </p>
          )}
          {s.catalogStatus === "error" && (
            <div class="notice">
              {tr(
                l(
                  "The model catalog could not be loaded.",
                  "Le catalogue de modèles n'a pas pu être chargé.",
                ),
              )}{" "}
              <button type="button" class="btn" onClick={() => llm.retryCatalog()}>
                {tr(l("Retry", "Réessayer"))}
              </button>
            </div>
          )}
          <label class="field">
            <span class="label">{tr(l("Provider", "Fournisseur"))}</span>
            <select
              class="input"
              value={d.providerId}
              onChange={(e) => llm.selectProvider(e.currentTarget.value)}
            >
              <optgroup label={tr(l("Recommended", "Recommandés"))}>
                {s.providers.recommended.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={tr(l("Others", "Autres"))}>
                {s.providers.others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label class="field">
            <span class="label">{tr(l("Model", "Modèle"))}</span>
            <select
              class="input"
              value={d.model}
              onChange={(e) => llm.selectModel(e.currentTarget.value)}
            >
              {s.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {s.recommendedModel?.id === m.id
                    ? ` (${tr(l("recommended", "recommandé"))})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span class="label">{tr(l("API key", "Clé d'API"))}</span>
            <input
              class="input"
              type="password"
              autoComplete="off"
              spellcheck={false}
              value={s.apiKey}
              onInput={(e) => llm.setApiKey(e.currentTarget.value)}
              placeholder={s.provider ? `${s.provider.name}…` : ""}
            />
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              checked={d.rememberKey}
              onChange={(e) => llm.setRememberKey(e.currentTarget.checked)}
            />
            <span>
              {tr(l("Remember the key on this device", "Garder la clé sur cet appareil"))}
              <span class="hint" style={{ display: "block" }}>
                {tr(
                  l(
                    "Encrypted in this browser. Otherwise it is forgotten when the tab closes.",
                    "Chiffrée dans ce navigateur. Sinon elle est oubliée à la fermeture de l'onglet.",
                  ),
                )}
              </span>
            </span>
          </label>
        </>
      )}

      {test && (
        <p class={test.ok ? "hint" : "error"} role="status" style={{ margin: 0 }}>
          {test.ok
            ? tr(l("Connection works.", "La connexion fonctionne."))
            : tr(TEST_ERRORS[test.reason] ?? (TEST_ERRORS.http as ReturnType<typeof l>))}
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
          disabled={!s.canTest || s.testing}
          onClick={() => void llm.test()}
        >
          <Icon
            name={s.testing ? "spinner" : "check"}
            size={17}
            {...(s.testing ? { class: "spin" } : {})}
          />
          {tr(l("Test", "Tester"))}
        </button>
        <button type="submit" class="btn primary" disabled={!s.canSave}>
          {tr(l("Save", "Enregistrer"))}
        </button>
      </div>
      {saved && (
        <button
          type="button"
          class="btn danger"
          onClick={() => {
            void llm.clear();
            toast(tr(l("AI turned off, key erased", "IA désactivée, clé effacée")));
          }}
        >
          {tr(l("Turn off and erase the key", "Désactiver et effacer la clé"))}
        </button>
      )}
    </form>
  );
}
