/**
 * The GitHub REST API as both sync backends use it: one fetch helper that
 * sends the user's token to api.github.com only and turns every failure into
 * a `GitHubError` with a code the screens can explain.
 */

export const API = "https://api.github.com";

export type GitHubErrorCode =
  | "auth"
  | "forbidden"
  | "not-found"
  | "rate-limit"
  | "network"
  | "server"
  /** The file changed on GitHub since it was read (stale sha). */
  | "conflict"
  /** The account cannot push to the repository. */
  | "no-push"
  /** Not a repository name nor a github.com repository link. */
  | "bad-repo"
  /** The file at the chosen path is not a spots backup. */
  | "not-a-backup";

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CallInit extends Omit<RequestInit, "headers"> {
  /** Extra headers, over the default ones (an `Accept` for the raw media type…). */
  headers?: Record<string, string>;
  /** Map 409, and 422 about a sha, to `conflict` (writes of the Contents API). */
  conflicts?: boolean;
}

/** Fetches an API path with the token; resolves to an ok response only. */
export async function call(token: string, path: string, init: CallInit = {}): Promise<Response> {
  const { headers, conflicts, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("network", "GitHub could not be reached");
  }
  if (res.ok) return res;
  if (res.status === 401) throw new GitHubError("auth", "GitHub refused the token");
  if (res.status === 403 || res.status === 429) {
    const left = res.headers.get("x-ratelimit-remaining");
    if (left === "0" || res.status === 429)
      throw new GitHubError("rate-limit", "GitHub rate limit reached");
    throw new GitHubError("forbidden", "The token lacks a permission");
  }
  if (res.status === 404) throw new GitHubError("not-found", "Not found on GitHub");
  if (conflicts && (res.status === 409 || (res.status === 422 && (await aboutSha(res))))) {
    throw new GitHubError("conflict", "The file changed on GitHub");
  }
  throw new GitHubError("server", `GitHub answered ${res.status}`);
}

async function aboutSha(res: Response): Promise<boolean> {
  const text = await res.text().catch(() => "");
  return /\bsha\b/i.test(text);
}

/** The login of the token's account. */
export async function whoami(token: string): Promise<string> {
  const res = await call(token, "/user");
  const j = (await res.json()) as { login?: string };
  return j.login ?? "";
}
