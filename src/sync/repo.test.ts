import { afterEach, describe, expect, test } from "bun:test";
import { GitHubError } from "./github";
import {
  cleanPath,
  decodeBase64,
  parseRepo,
  type RepoTarget,
  readFile,
  repoFileUrl,
  repoInfo,
  writeFile,
} from "./repo";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Answers every fetch with `handler`, recording the calls. */
function mockFetch(handler: Handler): { url: URL; init: RequestInit }[] {
  const calls: { url: URL; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A Contents API server holding one file, checking the sha on every write. */
function fakeContents() {
  let file: { bytes: string; sha: string } | null = null;
  let seq = 0;
  const calls = mockFetch((_url, init) => {
    if (init.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (file && body.sha !== file.sha) return json({ message: "does not match" }, 409);
      if (!file && body.sha) return json({ message: "Not Found" }, 404);
      file = { bytes: body.content, sha: `s${++seq}` };
      return json({ content: { sha: file.sha } }, 201);
    }
    if (!file) return json({ message: "Not Found" }, 404);
    // GitHub wraps the base64 at 60 columns.
    const wrapped = file.bytes.replace(/.{1,60}/g, "$&\n");
    return json({ type: "file", sha: file.sha, encoding: "base64", content: wrapped });
  });
  return { calls };
}

const target: RepoTarget = { owner: "me", repo: "notes", branch: "main", path: "data/spots.json" };

describe("parseRepo", () => {
  test("reads owner/repo and github.com links", () => {
    expect(parseRepo("maxgfr/spots")).toEqual({ owner: "maxgfr", repo: "spots" });
    expect(parseRepo("  maxgfr/spots/ ")).toEqual({ owner: "maxgfr", repo: "spots" });
    expect(parseRepo("maxgfr/spots.git")).toEqual({ owner: "maxgfr", repo: "spots" });
    expect(parseRepo("https://github.com/maxgfr/spots")).toEqual({
      owner: "maxgfr",
      repo: "spots",
    });
    expect(parseRepo("https://github.com/maxgfr/spots.git")).toEqual({
      owner: "maxgfr",
      repo: "spots",
    });
    expect(parseRepo("https://github.com/maxgfr/my.repo_1/tree/main/data")).toEqual({
      owner: "maxgfr",
      repo: "my.repo_1",
    });
    expect(parseRepo("github.com/maxgfr/spots?tab=readme")).toEqual({
      owner: "maxgfr",
      repo: "spots",
    });
  });

  test("refuses anything else", () => {
    for (const bad of [
      "",
      "spots",
      "maxgfr/",
      "/spots",
      "a/b/c",
      "max gfr/spots",
      "-max/spots",
      "maxgfr/..",
      "https://gitlab.com/maxgfr/spots",
      "https://github.com/maxgfr",
      "ftp://github.com/maxgfr/spots",
    ]) {
      expect(parseRepo(bad)).toBeNull();
    }
  });
});

test("cleanPath drops stray slashes and defaults to spots.json", () => {
  expect(cleanPath("")).toBe("spots.json");
  expect(cleanPath(" /data//spots.json ")).toBe("data/spots.json");
  expect(cleanPath("../x.json")).toBe("x.json");
});

test("repoFileUrl links the file on its branch", () => {
  expect(repoFileUrl({ ...target, branch: "feat/x", path: "my notes/spots.json" })).toBe(
    "https://github.com/me/notes/blob/feat/x/my%20notes/spots.json",
  );
});

test("repoInfo reads the default branch, the push permission and the visibility", async () => {
  mockFetch(() => json({ default_branch: "trunk", permissions: { push: false } }));
  expect(await repoInfo("t", "me", "notes")).toEqual({
    defaultBranch: "trunk",
    canPush: false,
    isPrivate: false,
  });
  mockFetch(() => json({ default_branch: "main", private: true, permissions: { push: true } }));
  expect(await repoInfo("t", "me", "notes")).toEqual({
    defaultBranch: "main",
    canPush: true,
    isPrivate: true,
  });
});

describe("readFile / writeFile", () => {
  test("round-trips UTF-8 text through base64", async () => {
    const { calls } = fakeContents();
    const text = '{"name":"Café ’ 🍕"}\n';
    const sha = await writeFile("tok", target, text);
    expect(await readFile("tok", target)).toEqual({ content: text, sha });

    const put = calls[0];
    if (!put) throw new Error("no request");
    expect(put.init.method).toBe("PUT");
    expect(put.url.pathname).toBe("/repos/me/notes/contents/data/spots.json");
    const body = JSON.parse(String(put.init.body));
    expect(body).toMatchObject({ message: "spots: sync", branch: "main" });
    expect(body.sha).toBeUndefined();
    expect(decodeBase64(body.content)).toBe(text);
    expect((put.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[1]?.url.searchParams.get("ref")).toBe("main");
  });

  test("updates with the sha and refuses a stale one", async () => {
    fakeContents();
    const first = await writeFile("tok", target, "one");
    const second = await writeFile("tok", target, "two", first);
    expect(second).not.toBe(first);
    const stale = writeFile("tok", target, "three", first);
    await expect(stale).rejects.toBeInstanceOf(GitHubError);
    await expect(stale).rejects.toMatchObject({ code: "conflict" });
    expect((await readFile("tok", target))?.content).toBe("two");
  });

  test("a missing file reads as null", async () => {
    mockFetch(() => json({ message: "Not Found" }, 404));
    expect(await readFile("tok", target)).toBeNull();
  });

  test("a 422 about the sha is a conflict, another 422 is not", async () => {
    mockFetch(() => json({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }, 422));
    await expect(writeFile("tok", target, "x")).rejects.toMatchObject({ code: "conflict" });
    mockFetch(() => json({ message: "Validation Failed" }, 422));
    await expect(writeFile("tok", target, "x")).rejects.toMatchObject({ code: "server" });
  });

  test("other failures keep their codes", async () => {
    mockFetch(() => json({ message: "Bad credentials" }, 401));
    await expect(readFile("tok", target)).rejects.toMatchObject({ code: "auth" });
    mockFetch(() => json({ message: "Resource not accessible" }, 403));
    await expect(writeFile("tok", target, "x")).rejects.toMatchObject({ code: "forbidden" });
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(readFile("tok", target)).rejects.toMatchObject({ code: "network" });
  });

  test("a file over 1 MB is fetched again as raw", async () => {
    const big = `{"note":"${"é".repeat(10)}"}`;
    const calls = mockFetch((_url, init) => {
      const accept = (init.headers as Record<string, string>).Accept;
      if (accept === "application/vnd.github.raw") return new Response(big);
      return json({ type: "file", sha: "abc", encoding: "none", content: "" });
    });
    expect(await readFile("tok", target)).toEqual({ content: big, sha: "abc" });
    expect(calls).toHaveLength(2);
  });

  test("a directory at the path is refused", async () => {
    mockFetch(() => json([{ type: "file", name: "a.json" }]));
    await expect(readFile("tok", target)).rejects.toMatchObject({ code: "not-a-backup" });
  });
});
