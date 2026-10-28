/**
 * The AI, two ways. "Add from text": paste or dictate anything that names
 * places, check what the model found and where, add the ones you want.
 * "Ask": a question about your own places, answered from them only.
 */
import { transcriptionProblem } from "llm-connect";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Extracted } from "../../ai/run";
import { loadLlmSettings, modelLabel, savedSettings } from "../../ai/settings";
import { fmt, l, plural, tr } from "../../i18n";
import { fitPlaces, mapCenter } from "../../map/MapView";
import { foldName } from "../../share/share";
import type { Place } from "../../store/model";
import { TAG_COLORS } from "../../store/model";
import { addPlace, addTag, listById, places, tagById, tags } from "../../store/store";
import { Icon } from "../../ui/icons";
import { ScreenHead, toast } from "../../ui/ui";
import { requestSnap } from "../Sheet";
import { go, userPosition } from "../state";
import { PlaceRow } from "./Home";

type Mode = "add" | "ask";

export function Ai() {
  const [mode, setMode] = useState<Mode>(places.value.length > 0 ? "ask" : "add");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    requestSnap("full");
    void loadLlmSettings().then(() => setReady(true));
  }, []);

  const settings = savedSettings();
  if (!ready) return <p class="muted">…</p>;
  if (!settings) {
    return (
      <div class="stack">
        <ScreenHead title={tr(l("AI", "IA"))} />
        <p class="muted" style={{ margin: 0 }}>
          {tr(
            l(
              "Paste a friend's message or an article and let the AI pin the places it names; ask which of your places fits tonight. It runs with your own provider and key: OpenAI, Anthropic, Gemini, Mistral, or a local server.",
              "Colle le message d'un ami ou un article et laisse l'IA épingler les lieux cités ; demande lequel de tes lieux convient pour ce soir. Elle tourne avec ton fournisseur et ta clé : OpenAI, Anthropic, Gemini, Mistral, ou un serveur local.",
            ),
          )}
        </p>
        <button type="button" class="btn primary block" onClick={() => go({ name: "ai-settings" })}>
          <Icon name="settings" size={18} />
          {tr(l("Set up the AI", "Configurer l'IA"))}
        </button>
      </div>
    );
  }

  return (
    <div class="stack">
      <ScreenHead title={tr(l("AI", "IA"))}>
        <button
          type="button"
          class="icon-btn"
          onClick={() => go({ name: "ai-settings" })}
          aria-label={tr(l("AI settings", "Réglages de l'IA"))}
        >
          <Icon name="settings" />
        </button>
      </ScreenHead>
      <fieldset class="segmented" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <button type="button" aria-pressed={mode === "ask"} onClick={() => setMode("ask")}>
          <Icon name="ask" size={17} />
          {tr(l("Ask my spots", "Demander"))}
        </button>
        <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")}>
          <Icon name="plus" size={17} />
          {tr(l("Add from text", "Ajouter d'un texte"))}
        </button>
      </fieldset>
      {mode === "add" ? <AddFromText /> : <Ask />}
      <p class="hint" style={{ margin: 0 }}>
        {fmt(l("Model: {m}", "Modèle : {m}"), { m: modelLabel(settings) })}
      </p>
    </div>
  );
}

function useRecorder(onAudio: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
        setRecording(false);
        onAudio(new Blob(chunks, { type: r.mimeType }));
      };
      rec.current = r;
      r.start();
      setRecording(true);
    } catch {
      toast(tr(l("The microphone is not available", "Le micro n'est pas disponible")));
    }
  };
  const stop = () => rec.current?.stop();
  return { recording, start, stop };
}

