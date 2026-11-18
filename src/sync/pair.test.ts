import { describe, expect, test } from "bun:test";
import { fromBase64Url, toBase64Url } from "../share/share";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  createPairing,
  formatCode,
  isCode,
  newCode,
  normalizeCode,
  openPairing,
  PAIR_ITERATIONS,
  PAIR_TTL_MS,
  PAIR_VERSION,
  type PairBackup,
  PairError,
  type PairTarget,
  readPairLink,
} from "./pair";

const BASE = "https://maxgfr.github.io/spots/";
const NOW = 1_800_000_000_000;

/** A payload sealed by hand, byte for byte as the format says, around any JSON. */
async function seal(plain: unknown, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array([PAIR_VERSION]);
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeCode(code)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PAIR_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: head },
      key,
      new TextEncoder().encode(JSON.stringify(plain)),
    ),
  );
  const bytes = new Uint8Array([...head, ...salt, ...iv, ...sealed]);
  return toBase64Url(bytes);
}

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof PairError) return err.code;
    throw err;
  }
  throw new Error("expected a PairError");
}

describe("pairing codes", () => {
  test("are drawn from the unambiguous alphabet", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect(isCode(c)).toBe(true);
    }
  });

  test("format in two groups and read back whatever the case, spaces and dashes", () => {
    expect(formatCode("ABCD2345")).toBe("ABCD-2345");
    expect(normalizeCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeCode("ab cd 23 45")).toBe("ABCD2345");
    expect(isCode("abcd-2345")).toBe(true);
    expect(isCode("ABCD-234")).toBe(false);
    expect(isCode("ABCD-2340")).toBe(false);
    expect(isCode("OBCD-2345")).toBe(false);
  });
});

