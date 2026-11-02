/**
 * Sync: pull the gist, merge it with the notebook record by record (the newer
 * edit wins, deletions included), keep the result here and push it back when
 * it differs. It runs when the app opens, when it comes back to the front,
 * when the network returns, and two seconds after a change.
 */
import { effect, signal } from "@preact/signals";
import { secureStorage } from "llm-connect";
import { merge, normalizeDoc, purgeTombstones, sameDoc } from "../store/merge";
import type { Doc } from "../store/model";
import { doc, notebookLoaded, replaceDoc } from "../store/store";
import {
  createGist,
  findGist,
  GistError,
  type GistErrorCode,
  readGist,
  whoami,
  writeGist,
} from "./gist";

/** Where the link used to be kept, the token in clear text: moved into `vault`, then removed. */
const LEGACY_KEY = "spots:github";

export interface Link {
  token: string;
  login: string;
  gistId: string;
}

/**
 * The token encrypted at rest (AES-GCM under a non-extractable key in IndexedDB), the
 * login and gist id beside it: every page of maxgfr.github.io can read this origin's storage.
 */
const vault = secureStorage<{ login: string; gistId: string }>({
  prefsKey: "spots:github-link",
  dbName: "spots-github",
});

function readLegacy(): Link | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
    if (raw && typeof raw.token === "string" && typeof raw.gistId === "string") {
      return { token: raw.token, login: String(raw.login ?? ""), gistId: raw.gistId };
    }
  } catch {}
  return null;
}

function removeLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

/** Stores the link; false when the browser kept it for this page only (storage full or blocked). */
async function keep(l: Link): Promise<boolean> {
  const kept = await vault
    .save({ apiKey: l.token, model: "", login: l.login, gistId: l.gistId }, { rememberKey: true })
    .catch(() => false);
  return kept !== false;
}

async function loadLink(): Promise<Link | null> {
  const old = readLegacy();
  if (old) {
    // Removed only once the encrypted copy is stored: a full storage must not lose the link.
    if (await keep(old)) removeLegacy();
    return old;
  }
  const saved = await vault.loadDraft?.().catch(() => null);
  return saved?.apiKey && saved.gistId
    ? { token: saved.apiKey, login: String(saved.login ?? ""), gistId: saved.gistId }
    : null;
}

export const link = signal<Link | null>(null);
/** False when the last link could not be stored: it lasts until the page is closed. */
export const linkKept = signal(true);

export type SyncStatus =
  | { state: "off" }
  | { state: "idle"; at: number }
  | { state: "syncing" }
  | { state: "error"; code: GistErrorCode; at: number };

export const syncStatus = signal<SyncStatus>({ state: "off" });

function serialize(d: Doc): string {
  return `${JSON.stringify({ app: "spots", version: 1, doc: d })}\n`;
}

function parseRemote(text: string | null): Doc | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    return normalizeDoc(raw && typeof raw === "object" && "doc" in raw ? raw.doc : raw);
  } catch {
    return null;
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Runs one sync now (or once more after the one in flight). */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce(): Promise<void> {
  const l = link.value;
  if (!l) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    syncStatus.value = { state: "error", code: "network", at: Date.now() };
    return;
  }
  syncStatus.value = { state: "syncing" };
  try {
    const remote = parseRemote(await readGist(l.token, l.gistId));
    const local = doc.value;
    const merged = purgeTombstones(remote ? merge(local, remote) : local, Date.now());
    // Only touch the notebook if the merge changed it, and only if nothing was edited meanwhile.
    if (!sameDoc(merged, local) && doc.value === local) replaceDoc(merged);
    if (!remote || !sameDoc(merged, remote)) await writeGist(l.token, l.gistId, serialize(merged));
    syncStatus.value = { state: "idle", at: Date.now() };
  } catch (err) {
    const code: GistErrorCode = err instanceof GistError ? err.code : "server";
    syncStatus.value = { state: "error", code, at: Date.now() };
  }
}

/** Checks the token, finds or creates the gist, saves the link and syncs. */
export async function connect(token: string): Promise<void> {
  const t = token.trim();
  const login = await whoami(t);
  let gistId = await findGist(t);
  if (!gistId) gistId = await createGist(t, serialize(doc.value));
  const next = { token: t, login, gistId };
  linkKept.value = await keep(next);
  link.value = next;
  await syncNow();
}

/** Forgets the token on this device. The gist stays on GitHub. */
export function disconnect(): void {
  removeLegacy();
  void vault.clear().catch(() => {});
  link.value = null;
  linkKept.value = true;
  syncStatus.value = { state: "off" };
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Starts the background sync triggers. */
export function startSync(): void {
  // The stored link, once the notebook it syncs is loaded: setting it runs the first sync below.
  void notebookLoaded.then(loadLink).then((saved) => {
    if (!saved || link.value) return;
    syncStatus.value = { state: "idle", at: 0 };
    link.value = saved;
  });
  let first = true;
  effect(() => {
    doc.value; // re-run on every change
    if (!link.value) return;
    if (first) {
      first = false;
      void syncNow();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 2000);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && link.value) void syncNow();
  });
  window.addEventListener("online", () => {
    if (link.value) void syncNow();
  });
}
