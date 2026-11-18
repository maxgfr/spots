import { describe, expect, test } from "bun:test";
import { amzDate, canonicalPath, canonicalQuery, sha256Hex, signRequest, uriEncode } from "./sigv4";

/**
 * The examples of "Signature Calculations for the Authorization Header: Transferring
 * Payload in a Single Chunk" in the Amazon S3 API Reference (sig-v4-header-based-auth).
 */
const credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const date = new Date("2013-05-24T00:00:00Z");
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SCOPE = "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request";

describe("the AWS documentation examples", () => {
  test("GET Object", async () => {
    const s = await signRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      credentials,
      headers: { Range: "bytes=0-9" },
      date,
    });
    expect(s.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY,
      ].join("\n"),
    );
    expect(s.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      ].join("\n"),
    );
    expect(s.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(s.headers.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${SCOPE},SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41`,
    );
    expect(s.headers["x-amz-content-sha256"]).toBe(EMPTY);
    expect(s.headers["x-amz-date"]).toBe("20130524T000000Z");
    expect(s.headers.range).toBe("bytes=0-9");
    expect(s.headers.host).toBeUndefined();
  });

  test("PUT Object", async () => {
    const s = await signRequest({
      method: "PUT",
      url: "https://examplebucket.s3.amazonaws.com/test$file.text",
      region: "us-east-1",
      credentials,
      headers: {
        Date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      body: "Welcome to Amazon S3.",
      date,
    });
    expect(s.headers["x-amz-content-sha256"]).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    expect(s.canonicalRequest.split("\n").slice(0, 2)).toEqual(["PUT", "/test%24file.text"]);
    expect(s.stringToSign.split("\n").at(-1)).toBe(
      "9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d",
    );
    expect(s.headers.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${SCOPE},SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class,Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd`,
    );
  });

  test("GET Bucket Lifecycle", async () => {
    const s = await signRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/?lifecycle",
      region: "us-east-1",
      credentials,
      date,
    });
    expect(s.canonicalRequest.split("\n").slice(0, 3)).toEqual(["GET", "/", "lifecycle="]);
    expect(s.stringToSign.split("\n").at(-1)).toBe(
      "9766c798316ff2757b517bc739a67f6213b4ab36dd5da2f94eaebf79c77395ca",
    );
    expect(s.signature).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });

  test("Get Bucket (List Objects)", async () => {
    const s = await signRequest({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2",
      region: "us-east-1",
      credentials,
      date,
    });
    expect(s.canonicalRequest.split("\n")[2]).toBe("max-keys=2&prefix=J");
    expect(s.stringToSign.split("\n").at(-1)).toBe(
      "df57d21db20da04d7fa30298dd4488ba3a2b47ca3a489c74750e0f1e7df1b9b7",
    );
    expect(s.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("canonical pieces", () => {
  test("only unreserved characters stay as they are", () => {
    expect(uriEncode("aZ09-._~")).toBe("aZ09-._~");
    expect(uriEncode("a b/c!'()*+=")).toBe("a%20b%2Fc%21%27%28%29%2A%2B%3D");
    expect(uriEncode("é")).toBe("%C3%A9");
  });

  test("path segments are encoded once, slashes kept", () => {
    expect(canonicalPath("")).toBe("/");
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("/my%20dir/caf%C3%A9.json")).toBe("/my%20dir/caf%C3%A9.json");
    expect(canonicalPath("/a$b/c+d")).toBe("/a%24b/c%2Bd");
    expect(canonicalPath("/100%")).toBe("/100%25");
  });

  test("the query is sorted and encoded", () => {
    expect(canonicalQuery(new URLSearchParams("b=2&a=1&a=0&c"))).toBe("a=0&a=1&b=2&c=");
    expect(canonicalQuery(new URLSearchParams({ k: "a b/c" }))).toBe("k=a%20b%2Fc");
  });

  test("dates and hashes", async () => {
    expect(amzDate(new Date("2024-02-29T13:04:05.678Z"))).toBe("20240229T130405Z");
    expect(await sha256Hex("")).toBe(EMPTY);
    expect(await sha256Hex(new TextEncoder().encode("Welcome to Amazon S3."))).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
  });

  test("a port is part of the signed host", async () => {
    const s = await signRequest({
      method: "GET",
      url: "http://localhost:9000/bucket/spots.json",
      region: "us-east-1",
      credentials,
      date,
    });
    expect(s.canonicalRequest).toContain("\nhost:localhost:9000\n");
  });
});
