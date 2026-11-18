import { afterEach, describe, expect, test } from "bun:test";
import { alive, type Doc, emptyDoc, type Place } from "../store/model";
import { GitHubError } from "./github";
import { decodeBase64, encodeBase64, type RepoTarget } from "./repo";
import {
  checkRepo,
  type Notebook,
  parseRemote,
  REPO_SYNC_TRIES,
  serialize,
  syncRepoFile,
} from "./repoSync";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Put {
  content: string;
  sha?: string;
  message: string;
  branch: string;
}

/**
 * A repository in memory, one file, the sha checked on every write. `beforePut` runs before
 * each write is applied, to commit from "another device" in between.
 */
function fakeRepo(opts: {
  file?: string;
  isPrivate?: boolean;
  push?: boolean;
  beforePut?: (repo: { commit(text: string): void }, n: number) => void;
}) {
  let file: { text: string; sha: string } | null =
    opts.file === undefined ? null : { text: opts.file, sha: "s0" };
  let seq = 0;
  const puts: Put[] = [];
  const repo = {
    commit(text: string) {
      file = { text, sha: `s${++seq}` };
    },
    get text() {
      return file?.text ?? null;
    },
  };
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    if (path === "/user") return json({ login: "me" });
    if (path === "/repos/me/notes") {
      return json({
        default_branch: "trunk",
        private: opts.isPrivate ?? true,
        permissions: { push: opts.push ?? true },
      });
    }
    if (init.method === "PUT") {
      const body = JSON.parse(String(init.body));
      puts.push({ ...body, content: decodeBase64(body.content) });
      opts.beforePut?.(repo, puts.length);
      if (file ? body.sha !== file.sha : body.sha) {
        return json({ message: "does not match" }, 409);
      }
      repo.commit(decodeBase64(body.content));
      return json({ content: { sha: file?.sha } }, 201);
    }
    if (!file) return json({ message: "Not Found" }, 404);
    return json({
      type: "file",
      sha: file.sha,
      encoding: "base64",
      content: encodeBase64(file.text),
    });
  }) as typeof fetch;
  return { puts, repo };
}

function place(id: string, updatedAt = 1): Place {
  return {
    id,
    name: id,
    address: "",
    lat: 48.8,
    lng: 2.3,
    note: "",
    tagIds: [],
    listIds: [],
    state: "try",
    createdAt: 1,
    updatedAt,
  };
}

function docWith(...ids: string[]): Doc {
  const d = emptyDoc();
  for (const id of ids) d.places[id] = place(id);
  return d;
}

/** A notebook in memory, as the sync loop sees the real one. */
function memory(start: Doc): Notebook & { value: Doc; sets: number } {
  const nb = {
    value: start,
    sets: 0,
    get: () => nb.value,
    set(merged: Doc) {
      nb.sets++;
      nb.value = merged;
    },
  };
  return nb;
}

function names(text: string | null): string[] {
  const d = parseRemote(text);
  return d
    ? alive(d.places)
        .map((p) => p.id)
        .sort()
    : [];
}

const target: RepoTarget = { owner: "me", repo: "notes", branch: "trunk", path: "spots.json" };
const NOW = () => 1_000;

