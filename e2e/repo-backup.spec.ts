import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { english, fakeGeocoder, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

/** One repository, tester/notes, served by a Contents API in memory that checks every sha. */
function fakeRepo() {
  const files = new Map<string, { content: string; sha: string }>();
  const commits: { message: string; sha?: string }[] = [];
  let seq = 0;
  const attach = async (target: Page | BrowserContext) => {
    await target.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      if (req.headers().authorization !== "Bearer good-token") {
        return route.fulfill({ status: 401, json: { message: "Bad credentials" } });
      }
      const url = new URL(req.url());
      const path = decodeURIComponent(url.pathname);
      const method = req.method();
      if (path === "/user") return route.fulfill({ json: { login: "tester" } });
      if (path === "/repos/tester/notes" && method === "GET") {
        return route.fulfill({ json: { default_branch: "main", permissions: { push: true } } });
      }
      const name = path.match(/^\/repos\/tester\/notes\/contents\/(.+)$/)?.[1];
      if (!name) return route.fulfill({ status: 404, json: { message: "Not Found" } });
      const file = files.get(name);
      if (method === "PUT") {
        const body = req.postDataJSON();
        commits.push({ message: body.message, sha: body.sha });
        if (body.branch !== "main") return route.fulfill({ status: 404, json: {} });
        if (file && body.sha !== file.sha) {
          return route.fulfill({ status: 409, json: { message: "does not match" } });
        }
        const sha = `sha${++seq}`;
        files.set(name, { content: Buffer.from(body.content, "base64").toString("utf8"), sha });
        return route.fulfill({ status: file ? 200 : 201, json: { content: { sha } } });
      }
      if (!file) return route.fulfill({ status: 404, json: { message: "Not Found" } });
      const content = Buffer.from(file.content, "utf8").toString("base64");
      return route.fulfill({ json: { type: "file", sha: file.sha, encoding: "base64", content } });
    });
  };
  return { files, commits, attach };
}

async function setUp(page: Page) {
  await page.goto("./#/import");
  await page.getByLabel("Token").fill("good-token");
  await page.getByLabel("Repository").fill("https://github.com/tester/notes");
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.getByRole("link", { name: "tester/notes · spots.json" })).toBeVisible();
}

test("a backup goes to a GitHub repository and comes back on another device", async ({
  page,
  browser,
}) => {
  const github = fakeRepo();
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await expect(page.getByRole("heading", { level: 1, name: "Le Petit Cambodge" })).toBeVisible();
  await setUp(page);
  await expect
    .poll(() => github.files.get("spots.json")?.content ?? "")
    .toContain("Le Petit Cambodge");
  const first = github.files.get("spots.json")?.sha;
  expect(github.commits[0]?.message).toMatch(/^spots: backup \d{4}-\d{2}-\d{2}$/);
  expect(github.commits[0]?.sha).toBeUndefined();

  // A second export updates the file with the sha it read.
  await page.getByRole("button", { name: "Export to GitHub" }).click();
  await expect.poll(() => github.files.get("spots.json")?.sha).not.toBe(first);
  expect(github.commits.at(-1)?.sha).toBe(first);

  // The token is not kept in clear text.
  const clear = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => localStorage.getItem(k)?.includes("good-token")),
  );
  expect(clear).toEqual([]);

  const other = await browser.newContext();
  const second = await other.newPage();
  await fakeGeocoder(second);
  await english(second);
  await github.attach(second);
  await setUp(second);
  // Setting up next to an existing backup leaves it alone.
  expect(github.commits).toHaveLength(2);
  await second.getByRole("button", { name: "Import from GitHub" }).click();
  await expect(second.getByText("Merged 1 place from GitHub")).toBeVisible();
  // Remembered across a reload.
  await second.reload();
  await expect(second.getByRole("button", { name: "Import from GitHub" })).toBeVisible();
  await second.goto("./");
  await expect(second.getByText("Le Petit Cambodge")).toBeVisible();
  await other.close();
});

test("a repository that is not one, or a refused token, says so", async ({ page }) => {
  const github = fakeRepo();
  await github.attach(page);
  await page.goto("./#/import");
  await page.getByLabel("Token").fill("good-token");
  await page.getByLabel("Repository").fill("not a repo");
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.getByRole("alert")).toContainText("This is not a repository");

  await page.getByLabel("Token").fill("wrong-token");
  await page.getByLabel("Repository").fill("tester/notes");
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.getByRole("alert")).toContainText("GitHub refused this token");
  expect(github.commits).toHaveLength(0);
});
