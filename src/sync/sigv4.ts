/**
 * AWS Signature Version 4 for the Authorization header, with WebCrypto only:
 * the request is reduced to a canonical form, hashed into a string to sign,
 * and signed with a key derived from the secret, the day, the region and the
 * service. The secret never leaves the browser, only the signature does.
 */

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignInput {
  method: string;
  url: string | URL;
  region: string;
  credentials: Credentials;
  /** Headers to sign besides host, x-amz-content-sha256 and x-amz-date. */
  headers?: Record<string, string>;
  /** The body, hashed into x-amz-content-sha256 (none: the hash of the empty string). */
  body?: string | Uint8Array;
  service?: string;
  date?: Date;
}

const encoder = new TextEncoder();

function bytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex SHA-256, as the canonical request and x-amz-content-sha256 want it. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes(data)));
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key instanceof ArrayBuffer ? key : bytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, encoder.encode(data));
}

/** RFC 3986 encoding: everything but A-Z a-z 0-9 - . _ ~ is percent-encoded. */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The path with every segment encoded once, slashes kept (S3 does not double-encode).
 * Segments arrive as the URL holds them: they are decoded first so that `$` and `%24`
 * end up the same.
 */
export function canonicalPath(pathname: string): string {
  if (!pathname) return "/";
  return pathname
    .split("/")
    .map((s) => {
      let raw = s;
      try {
        raw = decodeURIComponent(s);
      } catch {
        // A lone "%" stays as written, and is encoded.
      }
      return uriEncode(raw);
    })
    .join("/");
}

/** The query sorted by name then value, both encoded; a name without value gets "=". */
export function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** `20130524T000000Z`. */
export function amzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export interface Signed {
  /** The headers to send: Authorization, x-amz-date, x-amz-content-sha256 and the signed extras (not host). */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/** Signs a request; the browser sets Host itself, from the URL. */
export async function signRequest(input: SignInput): Promise<Signed> {
  const url = new URL(String(input.url));
  const service = input.service ?? "s3";
  const when = amzDate(input.date ?? new Date());
  const day = when.slice(0, 8);
  const payloadHash = await sha256Hex(input.body ?? "");

  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) all[k.toLowerCase()] = v;
  all.host = url.host;
  all["x-amz-content-sha256"] = payloadHash;
  all["x-amz-date"] = when;
  const names = Object.keys(all).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${String(all[n]).trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", when, scope, await sha256Hex(canonicalRequest)].join(
    "\n",
  );

  let key = await hmac(encoder.encode(`AWS4${input.credentials.secretAccessKey}`), day);
  key = await hmac(key, input.region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));

  const headers: Record<string, string> = {};
  for (const n of names) if (n !== "host") headers[n] = String(all[n]);
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope},` +
    `SignedHeaders=${signedHeaders},Signature=${signature}`;
  return { headers, canonicalRequest, stringToSign, signature };
}
