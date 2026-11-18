import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanEndpoint,
  cleanKey,
  cleanTarget,
  corsConfig,
  endpointHost,
  errorCode,
  getObject,
  iamPolicy,
  objectUrl,
  putObject,
  S3Error,
  type S3Target,
} from "./s3";

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

function xmlError(code: string, status: number): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>m</Message></Error>`,
    { status, headers: { "Content-Type": "application/xml" } },
  );
}

const keys = { accessKeyId: "AKID", secretAccessKey: "secret" };
const aws: S3Target = { region: "eu-west-3", bucket: "notes", key: "spots.json", pathStyle: false };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof S3Error ? err.code : `not an S3Error: ${err}`;
  }
  return "no error";
}

describe("object URLs", () => {
  test("AWS, virtual-hosted and path style", () => {
    expect(objectUrl(aws)).toBe("https://notes.s3.eu-west-3.amazonaws.com/spots.json");
    expect(objectUrl({ ...aws, pathStyle: true })).toBe(
      "https://s3.eu-west-3.amazonaws.com/notes/spots.json",
    );
    expect(endpointHost(aws)).toBeNull();
  });

  test("a custom endpoint", () => {
    const r2: S3Target = {
      endpoint: "https://abc123.r2.cloudflarestorage.com/",
      region: "auto",
      bucket: "notes",
      key: "spots.json",
      pathStyle: true,
    };
    expect(objectUrl(r2)).toBe("https://abc123.r2.cloudflarestorage.com/notes/spots.json");
    expect(objectUrl({ ...r2, pathStyle: false })).toBe(
      "https://notes.abc123.r2.cloudflarestorage.com/spots.json",
    );
    expect(endpointHost(r2)).toBe("abc123.r2.cloudflarestorage.com");
    expect(objectUrl({ ...r2, endpoint: "http://localhost:9000" })).toBe(
      "http://localhost:9000/notes/spots.json",
    );
    expect(objectUrl({ ...r2, endpoint: "s3.fr-par.scw.cloud" })).toBe(
      "https://s3.fr-par.scw.cloud/notes/spots.json",
    );
  });

  test("keys are encoded segment by segment", () => {
    expect(objectUrl({ ...aws, key: "my backups/café ☕.json" })).toBe(
      "https://notes.s3.eu-west-3.amazonaws.com/my%20backups/caf%C3%A9%20%E2%98%95.json",
    );
    expect(objectUrl({ ...aws, key: "a+b$c!.json" })).toBe(
      "https://notes.s3.eu-west-3.amazonaws.com/a%2Bb%24c%21.json",
    );
  });

  test("cleaning", () => {
    expect(cleanKey("")).toBe("spots.json");
    expect(cleanKey(" /a//./../b.json ")).toBe("a/b.json");
    expect(cleanEndpoint("  ")).toBe("");
    expect(cleanEndpoint("https://minio.local:9000/")).toBe("https://minio.local:9000");
    expect(() => cleanEndpoint("ftp://x")).toThrow(S3Error);
    expect(cleanTarget({ ...aws, region: " ", bucket: " notes " })).toEqual({
      ...aws,
      endpoint: "",
      region: "us-east-1",
    });
    expect(() => cleanTarget({ ...aws, bucket: "a/b" })).toThrow(S3Error);
    expect(() => cleanTarget({ ...aws, region: "eu west" })).toThrow(S3Error);
  });
});

describe("requests", () => {
  test("a GET is signed, uncached, and resolves to the text and ETag", async () => {
    const calls = mockFetch(
      () => new Response('{"a":1}', { headers: { ETag: '"abc"' } }) as Response,
    );
    expect(await getObject(keys, aws)).toEqual({ content: '{"a":1}', etag: '"abc"' });
    const { init } = calls[0] as { init: RequestInit };
    const h = init.headers as Record<string, string>;
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    expect(h.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-3\/s3\/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/,
    );
    expect(h["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(h["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(h.host).toBeUndefined();
  });

  test("a missing object is null", async () => {
    mockFetch(() => xmlError("NoSuchKey", 404));
    expect(await getObject(keys, aws)).toBeNull();
    mockFetch(() => new Response(null, { status: 404 }));
    expect(await getObject(keys, aws)).toBeNull();
  });

  test("S3 error codes map to error codes", async () => {
    const cases: [string, number, string][] = [
      ["NoSuchBucket", 404, "not-found"],
      ["SignatureDoesNotMatch", 403, "auth"],
      ["InvalidAccessKeyId", 403, "auth"],
      ["AccessDenied", 403, "auth"],
      ["AuthorizationHeaderMalformed", 400, "bad-config"],
      ["PermanentRedirect", 301, "bad-config"],
      ["InternalError", 500, "server"],
    ];
    for (const [code, status, expected] of cases) {
      mockFetch(() => xmlError(code, status));
      expect([code, await codeOf(getObject(keys, aws))]).toEqual([code, expected]);
      expect([code, await codeOf(putObject(keys, aws, "{}"))]).toEqual([code, expected]);
    }
    mockFetch(() => new Response("", { status: 403 }));
    expect(await codeOf(getObject(keys, aws))).toBe("auth");
  });

  test("no answer is a network error that names CORS", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    let caught: unknown;
    await getObject(keys, aws).catch((err) => {
      caught = err;
    });
    expect(caught).toBeInstanceOf(S3Error);
    expect((caught as S3Error).code).toBe("network");
    expect((caught as S3Error).message).toContain("CORS");
  });

  test("UTF-8 content goes and comes back whole, its hash signed", async () => {
    const stored = new Map<string, Uint8Array<ArrayBuffer>>();
    const calls = mockFetch(async (url, init) => {
      if (init.method === "PUT") {
        const body = new Uint8Array(init.body as Uint8Array);
        const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex");
        const h = init.headers as Record<string, string>;
        if (h["x-amz-content-sha256"] !== hash) return xmlError("XAmzContentSHA256Mismatch", 400);
        stored.set(url.pathname, body);
        return new Response(null, { headers: { ETag: '"v1"' } });
      }
      const body = stored.get(url.pathname);
      return body ? new Response(body, { headers: { ETag: '"v1"' } }) : xmlError("NoSuchKey", 404);
    });
    const target = { ...aws, key: "dossier/été.json" };
    const content = JSON.stringify({ name: "Café de l'Été ☕ 東京" });
    expect(await getObject(keys, target)).toBeNull();
    expect(await putObject(keys, target, content)).toBe('"v1"');
    expect(await getObject(keys, target)).toEqual({ content, etag: '"v1"' });
    const put = calls.find((c) => c.init.method === "PUT");
    expect((put?.init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBe(
      "application/json",
    );
    expect(put?.url.pathname).toBe("/dossier/%C3%A9t%C3%A9.json");
  });
});

describe("bucket setup snippets", () => {
  test("CORS allows this origin only", () => {
    expect(JSON.parse(corsConfig("https://maxgfr.github.io"))).toEqual([
      {
        AllowedOrigins: ["https://maxgfr.github.io"],
        AllowedMethods: ["GET", "PUT", "HEAD"],
        AllowedHeaders: ["*"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3000,
      },
    ]);
  });

  test("the policy reads and writes one object", () => {
    const p = JSON.parse(iamPolicy("notes", "/backups/spots.json"));
    expect(p.Statement).toEqual([
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject"],
        Resource: "arn:aws:s3:::notes/backups/spots.json",
      },
    ]);
    expect(JSON.parse(iamPolicy("", "")).Statement[0].Resource).toBe(
      "arn:aws:s3:::<bucket>/spots.json",
    );
  });
});

test("errorCode reads the XML", () => {
  expect(errorCode("<Error><Code> NoSuchKey </Code></Error>")).toBe("NoSuchKey");
  expect(errorCode("nothing")).toBeNull();
});
