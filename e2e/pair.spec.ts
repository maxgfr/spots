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

test("the QR code hands over the GitHub backup repository too", async ({ page, browser }) => {
  const github = fakeGitHub({ "tester/notes": { private: true } });
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await page.goto("./#/import");
  await page.getByText("Back up to a GitHub repository").click();
  await page.getByLabel("Token").fill("good-token");
  await page.getByLabel("Repository").fill("tester/notes");
  await page.getByRole("button", { name: "Save to GitHub" }).click();
  await expect(page.getByRole("link", { name: "tester/notes · spots.json" })).toBeVisible();

  await connect(page, "good-token");
  await expect(page.getByText("@tester")).toBeVisible();
  await page.getByRole("button", { name: "Link a phone" }).click();
  const qr = page.getByRole("img", { name: "QR code to link a phone" });
  await expect(qr).toBeVisible();
  await expect(
    page.getByText("give access to your sync and to your GitHub backup repository"),
  ).toBeVisible();
  const url = (await qr.getAttribute("data-url")) ?? "";
  const code = (await page.locator(".pair-code").textContent()) ?? "";
  expect(url).not.toContain("good-token");
  expect(url).not.toContain("notes");

  const other = await browser.newContext();
  const phone = await other.newPage();
  await github.attach(phone);
  await fakeGeocoder(phone);
  await english(phone);
  await phone.goto(url);
  await phone.getByLabel("Pairing code").fill(code);
  await phone.getByRole("button", { name: "Link this device" }).click();
  await expect(phone.getByText("The GitHub backup is set up too.")).toBeVisible();
  await expect(phone.getByText("Le Petit Cambodge")).toBeVisible();
  // The same backup repository, remembered across a reload.
  await phone.goto("./#/import");
  await expect(phone.getByRole("link", { name: "tester/notes · spots.json" })).toBeVisible();
  await expect(phone.locator(".notice").getByText("@tester")).toBeVisible();
  await other.close();
});

test("a device not linked yet opens a pasted pairing link", async ({ page, browser }) => {
  const github = fakeGitHub();
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await connect(page, "good-token");
  await expect(page.getByText("@tester")).toBeVisible();
  await page.getByRole("button", { name: "Link a phone" }).click();
  const qr = page.getByRole("img", { name: "QR code to link a phone" });
  await expect(qr).toBeVisible();
  const url = (await qr.getAttribute("data-url")) ?? "";
  const code = (await page.locator(".pair-code").textContent()) ?? "";

  const other = await browser.newContext();
  const phone = await other.newPage();
  await github.attach(phone);
  await fakeGeocoder(phone);
  await english(phone);
  await phone.goto("./#/sync");
  await expect(phone.getByText("Link from another device")).toBeVisible();
  await expect(phone.getByRole("button", { name: "Scan the QR code" })).toBeVisible();

  const field = phone.getByLabel("Or paste its link");
  await field.fill(url.replace("http://localhost:4317", "https://example.com"));
  await phone.getByRole("button", { name: "Open the link" }).click();
  await expect(phone.getByRole("alert")).toContainText("This is not a spots pairing link");

  await field.fill(` ${url} `);
  await phone.getByRole("button", { name: "Open the link" }).click();
  await expect(phone.getByRole("heading", { name: "Link this device" })).toBeVisible();
  expect(phone.url()).not.toContain("pair=");
  await phone.getByLabel("Pairing code").fill(code);
  await phone.getByRole("button", { name: "Link this device" }).click();
  await expect(phone.getByText("Linked: your places are coming in")).toBeVisible();
  await expect(phone.getByText("Le Petit Cambodge")).toBeVisible();
  expect(github.gists.size).toBe(1);
  await phone.goto("./#/sync");
  await expect(phone.getByText("@tester")).toBeVisible();
  await other.close();
});

test("a refused camera says so, and the link can still be pasted", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    });
  });
  await page.goto("./#/sync");
  const scan = page.getByRole("button", { name: "Scan the QR code" });
  await scan.click();
  await expect(page.getByRole("alert")).toContainText("Camera access was refused");
  await expect(scan).toBeFocused();
  await expect(page.getByLabel("Or paste its link")).toBeVisible();
});
