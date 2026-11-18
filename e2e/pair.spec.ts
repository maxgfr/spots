import { expect, test } from "@playwright/test";
import { connect, english, fakeGeocoder, fakeGitHub, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

test("a phone joins the sync by scanning the QR code and typing its code", async ({
  page,
  browser,
}) => {
  const github = fakeGitHub();
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await connect(page, "good-token");
  await expect(page.getByText("@tester")).toBeVisible();
  await expect
    .poll(() => [...github.gists.values()][0]?.content ?? "")
    .toContain("Le Petit Cambodge");

  await page.getByRole("button", { name: "Link a phone" }).click();
  const qr = page.getByRole("img", { name: "QR code to link a phone" });
  await expect(qr).toBeVisible();
  const url = (await qr.getAttribute("data-url")) ?? "";
  const code = (await page.locator(".pair-code").textContent()) ?? "";
  expect(url).toMatch(/^http:\/\/localhost:4317\/spots\/#pair=[\w-]+$/);
  expect(url).not.toContain("good-token");
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

  const other = await browser.newContext();
  const phone = await other.newPage();
  await github.attach(phone);
  await fakeGeocoder(phone);
  await english(phone);
  await phone.goto(url);
  await expect(phone.getByRole("heading", { name: "Link this device" })).toBeVisible();
  // The payload left the address bar as soon as it was read.
  expect(phone.url()).not.toContain("pair=");

  const field = phone.getByLabel("Pairing code");
  const wrong = `${code[0] === "A" ? "B" : "A"}${code.slice(1)}`;
  await field.fill(wrong);
  await phone.getByRole("button", { name: "Link this device" }).click();
  await expect(phone.getByRole("alert")).toContainText("not the code shown under the QR code");

  // Typed in lowercase, without the dash.
  await field.fill(code.replace("-", "").toLowerCase());
  await phone.getByRole("button", { name: "Link this device" }).click();
  await expect(phone.getByText("Linked: your places are coming in")).toBeVisible();
  await expect(phone.getByText("Le Petit Cambodge")).toBeVisible();
  // The same gist, not a new one.
  expect(github.gists.size).toBe(1);
  await phone.goto("./#/sync");
  await expect(phone.getByText("@tester")).toBeVisible();

  // Hidden, then shown again: a fresh pairing each time.
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(qr).toHaveCount(0);
  await page.getByRole("button", { name: "Link a phone" }).click();
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute("data-url")).not.toBe(url);
  await other.close();
});
