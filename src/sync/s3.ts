/**
 * One JSON object in an S3 bucket of the user's choosing: AWS, or any
 * S3-compatible service (Cloudflare R2, Scaleway, OVH, MinIO…) through its
 * endpoint. Requests go straight from the browser, signed with SigV4, so the
 * bucket must allow this site in its CORS configuration. Every failure is an
 * `S3Error` with a code the screen can explain.
 */
import { type Credentials, signRequest, uriEncode } from "./sigv4";

export const S3_FILE = "spots.json";
export const S3_REGION = "us-east-1";

export interface S3Target {
  /** Empty for AWS; the base URL of an S3-compatible service otherwise. */
  endpoint?: string;
  region: string;
  bucket: string;
  key: string;
  /** `endpoint/bucket/key` rather than `bucket.endpoint/key`. */
  pathStyle: boolean;
}

export type S3Credentials = Credentials;

export type S3ErrorCode =
  /** The keys were refused, or they cannot read or write the object. */
  | "auth"
  /** The bucket does not exist. */
  | "not-found"
  /** No answer: offline, or (much more often) the bucket's CORS does not allow this site. */
  | "network"
  /** The endpoint, region, bucket or key cannot be right. */
  | "bad-config"
  /** The object is not a spots backup. */
  | "not-a-backup"
  | "server";

export class S3Error extends Error {
  constructor(
    readonly code: S3ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The endpoint as a base URL without trailing slash ("" for AWS); https when no scheme is given. */
export function cleanEndpoint(input: string | undefined): string {
  const s = (input ?? "").trim().replace(/\/+$/, "");
  if (!s) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new S3Error("bad-config", "Not an endpoint URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new S3Error("bad-config", "The endpoint must be an http(s) URL");
  }
  if (url.search || url.hash) throw new S3Error("bad-config", "The endpoint has a query");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The key without leading slashes nor empty, "." or ".." segments; the default when empty. */
export function cleanKey(input: string | undefined): string {
  const segments = (input ?? "")
    .trim()
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..");
  return segments.length ? segments.join("/") : S3_FILE;
}

/** Trims and checks every field, and fills the defaults. */
export function cleanTarget(t: S3Target): S3Target {
  const endpoint = cleanEndpoint(t.endpoint);
  const region = t.region.trim() || S3_REGION;
  const bucket = t.bucket.trim();
  if (!/^[a-z0-9-]+$/i.test(region)) throw new S3Error("bad-config", "Not a region");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(bucket)) throw new S3Error("bad-config", "Not a bucket");
  return { endpoint, region, bucket, key: cleanKey(t.key), pathStyle: t.pathStyle };
}

function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

/** The object's URL, virtual-hosted or path-style, on AWS or on the endpoint. */
export function objectUrl(t: S3Target): string {
  const key = encodeKey(t.key);
  const endpoint = cleanEndpoint(t.endpoint);
  if (!endpoint) {
    return t.pathStyle
      ? `https://s3.${t.region}.amazonaws.com/${t.bucket}/${key}`
      : `https://${t.bucket}.s3.${t.region}.amazonaws.com/${key}`;
  }
  if (t.pathStyle) return `${endpoint}/${t.bucket}/${key}`;
  const base = new URL(endpoint);
  return `${base.protocol}//${t.bucket}.${base.host}${base.pathname.replace(/\/+$/, "")}/${key}`;
}

/** The host to show for a custom endpoint, or null on AWS. */
export function endpointHost(t: S3Target): string | null {
  const endpoint = cleanEndpoint(t.endpoint);
  return endpoint ? new URL(endpoint).host : null;
}

/** The `<Code>` of an S3 XML error, when there is one. */
export function errorCode(xml: string): string | null {
  return xml.match(/<Code>\s*([^<]*?)\s*<\/Code>/)?.[1] ?? null;
}

const AUTH = new Set([
  "SignatureDoesNotMatch",
  "InvalidAccessKeyId",
  "AccessDenied",
  "InvalidToken",
  "ExpiredToken",
  "RequestTimeTooSkewed",
]);
const BAD_CONFIG = new Set([
  "AuthorizationHeaderMalformed",
  "PermanentRedirect",
  "IncorrectEndpoint",
  "InvalidBucketName",
  "InvalidRegionName",
  "InvalidRequest",
]);

async function send(
  credentials: S3Credentials,
  target: S3Target,
  method: "GET" | "PUT",
  body?: Uint8Array,
): Promise<Response> {
  const url = objectUrl(target);
  const signed = await signRequest({
    method,
    url,
    region: target.region,
    credentials,
    ...(body ? { body } : {}),
  });
  try {
    return await fetch(url, {
      method,
      headers: {
        ...signed.headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: body as BodyInit } : {}),
      cache: "no-store",
    });
  } catch {
    throw new S3Error(
      "network",
      "The bucket could not be reached: offline, or its CORS configuration does not allow this site",
    );
  }
}

/** Turns a failed answer into an `S3Error`; null for a missing object. */
async function failure(res: Response): Promise<S3Error | null> {
  const code = errorCode(await res.text().catch(() => ""));
  if (code === "NoSuchBucket") return new S3Error("not-found", "The bucket does not exist");
  if (code === "NoSuchKey" || (res.status === 404 && !code)) return null;
  if ((code && AUTH.has(code)) || res.status === 401 || res.status === 403) {
    return new S3Error("auth", `S3 refused the keys${code ? ` (${code})` : ""}`);
  }
  if ((code && BAD_CONFIG.has(code)) || (res.status >= 300 && res.status < 400)) {
    return new S3Error("bad-config", `S3 refused the bucket's address${code ? ` (${code})` : ""}`);
  }
  if (res.status === 404) return new S3Error("not-found", `Not found (${code})`);
  return new S3Error("server", `S3 answered ${res.status}${code ? ` (${code})` : ""}`);
}

/** The object's text and ETag, or null when it does not exist yet. */
export async function getObject(
  credentials: S3Credentials,
  target: S3Target,
): Promise<{ content: string; etag: string } | null> {
  const res = await send(credentials, target, "GET");
  if (!res.ok) {
    const err = await failure(res);
    if (err) throw err;
    return null;
  }
  return { content: await res.text(), etag: res.headers.get("etag") ?? "" };
}

/** Writes the object as JSON and resolves to its new ETag. */
export async function putObject(
  credentials: S3Credentials,
  target: S3Target,
  content: string,
): Promise<string> {
  const res = await send(credentials, target, "PUT", new TextEncoder().encode(content));
  if (!res.ok) {
    throw (await failure(res)) ?? new S3Error("not-found", "The bucket does not exist");
  }
  return res.headers.get("etag") ?? "";
}

/** The CORS rules the bucket needs for this site, as the AWS console takes them. */
export function corsConfig(origin: string): string {
  return JSON.stringify(
    [
      {
        AllowedOrigins: [origin],
        AllowedMethods: ["GET", "PUT", "HEAD"],
        AllowedHeaders: ["*"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3000,
      },
    ],
    null,
    2,
  );
}

/** An IAM policy that can read and write this one object, and nothing else. */
export function iamPolicy(bucket: string, key: string): string {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject"],
          Resource: `arn:aws:s3:::${bucket || "<bucket>"}/${cleanKey(key)}`,
        },
      ],
    },
    null,
    2,
  );
}
