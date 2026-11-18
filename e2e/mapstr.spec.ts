import { expect, type Page, test } from "@playwright/test";
import { english, fakeGeocoder } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

// A made-up Mapstr export: the CSV has stars and dates, the GeoJSON positions and tag colours.
const csv = [
  "date,name,address,icon,userComment,rating,tags,photos",
  '"2024-03-02T19:30:00.000Z","Chez Odette","12 Rue des Lilas, 75019 Paris, France","restaurant","Great ravioli","4.5","Restaurant",""',
  '"2024-04-10T08:00:00.000Z","Pain d’Or","3 Rue du Four, 75006 Paris, France","bakery","","","To try#Bakery",""',
  '"2024-05-01T12:00:00.000Z","Holybelly","5 Rue Lucien Sampaix, 75010 Paris, France","cafe","","5","Cafe",""',
  "",
].join("\n");

const geojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.39, 48.877] },
      properties: {
        name: "Chez Odette",
        address: "12 Rue des Lilas, 75019 Paris, France",
        icon: "restaurant",
        userComment: "Great ravioli",
        tags: [{ name: "Restaurant", color: "#ff5161" }],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.333, 48.853] },
      properties: {
        name: "Pain d’Or",
        address: "3 Rue du Four, 75006 Paris, France",
        icon: "bakery",
        tags: [
          { name: "To try", color: "#6edf38" },
          { name: "Bakery", color: "#f5a623" },
        ],
      },
    },
  ],
};

async function pickExport(page: Page) {
  await page.locator('input[type="file"]').setInputFiles([
    { name: "mapstr.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    {
      name: "mapstr.geojson",
      mimeType: "application/geo+json",
      buffer: Buffer.from(JSON.stringify(geojson)),
    },
  ]);
}

test("a Mapstr export comes in with its tags, stars and states", async ({ page }) => {
  await page.goto("./#/import");
  await pickExport(page);
  // Holybelly is only in the CSV: it is looked up by name.
  await expect(page.getByText(/3 places · 3 new tags · 1 to look up/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("3 places added")).toBeVisible({ timeout: 15_000 });

  await page.goto("./#/tags");
  for (const tag of ["Restaurant", "Bakery", "Cafe"]) {
    await expect(page.getByRole("button", { name: `${tag} 1 place` })).toBeVisible();
  }
  // "To try" became a state, not a tag.
  await expect(page.getByRole("button", { name: /^To try \d/ })).toHaveCount(0);

  await page.goto("./");
  await page.getByText("Chez Odette").first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Chez Odette" })).toBeVisible();
  await expect(page.getByRole("img", { name: "4.5 out of 5" })).toBeVisible();
  await expect(page.getByText("from Mapstr")).toBeVisible();

  // The form shows the half star; a whole one replaces it.
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "5 stars", pressed: false })).toBeVisible();
  await page.getByRole("button", { name: "5 stars" }).click();
  await expect(page.getByRole("button", { name: "5 stars", pressed: true })).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("img", { name: "5 out of 5" })).toBeVisible();

  // The same export again adds nothing.
  await page.goto("./#/import");
  await pickExport(page);
  await expect(page.getByText(/3 places/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/0 places added · 3 already there/)).toBeVisible({
    timeout: 15_000,
  });
});