describe("syncRepoFile", () => {
  test("creates the file, without a sha, when it does not exist yet", async () => {
    const { puts, repo } = fakeRepo({});
    await syncRepoFile("t", target, memory(docWith("a")), NOW);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.sha).toBeUndefined();
    expect(puts[0]?.message).toBe("spots: sync");
    expect(puts[0]?.branch).toBe("trunk");
    expect(names(repo.text)).toEqual(["a"]);
  });

  test("merges both ways and commits with the sha it read", async () => {
    const { puts, repo } = fakeRepo({ file: serialize(docWith("b")) });
    const nb = memory(docWith("a"));
    await syncRepoFile("t", target, nb, NOW);
    expect(
      alive(nb.value.places)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.sha).toBe("s0");
    expect(names(repo.text)).toEqual(["a", "b"]);
  });

  test("leaves the file alone when it already holds the merge", async () => {
    const { puts } = fakeRepo({ file: serialize(docWith("a")) });
    await syncRepoFile("t", target, memory(docWith("a")), NOW);
    expect(puts).toHaveLength(0);
  });

  test("reads a spots backup file as well", async () => {
    const backup = JSON.stringify({ app: "spots", version: 1, exportedAt: "x", doc: docWith("b") });
    const { puts } = fakeRepo({ file: backup });
    const nb = memory(docWith());
    await syncRepoFile("t", target, nb, NOW);
    expect(alive(nb.value.places).map((p) => p.id)).toEqual(["b"]);
    // It already holds the merge: nothing to commit.
    expect(puts).toHaveLength(0);
  });

  test("a commit from another device meanwhile is read again and merged in", async () => {
    const { puts, repo } = fakeRepo({
      file: serialize(docWith("b")),
      beforePut: (r, n) => {
        if (n === 1) r.commit(serialize(docWith("b", "c")));
      },
    });
    const nb = memory(docWith("a"));
    await syncRepoFile("t", target, nb, NOW);
    expect(puts).toHaveLength(2);
    expect(puts[0]?.sha).toBe("s0");
    expect(puts[1]?.sha).toBe("s1");
    expect(names(repo.text)).toEqual(["a", "b", "c"]);
    expect(
      alive(nb.value.places)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });

  test("gives up with a conflict after a bounded number of tries", async () => {
    const { puts } = fakeRepo({
      file: serialize(docWith("b")),
      beforePut: (r, n) => r.commit(serialize(docWith("b", `x${n}`))),
    });
    const err = await syncRepoFile("t", target, memory(docWith("a")), NOW).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).code).toBe("conflict");
    expect(puts).toHaveLength(REPO_SYNC_TRIES);
  });

  test("never overwrites a file that is not a spots notebook", async () => {
    const { puts, repo } = fakeRepo({ file: '{"hello":"world"}\n' });
    const nb = memory(docWith("a"));
    const err = await syncRepoFile("t", target, nb, NOW).catch((e) => e);
    expect((err as GitHubError).code).toBe("not-a-backup");
    expect(puts).toHaveLength(0);
    expect(nb.sets).toBe(0);
    expect(repo.text).toBe('{"hello":"world"}\n');
  });

  test("an empty file is filled with the sha it has", async () => {
    const { puts, repo } = fakeRepo({ file: "" });
    await syncRepoFile("t", target, memory(docWith("a")), NOW);
    expect(puts[0]?.sha).toBe("s0");
    expect(names(repo.text)).toEqual(["a"]);
  });
});

describe("checkRepo", () => {
  const ref = { owner: "me", repo: "notes" };

  test("a private repository the account can push to: its default branch, the path cleaned", async () => {
    fakeRepo({});
    expect(await checkRepo("t", ref, "/data//spots.json")).toEqual({
      kind: "repo",
      token: "t",
      login: "me",
      owner: "me",
      repo: "notes",
      branch: "trunk",
      path: "data/spots.json",
    });
    expect((await checkRepo("t", ref, "", "main")).branch).toBe("main");
    expect((await checkRepo("t", ref, "")).path).toBe("spots.json");
  });

  test("refuses a public repository", async () => {
    fakeRepo({ isPrivate: false });
    const err = await checkRepo("t", ref, "spots.json").catch((e) => e);
    expect((err as GitHubError).code).toBe("public-repo");
  });

  test("refuses a repository the account cannot push to", async () => {
    fakeRepo({ push: false });
    const err = await checkRepo("t", ref, "spots.json").catch((e) => e);
    expect((err as GitHubError).code).toBe("no-push");
  });

  test("refuses a path that holds something else", async () => {
    fakeRepo({ file: "# notes\n" });
    const err = await checkRepo("t", ref, "spots.json").catch((e) => e);
    expect((err as GitHubError).code).toBe("not-a-backup");
    fakeRepo({ file: serialize(docWith("a")) });
    expect((await checkRepo("t", ref, "spots.json")).path).toBe("spots.json");
  });
});
