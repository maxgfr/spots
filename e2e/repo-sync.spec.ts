import { expect, test } from "@playwright/test";
import { connectRepo, english, fakeGeocoder, fakeGitHub, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

test("a private repository is the recommended sync, and two devices meet in its file", async ({
  page,
  browser,
}) => {
  const github = fakeGitHub({ "tester/spots-data": { private: true } });
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await page.goto("./#/sync");
  await expect(page.getByRole("button", { name: "Private repository" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("link", { name: "new repository" })).toHaveAttribute(
    "href",
    "https://github.com/new?name=spots-data&visibility=private",
  );
  // The gist is offered, honestly.
  await page.getByRole("button", { name: "Secret gist" }).click();
  await expect(page.getByText("anyone who has its link can read it")).toBeVisible();

  await connectRepo(page, "good-token", "https://github.com/tester/spots-data");
  await expect(page.getByText("@tester")).toBeVisible();
  await expect(page.getByText("tester/spots-data · spots.json")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the file" })).toHaveAttribute(
    "href",
    "https://github.com/tester/spots-data/blob/main/spots.json",
  );
  await expect
    .poll(() => github.files.get("tester/spots-data/spots.json")?.content ?? "")
    .toContain("Le Petit Cambodge");
  expect(github.commits[0]?.message).toBe("spots: sync");
  expect(github.commits[0]?.sha).toBeUndefined();
  expect(github.gists.size).toBe(0);
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
  await connectRepo(second, "good-token", "tester/spots-data");
  await expect(second.getByText("tester/spots-data · spots.json")).toBeVisible();
  await second.goto("./");
  await expect(second.getByText("Le Petit Cambodge")).toBeVisible();

  // Deleted on the second device: committed with the sha it read…
  const before = github.files.get("tester/spots-data/spots.json")?.sha;
  await second.getByText("Le Petit Cambodge").click();
  await second.getByRole("button", { name: "Edit" }).click();
  await second.getByRole("button", { name: "Delete this place" }).click();
  await expect
    .poll(() => github.files.get("tester/spots-data/spots.json")?.content ?? "", {
      timeout: 10_000,
    })
    .toContain('"deletedAt"');
  expect(github.commits.at(-1)?.sha).toBe(before);
  // …and gone on the first once it syncs, the link remembered across a reload.
  await page.reload();
  await expect(page.getByText("tester/spots-data · spots.json")).toBeVisible();
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.goto("./");
  await expect(page.getByText("Le Petit Cambodge")).toHaveCount(0);
  await other.close();
});

test("a public repository is refused, and nothing is written to it", async ({ page }) => {
  const github = fakeGitHub({ "tester/open": { private: false } });
  await github.attach(page);
  await connectRepo(page, "good-token", "tester/open");
  await expect(page.getByRole("alert")).toContainText(
    "This repository is public: anyone could read your places.",
  );
  await expect(page.getByLabel("Repository")).toBeVisible();
  expect(github.commits).toHaveLength(0);

  await page.getByLabel("Repository").fill("not a repo");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This is not a repository");
});

test("a phone joins the repository sync by QR code", async ({ page, browser }) => {
  const github = fakeGitHub({ "tester/spots-data": { private: true } });
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await connectRepo(page, "good-token", "tester/spots-data");
  await expect(page.getByText("tester/spots-data · spots.json")).toBeVisible();
  await expect
    .poll(() => github.files.get("tester/spots-data/spots.json")?.content ?? "")
    .toContain("Le Petit Cambodge");

  await page.getByRole("button", { name: "Link a phone" }).click();
  const qr = page.getByRole("img", { name: "QR code to link a phone" });
  await expect(qr).toBeVisible();
  await expect(page.getByText("give access to your sync")).toBeVisible();
  const url = (await qr.getAttribute("data-url")) ?? "";
  const code = (await page.locator(".pair-code").textContent()) ?? "";
  expect(url).not.toContain("good-token");
  expect(url).not.toContain("spots-data");

  const other = await browser.newContext();
  const phone = await other.newPage();
  await github.attach(phone);
  await fakeGeocoder(phone);
  await english(phone);
  await phone.goto(url);
  await phone.getByLabel("Pairing code").fill(code);
  await phone.getByRole("button", { name: "Link this device" }).click();
  await expect(phone.getByText("Linked: your places are coming in")).toBeVisible();
  await expect(phone.getByText("Le Petit Cambodge")).toBeVisible();
  // The same repository file, no gist.
  expect(github.gists.size).toBe(0);
  await phone.goto("./#/sync");
  await expect(phone.getByText("tester/spots-data · spots.json")).toBeVisible();
  await other.close();
});
