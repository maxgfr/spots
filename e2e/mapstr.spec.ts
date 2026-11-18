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

const csvFile = { name: "mapstr.csv", mimeType: "text/csv", buffer: Buffer.from(csv) };
const geojsonFile = {
  name: "mapstr.geojson",
  mimeType: "application/geo+json",
  buffer: Buffer.from(JSON.stringify(geojson)),
};

test("the two Mapstr files can be picked one after the other", async ({ page }) => {
  await page.goto("./#/import");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(geojsonFile);
  await expect(page.getByText(/GeoJSON found — add the CSV/)).toBeVisible();
  await input.setInputFiles(csvFile);
  await expect(page.getByText(/3 places · 3 new tags · 1 to look up/)).toBeVisible();
  await expect(page.getByText("Files: mapstr.geojson, mapstr.csv")).toBeVisible();
  await expect(page.getByText(/GeoJSON found|CSV only/)).toHaveCount(0);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("3 places added")).toBeVisible({ timeout: 15_000 });

  await page.goto("./");
  await page.getByText("Chez Odette").first().click();
  await expect(page.getByRole("img", { name: "4.5 out of 5" })).toBeVisible();
});

test("the CSV imported after the GeoJSON brings the stars to the places", async ({ page }) => {
  await page.goto("./#/import");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(geojsonFile);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("2 places added")).toBeVisible({ timeout: 15_000 });

  await input.setInputFiles(csvFile);
  await expect(page.getByText(/CSV only — places will be looked up/)).toBeVisible();
  // Only Holybelly, not in the notebook yet, is looked up.
  await expect(page.getByText(/3 places · 1 new tag · 1 to look up/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText(/1 place added · 1 updated · 1 already there/)).toBeVisible({
    timeout: 15_000,
  });

  await page.goto("./#/tags");
  await expect(page.getByRole("button", { name: "Restaurant 1 place" })).toBeVisible();
  await page.goto("./");
  await expect(page.locator(".rows li")).toHaveCount(3);
  await page.getByText("Chez Odette").first().click();
  await expect(page.getByRole("img", { name: "4.5 out of 5" })).toBeVisible();
});

test("an import goes on while another screen is open", async ({ page }) => {
  // Places with no position, looked up one at a time: the fake geocoder knows three.
  const rows = [
    "Le Petit Cambodge",
    "Le Syndicat",
    "Holybelly",
    "Nowhere One",
    "Nowhere Two",
    "Nowhere Three",
    "Nowhere Four",
    "Nowhere Five",
  ].map((name) => `"2024-05-01T12:00:00.000Z","${name}","","","","4","Brunch",""`);
  const slow = [csv.split("\n")[0], ...rows, ""].join("\n");
  await page.goto("./#/import");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "slow.csv", mimeType: "text/csv", buffer: Buffer.from(slow) });
  await expect(page.getByText(/8 places · 1 new tag · 8 to look up/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".progress")).toBeVisible();

  // Away from the screen, the import keeps going and says so.
  await page.getByRole("button", { name: "spots, back to the map" }).click();
  const pill = page.getByRole("button", { name: /Importing… \d \/ 8/ });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByText("3 places added")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("5 not found on the map")).toBeVisible();
  await expect(pill).toHaveCount(0);

  await page.goto("./");
  for (const name of ["Le Petit Cambodge", "Le Syndicat", "Holybelly"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});
