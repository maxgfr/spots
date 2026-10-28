import { expect, type Page, test } from "@playwright/test";

/** Photon and Nominatim are answered locally so the tests do not depend on them. */
async function fakeGeocoder(page: Page) {
  await page.route("https://photon.komoot.io/**", (route) => {
    const url = new URL(route.request().url());
    const lng = Number(url.searchParams.get("lon") ?? 2.3705);
    const lat = Number(url.searchParams.get("lat") ?? 48.8738);
    const feature = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: url.pathname.includes("reverse") ? [lng, lat] : [2.3705, 48.8738],
      },
      properties: {
        osm_type: "N",
        osm_id: 1,
        osm_key: "amenity",
        osm_value: "restaurant",
        name: "Le Petit Cambodge",
        housenumber: "20",
        street: "Rue Alibert",
        postcode: "75010",
        city: "Paris",
      },
    };
    return route.fulfill({ json: { type: "FeatureCollection", features: [feature] } });
  });
}

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem("spots:lang")) localStorage.setItem("spots:lang", "en");
  });
});

test("a first visit explains how to pin", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Your notebook is empty" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import from Google Maps" })).toBeVisible();
});

test("search, pin, tag, and it survives a reload", async ({ page }) => {
  await page.goto("./");
  await page.getByPlaceholder("Search a place, paste a link…").fill("petit cambodge");
  await page.getByRole("button", { name: /Le Petit Cambodge/ }).click();
  await expect(page.getByRole("heading", { name: "New place" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Le Petit Cambodge");
  // The restaurant kind suggested the Food tag.
  await expect(page.getByRole("button", { name: "Food", pressed: true })).toBeVisible();
  await page.getByLabel("Note").fill("Bo bun");
  await page.getByRole("button", { name: "Pin it" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Le Petit Cambodge" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Le Petit Cambodge" })).toBeVisible();
  await expect(page.getByText("Bo bun")).toBeVisible();
});

test("a pasted Google Maps link starts a place at its coordinates", async ({ page }) => {
  await page.goto("./");
  await page
    .getByPlaceholder("Search a place, paste a link…")
    .fill(
      "https://www.google.com/maps/place/Le+Syndicat/@48.87,2.35,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d48.8703!4d2.3555",
    );
  await page.getByRole("button", { name: /Pin this link/ }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Le Syndicat");
});

test("a list shared by link opens in another browser and can be added", async ({
  page,
  browser,
}) => {
  // Catch the link the app copies instead of the system share sheet.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => {
          (window as unknown as { copied: string }).copied = t;
        },
      },
      configurable: true,
    });
  });
  await page.goto("./");
  await page.getByPlaceholder("Search a place, paste a link…").fill("petit cambodge");
  await page.getByRole("button", { name: /Le Petit Cambodge/ }).click();
  await page.getByRole("button", { name: "New list" }).click();
  await page.getByLabel("List name").fill("Weekend");
  await page.getByLabel("List name").press("Enter");
  await page.getByRole("button", { name: "Pin it" }).click();
  await page.goto("./#/lists");
  await page.getByRole("button", { name: /Weekend/ }).click();
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Copy the link" })).toBeVisible();
  const url = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(url).toContain("#/share/");

  const other = await browser.newContext();
  const visitor = await other.newPage();
  await fakeGeocoder(visitor);
  await visitor.addInitScript(() => localStorage.setItem("spots:lang", "en"));
  await visitor.goto(url);
  await expect(visitor.getByRole("heading", { name: "Weekend" })).toBeVisible();
  await visitor.getByRole("button", { name: "Add to my notebook" }).click();
  await expect(visitor.getByText("Le Petit Cambodge")).toBeVisible();
  await other.close();
});

test("the menu switches language", async ({ page }) => {
  await page.goto("./#/menu");
  await page.getByRole("button", { name: "Français" }).click();
  await expect(page.getByText("Ce qui sort de cet appareil")).toBeVisible();
});
