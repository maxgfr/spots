/**
 * Linking a phone with a QR code: a notebook does not fit in one, so the code carries the
 * sync access instead. The computer encrypts the GitHub token (and, for a repository, where
 * the file is) under a one-time pairing code it shows beside the QR; the phone opens the
 * link, is asked for the code and connects to the same sync. The payload rides in the URL
 * fragment, so it never reaches a server, and it stops working after ten minutes.
 *
 * Payload: base64url of version (1 byte) | salt (16) | iv (12) | AES-GCM ciphertext of the
 * JSON `{ token, exp, target?, backup? }`, under a key derived from the code with PBKDF2-SHA-256.
 * The version byte is authenticated with the ciphertext. `target` is the repository file; without
 * it (every payload made before repositories could sync) the sync is the account's gist.
 * `backup` is the repository the computer backs up to by hand (`{ token?, owner, repo, branch,
 * path }`, the token left out when it is the sync's own, to keep the QR code light); payloads
 * made before it was handed over have none, and apps made before then ignore it.
 */
import { fromBase64Url, toBase64Url } from "../share/share";
import { cleanPath, parseRepo, type RepoTarget } from "./repo";

export const PAIR_VERSION = 1;

/** How long a QR code works once shown. */
export const PAIR_TTL_MS = 10 * 60_000;

/**
 * PBKDF2 rounds, the OWASP figure for SHA-256: about 70 ms on a recent laptop and well under
 * a second on a phone, while every guess at the code costs an attacker as much.
 */
export const PAIR_ITERATIONS = 600_000;

/** Digits and capitals without 0, O, 1, I and L, so a code reads back without doubt. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;

const SALT = 16;
const IV = 12;
const TAG = 16;

export type PairErrorCode =
  /** The code is not the one shown with the QR, or the payload was altered. */
  | "bad-code"
  /** The QR is older than ten minutes. */
  | "expired"
  /** Not a pairing payload. */
  | "malformed";

export class PairError extends Error {
  constructor(readonly code: PairErrorCode) {
    super(`Pairing failed: ${code}`);
  }
}

/** The repository file a pairing points to. */
export interface PairTarget extends RepoTarget {
  kind: "repo";
}

/** The repository backup a pairing hands over, with the token that writes to it. */
export interface PairBackup extends RepoTarget {
  token: string;
}

/**
 * What a pairing hands over: the token, the repository file unless the sync is a gist, and
 * the repository the computer backs up to, when it has one.
 */
export interface PairAccess {
  token: string;
  target?: PairTarget;
  backup?: PairBackup;
}

/** A repository file as it came out of the payload, or null when it is not a well-formed one. */
function readRepoFile(raw: unknown): RepoTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const { owner, repo, branch, path } = raw as Record<string, unknown>;
  if (typeof owner !== "string" || typeof repo !== "string") return null;
  if (typeof branch !== "string" || !branch || typeof path !== "string" || !path) return null;
  const ref = parseRepo(`${owner}/${repo}`);
  if (ref?.owner !== owner || ref.repo !== repo || cleanPath(path) !== path) return null;
  return { owner, repo, branch, path };
}

/** The target as it came out of the payload, or null when it is not a well-formed one. */
function readTarget(raw: unknown): PairTarget | null {
  const file = readRepoFile(raw);
  return file && (raw as { kind?: unknown }).kind === "repo" ? { kind: "repo", ...file } : null;
}

/** The backup as it came out of the payload (no token: the sync's), or null when malformed. */
function readBackup(raw: unknown, syncToken: string): PairBackup | null {
  const file = readRepoFile(raw);
  if (!file) return null;
  const { token } = raw as { token?: unknown };
  if (token === undefined) return { token: syncToken, ...file };
  return typeof token === "string" && token ? { token, ...file } : null;
}

/**
 * The payload of a spots pairing link, or null when `input` is not one: a link to this app
 * (`base`, its address without the fragment) whose fragment is `#pair=<payload>`.
 */
