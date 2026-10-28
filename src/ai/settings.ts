/**
 * Bring-your-own-model settings, from llm-connect: the provider and model from
 * the llm-models catalog (built live, models.json as the offline fallback),
 * the key encrypted at rest under a non-extractable WebCrypto key, a free
 * connection test. Nothing here calls a model: that code (the AI SDK, the
 * schemas) loads only when the AI is used, from ./run.
 */
import { signal } from "@preact/signals";
import {
  createLlmSettingsStore,
  isConfigured,
  type LlmSettings,
  liveCatalog,
  providerKindOf,
  resolveCapabilities,
  type SlimModel,
  secureStorage,
} from "llm-connect";
import { l, tr } from "../i18n";

export const llm = createLlmSettingsStore({
  catalog: liveCatalog({
    fallbackUrl: "./models.json",
    required: ["openai", "anthropic", "google"],
  }),
  storage: secureStorage({ prefsKey: "spots:ai", dbName: "spots-secrets" }),
});

/** The store's state as a signal, so screens re-render on every change. */
export const llmState = signal(llm.getState());
llm.subscribe((s) => {
  llmState.value = s;
});

let loaded: Promise<unknown> | null = null;
export function loadLlmSettings(): Promise<unknown> {
  loaded ??= llm.load().catch(() => null);
  return loaded;
}

/** The saved settings, when they can call a model. */
export function savedSettings(): LlmSettings | null {
  const saved = llmState.value.saved;
  return saved && isConfigured(saved) ? (saved as LlmSettings) : null;
}

function catalogModel(settings: LlmSettings): SlimModel | undefined {
  const catalog = llmState.value.catalog;
  if (!catalog || !settings.providerId) return undefined;
  return catalog[settings.providerId]?.models[settings.model];
}

export function capabilitiesOf(settings: LlmSettings) {
  const entry = catalogModel(settings);
  return resolveCapabilities({
    kind: providerKindOf(settings),
    modelId: settings.model,
    ...(entry ? { catalog: entry } : {}),
  });
}

export function modelLabel(settings: LlmSettings | null): string {
  if (!settings) return "";
  if (settings.customEndpoint) return settings.customModel || settings.customEndpoint;
  return `${settings.providerName ?? settings.providerId ?? ""} · ${catalogModel(settings)?.name ?? settings.model}`;
}

/** One line for the menu: the model in use, or that none is set. */
export function aiLabel(): string {
  const s = savedSettings();
  return s
    ? modelLabel(s)
    : tr(
        l("Off: bring your own provider and key", "Désactivée : apporte ton fournisseur et ta clé"),
      );
}
