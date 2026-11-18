/**
 * Sync: pull the notebook from GitHub (one file in a private repository, or a secret gist),
 * merge it with the one here record by record (the newer edit wins, deletions included),
 * keep the result here and push it back when it differs. It runs when the app opens, when
 * it comes back to the front, when the network returns, and two seconds after a change.
 */
import { effect, signal } from "@preact/signals";
import { secureStorage } from "llm-connect";
import { sameDoc } from "../store/merge";
import { doc, notebookLoaded, replaceDoc } from "../store/store";
import { createGist, findGist, readGist, writeGist } from "./gist";
import { GitHubError, type GitHubErrorCode, whoami } from "./github";
import type { PairAccess, PairTarget } from "./pair";
import { parseRepo, REPO_FILE } from "./repo";
import {
  checkRepo,
  type Notebook,
  parseRemote,
  type RepoSyncLink,
  reconcile,
  serialize,
  syncRepoFile,
} from "./repoSync";

export type { RepoSyncLink } from "./repoSync";

/** Where the link used to be kept, the token in clear text: moved into `vault`, then removed. */
const LEGACY_KEY = "spots:github";

/** A device synced through the account's secret gist. */
export interface GistLink {
  kind: "gist";
  token: string;
  login: string;
  gistId: string;
}

export type Link = GistLink | RepoSyncLink;

/** What is kept beside the token. A link saved without `kind` (before repositories) is a gist. */
interface Prefs {
  kind?: Link["kind"];
  login?: string;
  gistId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
}

/**
 * The token encrypted at rest (AES-GCM under a non-extractable key in IndexedDB), the
 * rest beside it: every page of maxgfr.github.io can read this origin's storage.
 */
const vault = secureStorage<Prefs>({
  prefsKey: "spots:github-link",
  dbName: "spots-github",
});

function readLegacy(): GistLink | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
    if (raw && typeof raw.token === "string" && typeof raw.gistId === "string") {
      return {
        kind: "gist",
        token: raw.token,
        login: String(raw.login ?? ""),
        gistId: raw.gistId,
      };
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
  const { token, ...prefs } = l;
  const kept = await vault
    .save({ apiKey: token, model: "", ...prefs }, { rememberKey: true })
    .catch(() => false);
  return kept !== false;
}

function fromPrefs(token: string, p: Prefs): Link | null {
  const login = String(p.login ?? "");
  if (p.kind === "repo") {
    const { owner, repo, branch, path } = p;
    return owner && repo && branch && path
      ? { kind: "repo", token, login, owner, repo, branch, path }
      : null;
  }
  return p.gistId ? { kind: "gist", token, login, gistId: p.gistId } : null;
}

async function loadLink(): Promise<Link | null> {
  const old = readLegacy();
  if (old) {
    // Removed only once the encrypted copy is stored: a full storage must not lose the link.
    if (await keep(old)) removeLegacy();
    return old;
  }
  const saved = await vault.loadDraft?.().catch(() => null);
  return saved?.apiKey ? fromPrefs(saved.apiKey, saved) : null;
}

export const link = signal<Link | null>(null);
/** False when the last link could not be stored: it lasts until the page is closed. */
export const linkKept = signal(true);

export type SyncStatus =
  | { state: "off" }
  | { state: "idle"; at: number }
  | { state: "syncing" }
  | { state: "error"; code: GitHubErrorCode; at: number };

export const syncStatus = signal<SyncStatus>({ state: "off" });

/** The notebook here, replaced only if the merge changed it and nothing was edited meanwhile. */
const notebook: Notebook = {
  get: () => doc.value,
  set(merged, base) {
    if (!sameDoc(merged, base) && doc.value === base) replaceDoc(merged);
  },
};

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

async function syncGist(l: GistLink): Promise<void> {
  const remote = parseRemote(await readGist(l.token, l.gistId));
  const local = notebook.get();
  const { merged, push } = reconcile(local, remote, Date.now());
  notebook.set(merged, local);
  if (push) await writeGist(l.token, l.gistId, serialize(merged));
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
    if (l.kind === "repo") await syncRepoFile(l.token, l, notebook);
    else await syncGist(l);
    syncStatus.value = { state: "idle", at: Date.now() };
  } catch (err) {
    const code: GitHubErrorCode = err instanceof GitHubError ? err.code : "server";
    syncStatus.value = { state: "error", code, at: Date.now() };
  }
}

async function use(next: Link): Promise<void> {
  linkKept.value = await keep(next);
  link.value = next;
  await syncNow();
}

/** Checks the token, finds or creates the gist, saves the link and syncs. */
export async function connect(token: string): Promise<void> {
  const t = token.trim();
  const login = await whoami(t);
  let gistId = await findGist(t);
  if (!gistId) gistId = await createGist(t, serialize(doc.value));
  await use({ kind: "gist", token: t, login, gistId });
}

/**
 * Checks the token and the repository (it must take pushes and be private, and a file
 * already at `path` must be a spots notebook), saves the link and syncs.
 */
export async function connectRepo(
  token: string,
  repoInput: string,
  path: string = REPO_FILE,
): Promise<void> {
  const ref = parseRepo(repoInput);
  if (!ref) throw new GitHubError("bad-repo", "Not a GitHub repository");
  await use(await checkRepo(token.trim(), ref, path));
}

/** What a pairing QR code hands over for `l`: the token, and the repository file if any. */
export function pairAccess(l: Link): PairAccess {
  if (l.kind === "gist") return { token: l.token };
  const target: PairTarget = {
    kind: "repo",
    owner: l.owner,
    repo: l.repo,
    branch: l.branch,
    path: l.path,
  };
  return { token: l.token, target };
}

/** Joins the sync a pairing points to; the repository is checked again (still private…). */
export async function connectPaired({ token, target }: PairAccess): Promise<void> {
  if (!target) return connect(token);
  await use(await checkRepo(token.trim(), target, target.path, target.branch));
}

/** Forgets the token on this device. The gist or the repository file stays on GitHub. */
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
