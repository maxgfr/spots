/**
 * The sync file and the repository side of a sync: the notebook as the file holds it, one
 * merge round, and the round trip to one JSON file in a private GitHub repository. Kept apart
 * from the sync loop so it runs without the browser's storage.
 */
import { merge, normalizeDoc, purgeTombstones, sameDoc } from "../store/merge";
import type { Doc } from "../store/model";
import { GitHubError, whoami } from "./github";
import { cleanPath, type RepoRef, type RepoTarget, readFile, repoInfo, writeFile } from "./repo";

/** How many times a sync reads the file again when another device committed meanwhile. */
export const REPO_SYNC_TRIES = 3;
export const REPO_SYNC_MESSAGE = "spots: sync";

/** A device synced through one file of a private repository. */
export interface RepoSyncLink extends RepoTarget {
  kind: "repo";
  token: string;
  login: string;
}

export function serialize(d: Doc): string {
  return `${JSON.stringify({ app: "spots", version: 1, doc: d })}\n`;
}

/** The notebook in a sync file (or a backup, or a bare Doc); null when the text is none of them. */
export function parseRemote(text: string | null): Doc | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    return normalizeDoc(raw && typeof raw === "object" && "doc" in raw ? raw.doc : raw);
  } catch {
    return null;
  }
}

/** One merge round: what both sides should hold, and whether the remote side needs it. */
export function reconcile(
  local: Doc,
  remote: Doc | null,
  now: number,
): { merged: Doc; push: boolean } {
  const merged = purgeTombstones(remote ? merge(local, remote) : local, now);
  return { merged, push: !remote || !sameDoc(merged, remote) };
}

/** The notebook on this device, as a sync reads and replaces it. */
export interface Notebook {
  get(): Doc;
  /** Keeps `merged`, computed from `base` (left alone if the notebook changed meanwhile). */
  set(merged: Doc, base: Doc): void;
}

function isConflict(err: unknown): boolean {
  return err instanceof GitHubError && err.code === "conflict";
}

/**
 * One sync through the repository file: read it, merge, and commit the result only when it
 * differs. A file committed meanwhile from another device is read again and merged anew, up to
 * `REPO_SYNC_TRIES` times. A file that is not a spots notebook is never overwritten.
 */
export async function syncRepoFile(
  token: string,
  target: RepoTarget,
  notebook: Notebook,
  now: () => number = Date.now,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const file = await readFile(token, target);
    const remote = parseRemote(file?.content ?? null);
    if (file?.content.trim() && !remote) {
      throw new GitHubError("not-a-backup", "The file is not a spots notebook");
    }
    const local = notebook.get();
    const { merged, push } = reconcile(local, remote, now());
    notebook.set(merged, local);
    if (!push) return;
    try {
      await writeFile(token, target, serialize(merged), file?.sha, REPO_SYNC_MESSAGE);
      return;
    } catch (err) {
      if (!isConflict(err) || attempt >= REPO_SYNC_TRIES) throw err;
    }
  }
}

/**
 * Checks that the token's account can sync through `path` in the repository: it must take
 * pushes and be private (a public one would publish the notebook), and a file already there
 * must be a spots notebook. `branch` defaults to the repository's default branch.
 */
export async function checkRepo(
  token: string,
  ref: RepoRef,
  path: string,
  branch?: string,
): Promise<RepoSyncLink> {
  const login = await whoami(token);
  const info = await repoInfo(token, ref.owner, ref.repo);
  if (!info.canPush) throw new GitHubError("no-push", "The account cannot push to the repository");
  if (!info.isPrivate) throw new GitHubError("public-repo", "The repository is public");
  const l: RepoSyncLink = {
    kind: "repo",
    token,
    login,
    owner: ref.owner,
    repo: ref.repo,
    branch: branch || info.defaultBranch,
    path: cleanPath(path),
  };
  const file = await readFile(token, l);
  if (file?.content.trim() && !parseRemote(file.content)) {
    throw new GitHubError("not-a-backup", "The file is not a spots notebook");
  }
  return l;
}
