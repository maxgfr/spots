/**
 * One JSON file in a GitHub repository of the user's choosing, through the
 * REST Contents API, with a fine-grained token limited to "Contents: read and
 * write" on that repository. Every write is a commit, so the repository's
 * history keeps every version; the file's sha guards against overwriting a
 * change made meanwhile by another device.
 */
import { call, GitHubError } from "./github";

export const REPO_FILE = "spots.json";

/** The page that creates a token that can read and write the contents of repositories. */
export const REPO_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=spots%20repo&description=Backup%20for%20maxgfr.github.io%2Fspots&expires_in=none&contents=write";

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Where the notebook lives: a file on a branch of a repository. */
export interface RepoTarget extends RepoRef {
  branch: string;
  path: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** `owner/repo`, or a github.com link to the repository (or anything inside it); null otherwise. */
export function parseRepo(input: string): RepoRef | null {
  let s = input.trim();
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.*)$/i);
  if (url) s = url[1] ?? "";
  else if (/^[a-z]+:\/\//i.test(s)) return null;
  const [owner = "", raw = ""] = s.split(/[/?#]/);
  const repo = raw.replace(/\.git$/i, "");
  // `owner/repo` alone: anything after it only comes from a link.
  if (!url && s.replace(/\/+$/, "").split("/").length !== 2) return null;
  if (!OWNER.test(owner) || !NAME.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

/** The file's path inside the repository, without stray slashes; `spots.json` when empty. */
export function cleanPath(path: string): string {
  const p = path
    .trim()
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return p || REPO_FILE;
}

function repoPath({ owner, repo }: RepoRef): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Each segment of a path encoded, the slashes kept. */
function segments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function contentsPath(t: RepoTarget): string {
  return `${repoPath(t)}/contents/${segments(t.path)}`;
}

/** The repository's default branch, whether the account may push to it, and whether it is private. */
export async function repoInfo(
  token: string,
  owner: string,
  repo: string,
): Promise<{ defaultBranch: string; canPush: boolean; isPrivate: boolean }> {
  const res = await call(token, repoPath({ owner, repo }));
  const j = (await res.json()) as {
    default_branch?: string;
    private?: boolean;
    permissions?: { push?: boolean };
  };
  return {
    defaultBranch: j.default_branch || "main",
    canPush: j.permissions?.push === true,
    isPrivate: j.private === true,
  };
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

interface ContentsFile {
  type?: string;
  sha?: string;
  content?: string;
  encoding?: string;
}

/** The file's text and sha, or null when it does not exist yet. */
export async function readFile(
  token: string,
  target: RepoTarget,
): Promise<{ content: string; sha: string } | null> {
  const at = `${contentsPath(target)}?ref=${encodeURIComponent(target.branch)}`;
  let res: Response;
  try {
    res = await call(token, at);
  } catch (err) {
    if (err instanceof GitHubError && err.code === "not-found") return null;
    throw err;
  }
  const j = (await res.json()) as ContentsFile | ContentsFile[];
  if (Array.isArray(j) || j.type !== "file" || !j.sha) {
    throw new GitHubError("not-a-backup", "The path is not a file");
  }
  if (j.encoding === "base64" && typeof j.content === "string") {
    return { content: decodeBase64(j.content), sha: j.sha };
  }
  // Over 1 MB the answer leaves the content out (encoding "none"): the raw media type has it whole.
  const raw = await call(token, at, { headers: { Accept: "application/vnd.github.raw" } });
  return { content: await raw.text(), sha: j.sha };
}

/** Commits the file (created without `sha`, updated with it) and resolves to its new sha. */
export async function writeFile(
  token: string,
  target: RepoTarget,
  content: string,
  sha?: string,
  message = "spots: sync",
): Promise<string> {
  const res = await call(token, contentsPath(target), {
    method: "PUT",
    conflicts: true,
    body: JSON.stringify({
      message,
      content: encodeBase64(content),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  const j = (await res.json()) as { content?: { sha?: string } };
  return j.content?.sha ?? "";
}

/** The file's page on github.com. */
export function repoFileUrl(t: RepoTarget): string {
  return `https://github.com/${segments(`${t.owner}/${t.repo}`)}/blob/${segments(t.branch)}/${segments(t.path)}`;
}
