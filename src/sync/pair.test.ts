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
  PAIR_TTL_MS,
  PairError,
} from "./pair";

const BASE = "https://maxgfr.github.io/spots/";
const NOW = 1_800_000_000_000;

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
    const { url, code, payload } = await createPairing("github_pat_secret", NOW, BASE);
    expect(url).toBe(`${BASE}#pair=${payload}`);
    expect(url).not.toContain("github_pat_secret");
    expect(await openPairing(payload, code, NOW + 1000)).toBe("github_pat_secret");
    // Typed in lowercase with the dash, or with spaces.
    expect(await openPairing(payload, formatCode(code).toLowerCase(), NOW)).toBe(
      "github_pat_secret",
    );
    expect(await openPairing(payload, `${code.slice(0, 4)} ${code.slice(4)}`, NOW)).toBe(
      "github_pat_secret",
    );
  });

  test("a base with a fragment already loses it", async () => {
    const { url, payload } = await createPairing("t", NOW, `${BASE}#/sync`);
    expect(url).toBe(`${BASE}#pair=${payload}`);
  });

  test("each pairing has its own code and payload", async () => {
    const a = await createPairing("t", NOW, BASE);
    const b = await createPairing("t", NOW, BASE);
    expect(a.payload).not.toBe(b.payload);
    expect(a.code).not.toBe(b.code);
  });

  test("a wrong code is refused", async () => {
    const { code, payload } = await createPairing("t", NOW, BASE);
    const other = code[0] === "A" ? `B${code.slice(1)}` : `A${code.slice(1)}`;
    expect(await failure(openPairing(payload, other, NOW))).toBe("bad-code");
    expect(await failure(openPairing(payload, "ABC", NOW))).toBe("bad-code");
    expect(await failure(openPairing(payload, "", NOW))).toBe("bad-code");
  });

  test("the QR stops working after ten minutes", async () => {
    const { code, payload } = await createPairing("t", NOW, BASE);
    expect(await openPairing(payload, code, NOW + PAIR_TTL_MS)).toBe("t");
    expect(await failure(openPairing(payload, code, NOW + PAIR_TTL_MS + 1))).toBe("expired");
  });

  test("an altered payload is refused", async () => {
    const { code, payload } = await createPairing("t", NOW, BASE);
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
