import { expect, test } from "@playwright/test";
import { english, fakeGeocoder, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

test("erasing all data asks first, survives a reload, and can be undone", async ({ page }) => {
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await page.goto("./#/menu");

  await page.getByRole("button", { name: "Erase all data…" }).click();
  await expect(page.getByText("Erase 1 place, 0 lists")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Erase all data…" }).click();
  await page.getByRole("button", { name: "Erase everything" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.goto("./");
  await expect(page.getByText("Le Petit Cambodge")).toBeVisible();

  await page.goto("./#/menu");
  await page.getByRole("button", { name: "Erase all data…" }).click();
  await page.getByRole("button", { name: "Erase everything" }).click();
  await page.goto("./");
  await page.reload();
  await expect(page.getByText("Le Petit Cambodge")).toHaveCount(0);
  // The starter tags are back.
  await expect(page.getByRole("button", { name: "Food" }).first()).toBeVisible();
});
