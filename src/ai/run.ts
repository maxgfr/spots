/**
 * What the AI does, loaded only when it is used: read places out of any text
 * (a friend's message, an article, a voice note) and answer questions about
 * the user's own places. Every call goes through llm-connect: the model from
 * the saved settings, the provider options for it, a check of what it accepts
 * before any request, and errors described without the key.
 */
import { generateText, Output } from "ai";
import {
  callOptions,
  callProblem,
  describeError,
  type LlmErrorCode,
  type LlmSettings,
  languageName,
  loadModel,
  transcribe,
  transcriptionProblem,
} from "llm-connect";
import { z } from "zod";
import { distance, type GeoResult, search } from "../geo/geocode";
import { l, tr } from "../i18n";
import type { Place, Tag } from "../store/model";
import { capabilitiesOf } from "./settings";

export class AiError extends Error {}

const FAILURES: Record<LlmErrorCode, ReturnType<typeof l>> = {
  auth: l(
    "The provider refused the key. Check it in the AI settings.",
    "Le fournisseur refuse la clé. Vérifie-la dans les réglages de l'IA.",
  ),
  "auth-or-network": l(
    "No answer from the provider: the key was refused, or the network blocked the request.",
    "Pas de réponse du fournisseur : la clé a été refusée, ou le réseau a bloqué la requête.",
  ),
  "rate-limit": l(
    "Too many requests for now: wait a moment.",
    "Trop de requêtes pour l'instant : attends un peu.",
  ),
  overloaded: l(
    "The provider is overloaded right now.",
    "Le fournisseur est surchargé en ce moment.",
  ),
  "context-length": l(
    "This is more than the model can read at once.",
    "C'est plus que ce que le modèle peut lire d'un coup.",
  ),
  "invalid-request": l("The provider refused the request.", "Le fournisseur a refusé la requête."),
  "not-found": l(
    "The provider does not know this model. Pick another one.",
    "Le fournisseur ne connaît pas ce modèle. Choisis-en un autre.",
  ),
  server: l("The provider ran into an error.", "Le fournisseur a rencontré une erreur."),
  unknown: l("The model call failed.", "L'appel au modèle a échoué."),
};

function aiError(err: unknown, settings: LlmSettings): AiError {
  if (err instanceof AiError) return err;
  const e = describeError(err, settings.apiKey);
  const detail = e.message.trim();
  return new AiError(
    detail ? `${tr(FAILURES[e.code])} (${detail.replace(/\.$/, "")}.)` : tr(FAILURES[e.code]),
  );
}

async function structured<S extends z.ZodType>(
  settings: LlmSettings,
  schema: S,
  name: string,
  instructions: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const messages = [{ role: "user" as const, content: prompt }];
  const capabilities = capabilitiesOf(settings);
  const problem = callProblem(settings, { messages }, capabilities);
  if (problem) throw new AiError(problem.message);
  try {
    const res = await generateText({
      model: await loadModel(settings),
      instructions,
      messages,
      output: Output.object({ schema, name }),
      maxRetries: 1,
      ...(signal ? { abortSignal: signal } : {}),
      ...callOptions(settings, { capabilities }),
    });
    return res.output as z.infer<S>;
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw aiError(err, settings);
  }
}

function answerLanguage(settings: LlmSettings): string {
  return languageName(settings.language ?? "") || "English";
}

const extractedSchema = z.object({
  places: z
    .array(
      z.object({
        name: z.string().describe("The place's own name, as it is known locally."),
        area: z
          .string()
          .describe("Street, neighbourhood or address the text gives; empty if none."),
        city: z.string().describe("City or town, given or clearly implied; empty if unknown."),
        tag: z.string().describe("One of the user's tags, or a one- or two-word category."),
        note: z
          .string()
          .describe("What the text says about it: what to order, who recommended it, tips."),
      }),
    )
    .describe("Every real place the text recommends or mentions as worth a visit."),
});

export interface Extracted {
  name: string;
  note: string;
  tag: string;
  /** Where the place was found on the map; missing when the geocoder found nothing. */
  hit?: GeoResult;
  query: string;
}