export function readPairLink(input: string, base: string): string | null {
  let url: URL;
  let app: URL;
  try {
    url = new URL(input.trim());
    app = new URL(base);
  } catch {
    return null;
  }
  const page = (p: string) => p.replace(/index\.html$/, "");
  if (url.origin !== app.origin || page(url.pathname) !== page(app.pathname)) return null;
  const payload = url.hash.match(/^#pair=([A-Za-z0-9_-]+)$/)?.[1];
  return payload ?? null;
}

/** What the user typed, as a bare code: capitals, no spaces nor dashes. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/** A code as shown, in two groups: `ABCD-EFGH`. */
export function formatCode(code: string): string {
  const c = normalizeCode(code);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** True when the input normalizes to a code of the right length and alphabet. */
export function isCode(input: string): boolean {
  const c = normalizeCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}

/** A fresh random code, each character drawn without bias from the alphabet. */
export function newCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/** The backup as the payload carries it: only its fields, the token left out when it is the sync's. */
function backupField({ token, owner, repo, branch, path }: PairBackup, syncToken: string) {
  return { ...(token === syncToken ? {} : { token }), owner, repo, branch, path };
}

async function keyFor(code: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeCode(code)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PAIR_ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * A pairing for `access`: the link to put in the QR (`base` is the app's address, the payload
 * goes in its fragment) and the code to show beside it.
 */
export async function createPairing(
  { token, target, backup }: PairAccess,
  now: number,
  base: string,
): Promise<{ url: string; code: string; payload: string }> {
  const code = newCode();
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const head = new Uint8Array([PAIR_VERSION]);
  const plain = new TextEncoder().encode(
    JSON.stringify({
      token,
      exp: now + PAIR_TTL_MS,
      ...(target ? { target } : {}),
      ...(backup ? { backup: backupField(backup, token) } : {}),
    }),
  );
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: head },
      await keyFor(code, salt),
      plain,
    ),
  );
  const bytes = new Uint8Array(1 + SALT + IV + sealed.length);
  bytes.set(head, 0);
  bytes.set(salt, 1);
  bytes.set(iv, 1 + SALT);
  bytes.set(sealed, 1 + SALT + IV);
  const payload = toBase64Url(bytes);
  return { url: `${base.replace(/#.*$/, "")}#pair=${payload}`, code, payload };
}

/** The access a pairing carries, or a `PairError` saying why it cannot be had. */
export async function openPairing(payload: string, code: string, now: number): Promise<PairAccess> {
  const bytes = fromBase64Url(payload.trim());
  if (!bytes || bytes.length < 1 + SALT + IV + TAG + 1 || bytes[0] !== PAIR_VERSION) {
    throw new PairError("malformed");
  }
  if (!isCode(code)) throw new PairError("bad-code");
  const salt = bytes.slice(1, 1 + SALT);
  const iv = bytes.slice(1 + SALT, 1 + SALT + IV);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: bytes.slice(0, 1) },
      await keyFor(code, salt),
      bytes.slice(1 + SALT + IV),
    );
  } catch {
    // A wrong code and an altered payload look the same to AES-GCM.
    throw new PairError("bad-code");
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new PairError("malformed");
  }
  const { token, exp, target, backup } = (data ?? {}) as {
    token?: unknown;
    exp?: unknown;
    target?: unknown;
    backup?: unknown;
  };
  if (typeof token !== "string" || !token || typeof exp !== "number") {
    throw new PairError("malformed");
  }
  // No target: a gist sync, as in every payload made before repositories could sync.
  const repo = target === undefined ? null : readTarget(target);
  if (target !== undefined && !repo) throw new PairError("malformed");
  // No backup: the computer has none, or the payload was made before backups were handed over.
  const kept = backup === undefined ? null : readBackup(backup, token);
  if (backup !== undefined && !kept) throw new PairError("malformed");
  if (now > exp) throw new PairError("expired");
  return { token, ...(repo ? { target: repo } : {}), ...(kept ? { backup: kept } : {}) };
}
