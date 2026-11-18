/**
 * The JSON backup kept in a GitHub repository, on demand: "export" commits the
 * whole notebook to one file, "import" merges that file back in (the newer edit
 * of every record wins). Nothing runs in the background. The repository, the
 * file and the token are remembered on this device, the token encrypted.
 */
import { signal } from "@preact/signals";
import { secureStorage } from "llm-connect";
import { exportBackup, parseBackup } from "../import/backup";
import { alive } from "../store/model";
import { doc, mergeIn } from "../store/store";
import { GitHubError, whoami } from "./github";
import type { PairBackup } from "./pair";
import {
  cleanPath,
  parseRepo,
  REPO_FILE,
  type RepoTarget,
  readFile,
  repoInfo,
  writeFile,
} from "./repo";

export interface RepoLink extends RepoTarget {
  token: string;
  login: string;
}

type Prefs = Partial<Omit<RepoLink, "token">>;

/**
 * The token encrypted at rest (AES-GCM under a non-extractable key in IndexedDB), the
 * rest beside it: every page of maxgfr.github.io can read this origin's storage.
 */
const vault = secureStorage<Prefs>({
  prefsKey: "spots:github-repo",
  dbName: "spots-github-repo",
});

/** The remembered repository; undefined until it is loaded. */
export const repoTarget = signal<RepoLink | null | undefined>(undefined);
/** False when the last repository could not be stored: it lasts until the page is closed. */
export const repoTargetKept = signal(true);

/** Loads the remembered repository once, into `repoTarget`. */
export async function loadRepoTarget(): Promise<RepoLink | null> {
  if (repoTarget.value !== undefined) return repoTarget.value;
  const saved = await vault.loadDraft?.().catch(() => null);
  const { owner, repo, branch, path } = saved ?? {};
  const found =
    saved?.apiKey && owner && repo && branch && path
      ? { token: saved.apiKey, login: String(saved.login ?? ""), owner, repo, branch, path }
      : null;
  // A save made while loading wins.
  if (repoTarget.value === undefined) repoTarget.value = found;
  return repoTarget.value ?? null;
}

/** Remembers the repository; false when the browser kept it for this page only. */
export async function saveRepoTarget(l: RepoLink): Promise<boolean> {
  const { token, ...prefs } = l;
  const kept = await vault
    .save({ apiKey: token, model: "", ...prefs }, { rememberKey: true })
    .catch(() => false);
  repoTarget.value = l;
  repoTargetKept.value = kept !== false;
  return repoTargetKept.value;
}

/**
 * Remembers the backup repository a pairing handed over. `login` is the account when it is
 * already known (the backup uses the sync's token); otherwise GitHub is asked, and the
 * repository is kept without a name when it cannot answer. False when kept for this page only.
 */
export async function savePairedBackup(b: PairBackup, login?: string): Promise<boolean> {
  const { token, owner, repo, branch, path } = b;
  const who = login ?? (await whoami(token).catch(() => ""));
  return saveRepoTarget({ token, login: who, owner, repo, branch, path });
}

/** Forgets the repository and its token on this device. The file stays on GitHub. */
export async function forgetRepoTarget(): Promise<void> {
  repoTarget.value = null;
  repoTargetKept.value = true;
  await vault.clear().catch(() => {});
}

function isConflict(err: unknown): boolean {
  return err instanceof GitHubError && err.code === "conflict";
}

/**
 * Commits the notebook as a backup file and resolves to the file's new sha. A file
 * already there must be a spots backup: anything else is left alone.
 */
export async function exportToRepo(token: string, target: RepoTarget): Promise<string> {
  const now = Date.now();
  const content = exportBackup(doc.value, now);
  const message = `spots: backup ${new Date(now).toISOString().slice(0, 10)}`;
  const put = async () => {
    const current = await readFile(token, target);
    if (current?.content.trim() && !parseBackup(current.content)) {
      throw new GitHubError("not-a-backup", "The file is not a spots backup");
    }
    return writeFile(token, target, content, current?.sha, message);
  };
  try {
    return await put();
  } catch (err) {
    // Written meanwhile from elsewhere: read the new sha and try once more.
    if (!isConflict(err)) throw err;
    return put();
  }
}

export interface ImportCounts {
  places: number;
  lists: number;
  tags: number;
}

/** Merges the backup file into the notebook; resolves to what the file holds. */
export async function importFromRepo(token: string, target: RepoTarget): Promise<ImportCounts> {
  const file = await readFile(token, target);
  if (!file) throw new GitHubError("not-found", "The file is not in the repository");
  const backup = parseBackup(file.content);
  if (!backup) throw new GitHubError("not-a-backup", "The file is not a spots backup");
  mergeIn(backup);
  return {
    places: alive(backup.places).length,
    lists: alive(backup.lists).length,
    tags: alive(backup.tags).length,
  };
}

/**
 * Checks the token and the repository (it must exist and take pushes), then remembers
 * it. The notebook is exported only when the file is not there yet: a backup made from
 * another device is left for the user to import (or export over). Resolves to whether
 * it exported.
 */
export async function setUpRepo(
  token: string,
  repoInput: string,
  path: string = REPO_FILE,
): Promise<{ link: RepoLink; exported: boolean }> {
  const t = token.trim();
  const ref = parseRepo(repoInput);
  if (!ref) throw new GitHubError("bad-repo", "Not a GitHub repository");
  const login = await whoami(t);
  const info = await repoInfo(t, ref.owner, ref.repo);
  if (!info.canPush) throw new GitHubError("no-push", "The account cannot push to the repository");
  const l: RepoLink = {
    ...ref,
    branch: info.defaultBranch,
    path: cleanPath(path),
    token: t,
    login,
  };
  const file = await readFile(t, l);
  if (file?.content.trim() && !parseBackup(file.content)) {
    throw new GitHubError("not-a-backup", "The file is not a spots backup");
  }
  const exported = !file?.content.trim();
  if (exported) await exportToRepo(t, l);
  await saveRepoTarget(l);
  return { link: l, exported };
}