describe("pairing", () => {
  test("round trip: the phone gets the token back with the code", async () => {
    const { url, code, payload } = await createPairing({ token: "github_pat_secret" }, NOW, BASE);
    expect(url).toBe(`${BASE}#pair=${payload}`);
    expect(url).not.toContain("github_pat_secret");
    expect(await openPairing(payload, code, NOW + 1000)).toEqual({ token: "github_pat_secret" });
    // Typed in lowercase with the dash, or with spaces.
    expect(await openPairing(payload, formatCode(code).toLowerCase(), NOW)).toEqual({
      token: "github_pat_secret",
    });
    expect(await openPairing(payload, `${code.slice(0, 4)} ${code.slice(4)}`, NOW)).toEqual({
      token: "github_pat_secret",
    });
  });

  test("round trip with a repository: the phone gets the same file", async () => {
    const target: PairTarget = {
      kind: "repo",
      owner: "maxgfr",
      repo: "spots-data",
      branch: "main",
      path: "data/spots.json",
    };
    const { url, code, payload } = await createPairing(
      { token: "github_pat_secret", target },
      NOW,
      BASE,
    );
    expect(url).not.toContain("spots-data");
    expect(await openPairing(payload, code, NOW)).toEqual({ token: "github_pat_secret", target });
  });

  test("a payload made before repositories could sync still opens, as a gist", async () => {
    const code = newCode();
    const payload = await seal({ token: "github_pat_old", exp: NOW + PAIR_TTL_MS }, code);
    expect(await openPairing(payload, code, NOW)).toEqual({ token: "github_pat_old" });
  });

  test("a malformed repository target is refused", async () => {
    const code = newCode();
    const good: PairTarget = {
      kind: "repo",
      owner: "me",
      repo: "notes",
      branch: "main",
      path: "spots.json",
    };
    const bad: unknown[] = [
      null,
      "me/notes",
      { ...good, kind: "gist" },
      { ...good, owner: "" },
      { ...good, owner: "me/other" },
      { ...good, repo: "../x" },
      { ...good, repo: 42 },
      { ...good, branch: "" },
      { ...good, path: "" },
      { ...good, path: "/etc/../spots.json" },
    ];
    for (const target of bad) {
      const payload = await seal({ token: "t", exp: NOW + PAIR_TTL_MS, target }, code);
      expect(await failure(openPairing(payload, code, NOW))).toBe("malformed");
    }
    const payload = await seal({ token: "t", exp: NOW + PAIR_TTL_MS, target: good }, code);
    expect(await openPairing(payload, code, NOW)).toEqual({ token: "t", target: good });
  });

  test("the repository backup comes along, with its own token", async () => {
    const target: PairTarget = {
      kind: "repo",
      owner: "maxgfr",
      repo: "spots-data",
      branch: "main",
      path: "spots.json",
    };
    const backup: PairBackup = {
      token: "github_pat_backup",
      owner: "maxgfr",
      repo: "notes",
      branch: "trunk",
      path: "backups/spots.json",
    };
    const { url, code, payload } = await createPairing(
      { token: "github_pat_sync", target, backup },
      NOW,
      BASE,
    );
    expect(url).not.toContain("github_pat_backup");
    expect(url).not.toContain("notes");
    expect(await openPairing(payload, code, NOW)).toEqual({
      token: "github_pat_sync",
      target,
      backup,
    });
    // Beside a gist sync too.
    const gist = await createPairing({ token: "github_pat_sync", backup }, NOW, BASE);
    expect(await openPairing(gist.payload, gist.code, NOW)).toEqual({
      token: "github_pat_sync",
      backup,
    });
  });

  test("a backup with the sync's own token does not carry it twice", async () => {
    const backup: PairBackup = {
      token: "github_pat_same",
      owner: "me",
      repo: "notes",
      branch: "main",
      path: "spots.json",
    };
    const one = await createPairing({ token: "github_pat_same", backup }, NOW, BASE);
    const two = await createPairing(
      { token: "github_pat_same", backup: { ...backup, token: "github_pat_other" } },
      NOW,
      BASE,
    );
    expect(one.payload.length).toBeLessThan(two.payload.length);
    expect(await openPairing(one.payload, one.code, NOW)).toEqual({
      token: "github_pat_same",
      backup,
    });
  });

  test("a payload made before backups were handed over opens without one", async () => {
    const code = newCode();
    const target: PairTarget = {
      kind: "repo",
      owner: "me",
      repo: "notes",
      branch: "main",
      path: "spots.json",
    };
    const payload = await seal({ token: "t", exp: NOW + PAIR_TTL_MS, target }, code);
    const access = await openPairing(payload, code, NOW);
    expect(access).toEqual({ token: "t", target });
    expect("backup" in access).toBe(false);
  });

  test("a malformed backup is refused", async () => {
    const code = newCode();
    const good = { token: "b", owner: "me", repo: "notes", branch: "main", path: "spots.json" };
    const bad: unknown[] = [
      null,
      "me/notes",
      42,
      { ...good, token: "" },
      { ...good, token: 7 },
      { ...good, owner: "" },
      { ...good, owner: "me/other" },
      { ...good, repo: "../x" },
      { ...good, branch: "" },
      { ...good, path: "" },
      { ...good, path: "/etc/../spots.json" },
    ];
    for (const backup of bad) {
      const payload = await seal({ token: "t", exp: NOW + PAIR_TTL_MS, backup }, code);
      expect(await failure(openPairing(payload, code, NOW))).toBe("malformed");
    }
    const payload = await seal({ token: "t", exp: NOW + PAIR_TTL_MS, backup: good }, code);
    expect(await openPairing(payload, code, NOW)).toEqual({ token: "t", backup: good });
  });

  test("a base with a fragment already loses it", async () => {
    const { url, payload } = await createPairing({ token: "t" }, NOW, `${BASE}#/sync`);
    expect(url).toBe(`${BASE}#pair=${payload}`);
  });

  test("each pairing has its own code and payload", async () => {
    const a = await createPairing({ token: "t" }, NOW, BASE);
    const b = await createPairing({ token: "t" }, NOW, BASE);
    expect(a.payload).not.toBe(b.payload);
    expect(a.code).not.toBe(b.code);
  });

  test("a wrong code is refused", async () => {
    const { code, payload } = await createPairing({ token: "t" }, NOW, BASE);
    const other = code[0] === "A" ? `B${code.slice(1)}` : `A${code.slice(1)}`;
    expect(await failure(openPairing(payload, other, NOW))).toBe("bad-code");
    expect(await failure(openPairing(payload, "ABC", NOW))).toBe("bad-code");
    expect(await failure(openPairing(payload, "", NOW))).toBe("bad-code");
  });

  test("the QR stops working after ten minutes", async () => {
    const { code, payload } = await createPairing({ token: "t" }, NOW, BASE);
    expect(await openPairing(payload, code, NOW + PAIR_TTL_MS)).toEqual({ token: "t" });
    expect(await failure(openPairing(payload, code, NOW + PAIR_TTL_MS + 1))).toBe("expired");
  });

  test("an altered payload is refused", async () => {
    const { code, payload } = await createPairing({ token: "t" }, NOW, BASE);
    const bytes = fromBase64Url(payload) as Uint8Array;
    const flip = (i: number) => {
      const b = bytes.slice();
      b[i] = (b[i] ?? 0) ^ 1;
      return toBase64Url(b);
    };
    // The version byte, the salt, the iv and the ciphertext.
    expect(await failure(openPairing(flip(0), code, NOW))).toBe("malformed");
    expect(await failure(openPairing(flip(1), code, NOW))).toBe("bad-code");
    expect(await failure(openPairing(flip(20), code, NOW))).toBe("bad-code");
    expect(await failure(openPairing(flip(bytes.length - 1), code, NOW))).toBe("bad-code");
    // Cut short, not base64url, or empty.
    expect(await failure(openPairing(payload.slice(0, 30), code, NOW))).toBe("malformed");
    expect(await failure(openPairing("not a payload!", code, NOW))).toBe("malformed");
    expect(await failure(openPairing("", code, NOW))).toBe("malformed");
  });
});

describe("pairing links", () => {
  test("the payload is read from a link to this app", async () => {
    const { url, payload } = await createPairing({ token: "t" }, NOW, BASE);
    expect(readPairLink(url, BASE)).toBe(payload);
    expect(readPairLink(`  ${url}\n`, BASE)).toBe(payload);
    expect(readPairLink(`${BASE}index.html#pair=${payload}`, BASE)).toBe(payload);
    expect(readPairLink(`${BASE}?from=qr#pair=${payload}`, BASE)).toBe(payload);
    expect(
      readPairLink(`http://localhost:4317/spots/#pair=abc_-9`, "http://localhost:4317/spots/"),
    ).toBe("abc_-9");
  });

  test("anything else is not a pairing link", () => {
    for (const input of [
      "",
      "ABCD-2345",
      "not a link",
      "https://example.com/spots/#pair=abc",
      "http://maxgfr.github.io/spots/#pair=abc",
      "https://maxgfr.github.io/other/#pair=abc",
      "https://maxgfr.github.io/#pair=abc",
      `${BASE}#/sync`,
      `${BASE}#pair=`,
      `${BASE}#pair=abc def`,
      `${BASE}#pair=abc&x=1`,
      `${BASE}#/share/abc`,
    ]) {
      expect(readPairLink(input, BASE)).toBeNull();
    }
  });
});
