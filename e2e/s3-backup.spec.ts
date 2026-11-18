import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { signRequest } from "../src/sync/sigv4";
import { english, fakeGeocoder, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

const ACCESS_KEY = "AKIATESTKEY";
const SECRET = "test-secret/key+value";
const HOST = "notes.s3.eu-west-3.amazonaws.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag",
};

function xmlError(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${code}</Message></Error>`;
}

/**
 * One bucket, notes in eu-west-3, served in memory: every request must carry a
 * SigV4 Authorization header, which is checked against the known secret.
 */
function fakeS3() {
  const objects = new Map<string, { content: string; etag: string }>();
  const puts: string[] = [];
  const auths: string[] = [];
  let seq = 0;
  const attach = async (target: Page | BrowserContext) => {
    await target.route(`https://${HOST}/**`, async (route) => {
      const req = route.request();
      const headers = req.headers();
      const auth = headers.authorization ?? "";
      auths.push(auth);
      if (!auth.startsWith("AWS4-HMAC-SHA256 ")) {
        return route.fulfill({ status: 403, headers: CORS, body: xmlError("AccessDenied") });
      }
      const date = headers["x-amz-date"] ?? "";
      const when = new Date(
        date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
      );
      const body = req.postDataBuffer();
      const expected = await signRequest({
        method: req.method(),
        url: req.url(),
        region: "eu-west-3",
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET },
        ...(body ? { body: new Uint8Array(body) } : {}),
        date: when,
      });
      if (auth !== expected.headers.authorization) {
        return route.fulfill({
          status: 403,
          headers: CORS,
          body: xmlError("SignatureDoesNotMatch"),
        });
      }
      const key = decodeURIComponent(new URL(req.url()).pathname.slice(1));
      if (req.method() === "PUT") {
        puts.push(key);
        const etag = `"e${++seq}"`;
        objects.set(key, { content: body?.toString("utf8") ?? "", etag });
        return route.fulfill({ status: 200, headers: { ...CORS, ETag: etag }, body: "" });
      }
      const object = objects.get(key);
      if (!object)
        return route.fulfill({ status: 404, headers: CORS, body: xmlError("NoSuchKey") });
      return route.fulfill({
        status: 200,
        headers: { ...CORS, ETag: object.etag, "Content-Type": "application/json" },
        body: object.content,
      });
    });
  };
  return { objects, puts, auths, attach };
}

async function fill(page: Page, secret = SECRET) {
  await page.goto("./#/import");
  await page.getByText("Back up to S3").click();
  await page.getByLabel("Region", { exact: true }).fill("eu-west-3");
  await page.getByLabel("Bucket", { exact: true }).fill("notes");
  await page.getByLabel("Access key ID", { exact: true }).fill(ACCESS_KEY);
  await page.getByLabel("Secret access key", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Save to S3" }).click();
}

async function setUp(page: Page) {
  await fill(page);
  await expect(page.getByText("notes/spots.json")).toBeVisible();
}

test("a backup goes to an S3 bucket and comes back on another device", async ({
  page,
  browser,
}) => {
  const s3 = fakeS3();
  await s3.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await expect(page.getByRole("heading", { level: 1, name: "Le Petit Cambodge" })).toBeVisible();
  await setUp(page);
  await expect
    .poll(() => s3.objects.get("spots.json")?.content ?? "")
    .toContain("Le Petit Cambodge");
  expect(s3.puts).toEqual(["spots.json"]);

  // A second export writes the object again.
  await page.getByRole("button", { name: "Export to S3" }).click();
  await expect.poll(() => s3.puts.length).toBe(2);

  // The secret is never sent, nor kept in clear text.
  expect(s3.auths.every((a) => a.startsWith("AWS4-HMAC-SHA256 Credential=AKIATESTKEY/"))).toBe(
    true,
  );
  expect(s3.auths.some((a) => a.includes(SECRET))).toBe(false);
  const clear = await page.evaluate(
    (secret) => Object.keys(localStorage).filter((k) => localStorage.getItem(k)?.includes(secret)),
    SECRET,
  );
  expect(clear).toEqual([]);

  const other = await browser.newContext();
  const second = await other.newPage();
  await fakeGeocoder(second);
  await english(second);
  await s3.attach(second);
  await setUp(second);
  // Setting up next to an existing backup leaves it alone.
  expect(s3.puts).toHaveLength(2);
  await second.getByRole("button", { name: "Import from S3" }).click();
  await expect(second.getByText("Merged 1 place from S3")).toBeVisible();
  // Remembered across a reload.
  await second.reload();
  await expect(second.getByRole("button", { name: "Import from S3" })).toBeVisible();
  await second.goto("./");
  await expect(second.getByText("Le Petit Cambodge")).toBeVisible();
  await other.close();
});

test("a wrong secret key says so", async ({ page }) => {
  const s3 = fakeS3();
  await s3.attach(page);
  await fill(page, "not-the-secret");
  await expect(page.getByRole("alert")).toContainText("S3 refused these keys");
  expect(s3.auths.length).toBeGreaterThan(0);
  expect(s3.puts).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Save to S3" })).toBeVisible();
});

test("the bucket setup gives the CORS rules for this site", async ({ page }) => {
  await page.goto("./#/import");
  await page.getByText("Back up to S3").click();
  await page.getByText("Bucket setup").click();
  const origin = new URL(page.url()).origin;
  const [cors, policy] = [page.locator("pre").first(), page.locator("pre").nth(1)];
  await expect(cors).toContainText(`"AllowedOrigins": [ "${origin}" ]`);
  await expect(cors).toContainText('"ExposeHeaders": [ "ETag" ]');
  await page.getByLabel("Bucket", { exact: true }).fill("notes");
  await expect(policy).toContainText('"Resource": "arn:aws:s3:::notes/spots.json"');
});
