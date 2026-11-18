/**
 * The notebook kept in a secret GitHub Gist, through the REST API with the
 * user's own fine-grained token (account permission "Gists: read and write",
 * nothing else). One file, spots.json, in a gist found by its description, so
 * a second device finds the same gist.
 */
import { call, GitHubError, type GitHubErrorCode, whoami } from "./github";

export const GIST_FILE = "spots.json";
export const GIST_DESCRIPTION = "spots — my places (https://maxgfr.github.io/spots/)";

/** The page that creates a token with the right permission. */
export const TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=spots&description=Sync%20for%20maxgfr.github.io%2Fspots&expires_in=none&gists=write";

/** The former names, from when gists were the only backend. */
export type GistErrorCode = GitHubErrorCode;
export const GistError = GitHubError;
export type GistError = GitHubError;
export { whoami };

interface GistFile {
  content?: string;
  truncated?: boolean;
  raw_url?: string;
}

interface Gist {
  id: string;
  description: string | null;
  files: Record<string, GistFile | undefined>;
  updated_at: string;
}

/** The id of the user's spots gist, or null when there is none yet. */
export async function findGist(token: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const res = await call(token, `/gists?per_page=100&page=${page}`);
    const list = (await res.json()) as Gist[];
    const hit =
      list.find((g) => g.files[GIST_FILE] && g.description === GIST_DESCRIPTION) ??
      list.find((g) => g.files[GIST_FILE] && g.description?.startsWith("spots"));
    if (hit) return hit.id;
    if (list.length < 100) return null;
  }
  return null;
}

export async function createGist(token: string, content: string): Promise<string> {
  const res = await call(token, "/gists", {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILE]: { content } },
    }),
  });
  return ((await res.json()) as Gist).id;
}

/** The content of spots.json in the gist (null if the file is missing). */
export async function readGist(token: string, id: string): Promise<string | null> {
  const res = await call(token, `/gists/${encodeURIComponent(id)}`);
  const g = (await res.json()) as Gist;
  const f = g.files[GIST_FILE];
  if (!f) return null;
  if (!f.truncated && typeof f.content === "string") return f.content;
  if (!f.raw_url) return null;
  // A file over 1 MB comes truncated in the API answer; the raw URL has it whole.
  const raw = await fetch(f.raw_url, { cache: "no-store" }).catch(() => {
    throw new GitHubError("network", "GitHub could not be reached");
  });
  if (!raw.ok) throw new GitHubError("server", `GitHub answered ${raw.status}`);
  return raw.text();
}

export async function writeGist(token: string, id: string, content: string): Promise<void> {
  await call(token, `/gists/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
  });
}

export function gistUrl(id: string): string {
  return `https://gist.github.com/${encodeURIComponent(id)}`;
}