/** The places a text talks about, each looked up on the map near `near`. */
export async function extractPlaces(
  settings: LlmSettings,
  text: string,
  tags: Tag[],
  near: [number, number],
  signal?: AbortSignal,
): Promise<Extracted[]> {
  const instructions = [
    "You read a text the user pasted or dictated (a message from a friend, an article, notes) and list the real-world places it recommends or mentions as worth visiting: restaurants, cafés, bars, shops, museums, parks, sights.",
    "Never invent a place the text does not name. Skip vague mentions without a name. Return an empty list when there is none.",
    `For tag, pick the closest of the user's tags: ${tags.map((t) => JSON.stringify(t.name)).join(", ") || "(none yet)"}. If none fits, give a one- or two-word category.`,
    `Write each note in ${answerLanguage(settings)}, at most 200 characters, only from what the text says.`,
  ].join("\n");
  const prompt = `The user is looking at the map around latitude ${near[1].toFixed(3)}, longitude ${near[0].toFixed(3)}.\n\nText:\n"""\n${text.slice(0, 20000)}\n"""`;
  const out = await structured(settings, extractedSchema, "places", instructions, prompt, signal);
  const found: Extracted[] = [];
  for (const p of out.places.slice(0, 40)) {
    const query = [p.name, p.area, p.city].filter((s) => s.trim()).join(" ");
    let hit: GeoResult | undefined;
    try {
      [hit] = await search(query, { near, zoom: 11, limit: 1, ...(signal ? { signal } : {}) });
      if (!hit && p.city)
        [hit] = await search(`${p.name} ${p.city}`, {
          near,
          zoom: 11,
          limit: 1,
          ...(signal ? { signal } : {}),
        });
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    found.push({ name: p.name, note: p.note, tag: p.tag, query, ...(hit ? { hit } : {}) });
  }
  return found;
}

const answerSchema = z.object({
  answer: z.string().describe("A short, direct answer, citing places by name."),
  placeIds: z
    .array(z.string())
    .describe("Ids of the places recommended, best first; empty when none fit."),
});

/** An answer about the user's own places, with the ones it recommends. */
export async function askPlaces(
  settings: LlmSettings,
  question: string,
  places: Place[],
  tagName: (id: string) => string | undefined,
  listName: (id: string) => string | undefined,
  origin: [number, number],
  signal?: AbortSignal,
): Promise<{ answer: string; placeIds: string[] }> {
  const rows = places
    .map((p) => ({ p, d: distance(origin, [p.lng, p.lat]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 300)
    .map(({ p, d }) =>
      [
        p.id,
        p.name,
        p.tagIds.map(tagName).filter(Boolean).join("/"),
        p.state,
        `${(d / 1000).toFixed(1)} km`,
        p.listIds.map(listName).filter(Boolean).join("/"),
        p.address,
        p.note.replace(/\s+/g, " ").slice(0, 140),
      ].join(" | "),
    );
  const instructions = [
    "You help someone choose among the places they saved in their own notebook. Answer only from the places listed; never suggest a place that is not in the list.",
    "Each line is: id | name | tags | state (try = not been yet, visited, favorite) | distance from the user | lists | address | note.",
    `Answer in ${answerLanguage(settings)}, in two to four sentences. Put the ids of the places you recommend in placeIds, best first.`,
  ].join("\n");
  const prompt = `Question: ${question}\n\nPlaces:\n${rows.join("\n")}`;
  const out = await structured(settings, answerSchema, "answer", instructions, prompt, signal);
  const known = new Set(places.map((p) => p.id));
  return { answer: out.answer, placeIds: out.placeIds.filter((id) => known.has(id)) };
}

/** Whether this provider can turn a recording into text, or why not. */
export function voiceProblem(settings: LlmSettings): string | null {
  return transcriptionProblem(settings)
    ? tr(
        l(
          "This provider has no transcription model. Pick OpenAI, Mistral, Gemini or Groq to dictate, or type the text.",
          "Ce fournisseur n'a pas de modèle de transcription. Choisis OpenAI, Mistral, Gemini ou Groq pour dicter, ou tape le texte.",
        ),
      )
    : null;
}

/** The provider's transcription of a recording. */
export async function transcribeVoice(settings: LlmSettings, audio: Blob): Promise<string> {
  try {
    return (await transcribe(settings, audio, { words: false })).text.trim();
  } catch (err) {
    throw aiError(err, settings);
  }
}