function AddFromText() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"read" | "listen" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Extracted[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const ctrl = useRef<AbortController | null>(null);
  const settings = savedSettings();

  const recorder = useRecorder(async (blob) => {
    if (!settings) return;
    setBusy("listen");
    setError(null);
    try {
      const run = await import("../../ai/run");
      const said = await run.transcribeVoice(settings, blob);
      setText((t) => (t ? `${t}\n${said}` : said));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  });

  const read = async () => {
    if (!settings || !text.trim()) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setBusy("read");
    setError(null);
    setFound(null);
    try {
      const run = await import("../../ai/run");
      const out = await run.extractPlaces(settings, text, tags.value, mapCenter.value, c.signal);
      setFound(out);
      setChosen(new Set(out.map((x, i) => (x.hit ? i : -1)).filter((i) => i >= 0)));
    } catch (err) {
      if (!c.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const add = () => {
    if (!found) return;
    const added: Place[] = [];
    for (const [i, x] of found.entries()) {
      if (!chosen.has(i) || !x.hit) continue;
      let tag = tags.value.find((t) => foldName(t.name) === foldName(x.tag));
      if (!tag && x.tag.trim()) {
        const used = new Set(tags.value.map((t) => t.color));
        tag = addTag({
          name: x.tag.trim(),
          color: TAG_COLORS.find((c) => !used.has(c)) ?? "ink",
          icon: "pin",
        });
      }
      added.push(
        addPlace({
          name: x.name,
          address: x.hit.address,
          lat: x.hit.lat,
          lng: x.hit.lng,
          note: x.note,
          tagIds: tag ? [tag.id] : [],
          listIds: [],
          state: "try",
          source: "ai",
        }),
      );
    }
    toast(
      `${added.length} ${plural(added.length, l("place pinned", "lieu épinglé"), l("places pinned", "lieux épinglés"))}`,
    );
    setFound(null);
    setText("");
    fitPlaces(added);
    go({ name: "home" });
  };

  // Dictation needs a provider with a transcription model (OpenAI, Mistral, Gemini, Groq…).
  const canDictate = settings !== null && transcriptionProblem(settings) === null;
  return (
    <div class="stack">
      <label class="field">
        <span class="label">{tr(l("Text that names places", "Un texte qui cite des lieux"))}</span>
        <textarea
          class="input"
          style={{ minHeight: "130px" }}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder={tr(
            l(
              "“Try the bo bun at Le Petit Cambodge, rue Alibert, and have a drink at Le Syndicat after…”",
              "« Goûte le bo bun du Petit Cambodge, rue Alibert, et va boire un verre au Syndicat après… »",
            ),
          )}
        />
      </label>
      <div class="row">
        <button
          type="button"
          class="btn primary"
          disabled={!text.trim() || busy !== null}
          onClick={() => void read()}
        >
          <Icon
            name={busy === "read" ? "spinner" : "sparkles"}
            size={17}
            {...(busy === "read" ? { class: "spin" } : {})}
          />
          {tr(l("Find the places", "Trouver les lieux"))}
        </button>
        {canDictate && typeof MediaRecorder !== "undefined" && (
          <button
            type="button"
            class="btn"
            aria-pressed={recorder.recording}
            disabled={busy !== null}
            onClick={() => void (recorder.recording ? recorder.stop() : recorder.start())}
          >
            <Icon
              name={recorder.recording ? "stop" : busy === "listen" ? "spinner" : "mic"}
              size={17}
              {...(busy === "listen" ? { class: "spin" } : {})}
            />
            {recorder.recording ? tr(l("Stop", "Arrêter")) : tr(l("Dictate", "Dicter"))}
          </button>
        )}
      </div>
      <p class="hint" style={{ margin: 0 }}>
        {tr(
          l(
            "The text (or recording) goes to your AI provider; the place names it finds are looked up on photon.komoot.io.",
            "Le texte (ou l'enregistrement) part chez ton fournisseur d'IA ; les noms trouvés sont cherchés sur photon.komoot.io.",
          ),
        )}
      </p>
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {found && found.length === 0 && (
        <p class="muted">
          {tr(l("No place found in this text.", "Aucun lieu trouvé dans ce texte."))}
        </p>
      )}
      {found && found.length > 0 && (
        <div class="stack" style={{ gap: "8px" }}>
          <ul class="rows">
            {found.map((x, i) => (
              <li key={`${x.name}-${i}`}>
                <label class="place-row" style={{ cursor: x.hit ? "pointer" : "default" }}>
                  <input
                    type="checkbox"
                    style={{ width: "22px", height: "22px", accentColor: "var(--shell)" }}
                    disabled={!x.hit}
                    checked={chosen.has(i)}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setChosen(next);
                    }}
                  />
                  <span class="row-text">
                    <span class="row-name">{x.name}</span>
                    <span class="row-meta">
                      {x.hit
                        ? [x.tag, x.hit.address].filter(Boolean).join(" · ")
                        : tr(
                            l(
                              "Not found on the map: pin it from the search",
                              "Introuvable sur la carte : épingle-le depuis la recherche",
                            ),
                          )}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            class="btn primary block"
            disabled={chosen.size === 0}
            onClick={add}
          >
            {fmt(l("Pin {n}", "Épingler {n}"), { n: chosen.size })}
          </button>
        </div>
      )}
    </div>
  );
}

function Ask() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; ids: string[] } | null>(null);
  const settings = savedSettings();
  const all = places.value;

  const ask = async (e: Event) => {
    e.preventDefault();
    if (!settings || !q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const run = await import("../../ai/run");
      const res = await run.askPlaces(
        settings,
        q,
        all,
        (id) => tagById.value.get(id)?.name,
        (id) => listById.value.get(id)?.name,
        userPosition.value ?? mapCenter.value,
      );
      setAnswer({ text: res.answer, ids: res.placeIds });
      const picked = all.filter((p) => res.placeIds.includes(p.id));
      if (picked.length > 0) fitPlaces(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (all.length === 0) {
    return (
      <p class="muted">
        {tr(
          l(
            "Pin a few places first, then ask about them here.",
            "Épingle d'abord quelques lieux, puis pose tes questions ici.",
          ),
        )}
      </p>
    );
  }

  const picked = answer
    ? answer.ids.map((id) => all.find((p) => p.id === id)).filter((p) => p !== undefined)
    : [];
  return (
    <form class="stack" onSubmit={ask}>
      <label class="field">
        <span class="label">{tr(l("Your question", "Ta question"))}</span>
        <input
          class="input"
          value={q}
          onInput={(e) => setQ(e.currentTarget.value)}
          placeholder={tr(
            l(
              "A cheap dinner near me I haven't tried?",
              "Un dîner pas cher près d'ici que je n'ai pas testé ?",
            ),
          )}
        />
      </label>
      <button type="submit" class="btn primary" disabled={busy || !q.trim()}>
        <Icon name={busy ? "spinner" : "send"} size={17} {...(busy ? { class: "spin" } : {})} />
        {tr(l("Ask", "Demander"))}
      </button>
      <p class="hint" style={{ margin: 0 }}>
        {fmt(
          l(
            "Your question and your places nearest to you (up to 300: names, tags, notes) go to your AI provider.",
            "Ta question et tes lieux les plus proches (300 au plus : noms, tags, notes) partent chez ton fournisseur d'IA.",
          ),
          {},
        )}
      </p>
      {error && (
        <p class="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      {answer && (
        <div class="stack" style={{ gap: "8px" }} role="status">
          <p class="prose">{answer.text}</p>
          {picked.length > 0 && (
            <ul class="rows">
              {picked.map((p) => (
                <li key={p.id}>
                  <PlaceRow place={p} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
