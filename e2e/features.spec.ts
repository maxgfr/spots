import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { english, fakeGeocoder, pinBySearch } from "./helpers";

test.beforeEach(async ({ page }) => {
  await fakeGeocoder(page);
  await english(page);
});

/** A gist server in memory, shared by every page that uses it, like GitHub's own. */
function fakeGitHub() {
  const gists = new Map<string, { description: string; content: string }>();
  let seq = 0;
  const attach = async (target: Page | BrowserContext) => {
    await target.route("https://api.github.com/**", async (route) => {
      const req = route.request();
      if (req.headers().authorization !== "Bearer good-token") {
        return route.fulfill({ status: 401, json: { message: "Bad credentials" } });
      }
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();
      const view = (id: string) => {
        const g = gists.get(id);
        return (
          g && { id, description: g.description, files: { "spots.json": { content: g.content } } }
        );
      };
      if (path === "/user") return route.fulfill({ json: { login: "tester" } });
      if (path === "/gists" && method === "GET") {
        return route.fulfill({ json: [...gists.keys()].map(view) });
      }
      if (path === "/gists" && method === "POST") {
        const body = req.postDataJSON();
        const id = `g${++seq}`;
        gists.set(id, { description: body.description, content: body.files["spots.json"].content });
        return route.fulfill({ status: 201, json: view(id) });
      }
      const id = path.split("/")[2] ?? "";
      const g = gists.get(id);
      if (!g) return route.fulfill({ status: 404, json: { message: "Not Found" } });
      if (method === "PATCH") g.content = req.postDataJSON().files["spots.json"].content;
      return route.fulfill({ json: view(id) });
    });
  };
  return { gists, attach };
}

async function connect(page: Page, token: string) {
  await page.goto("./#/sync");
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Connect" }).click();
}

test("two browsers sync through the same gist, deletions included", async ({ page, browser }) => {
  const github = fakeGitHub();
  await github.attach(page);
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await connect(page, "good-token");
  await expect(page.getByText("@tester")).toBeVisible();
  await expect.poll(() => github.gists.size).toBe(1);
  await expect
    .poll(() => [...github.gists.values()][0]?.content ?? "")
    .toContain("Le Petit Cambodge");

  const other = await browser.newContext();
  const second = await other.newPage();
  await github.attach(second);
  await fakeGeocoder(second);
  await english(second);
  await connect(second, "good-token");
  await expect(second.getByText("@tester")).toBeVisible();
  // The second device found the same gist rather than making another one.
  expect(github.gists.size).toBe(1);
  await second.goto("./");
  await expect(second.getByText("Le Petit Cambodge")).toBeVisible();

  // Deleted on the second device…
  await second.getByText("Le Petit Cambodge").click();
  await second.getByRole("button", { name: "Edit" }).click();
  await second.getByRole("button", { name: "Delete this place" }).click();
  await expect
    .poll(() => [...github.gists.values()][0]?.content ?? "", { timeout: 10_000 })
    .toContain('"deletedAt"');
  // …and gone on the first once it syncs.
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.goto("./");
  await expect(page.getByText("Le Petit Cambodge")).toHaveCount(0);
  await other.close();
});

test("a refused token says so and changes nothing", async ({ page }) => {
  const github = fakeGitHub();
  await github.attach(page);
  await connect(page, "wrong-token");
  await expect(page.getByRole("alert")).toContainText("GitHub refused this token");
  expect(github.gists.size).toBe(0);
});

test("a Google Takeout zip brings starred places and saved lists", async ({ page }) => {
  const saved = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.3705, 48.8738] },
        properties: {
          date: "2024-05-01T10:00:00Z",
          google_maps_url: "http://maps.google.com/?cid=123",
          location: {
            name: "Le Petit Cambodge",
            address: "20 Rue Alibert, 75010 Paris",
            country_code: "FR",
          },
        },
      },
    ],
  };
  const csv =
    "Title,Note,URL,Comment\n\nLe Syndicat,Cocktails,https://www.google.com/maps/place/Le+Syndicat/data=!4m2,\nHolybelly,Brunch,https://www.google.com/maps/place/Holybelly/data=!4m2,\n";
  const zip = zipSync({
    "Takeout/Maps (your places)/Saved Places.json": strToU8(JSON.stringify(saved)),
    "Takeout/Saved/Want to go.csv": strToU8(csv),
  });
  await page.goto("./#/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "takeout.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await expect(page.getByText(/3 places/)).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("3 places added")).toBeVisible({ timeout: 15_000 });
  await page.goto("./#/lists");
  await expect(page.getByRole("button", { name: /Want to go\s*2 places/ })).toBeVisible();
  await page.goto("./");
  await expect(page.getByText("Holybelly")).toBeVisible();
});

test("a JSON backup goes out and comes back in another browser", async ({ page, browser }) => {
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await page.goto("./#/import");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download a backup" }).click();
  const file = await (await download).path();

  const other = await browser.newContext();
  const fresh = await other.newPage();
  await english(fresh);
  await fresh.goto("./#/import");
  await fresh.locator('input[type="file"]').setInputFiles(file);
  await fresh.getByRole("button", { name: "Import", exact: true }).click();
  await fresh.goto("./");
  await expect(fresh.getByText("Le Petit Cambodge")).toBeVisible();
  await other.close();
});

test("a right click on the map pins what is there", async ({ page }) => {
  await page.goto("./");
  await page.locator(".map canvas").waitFor();
  await page.mouse.click(900, 450, { button: "right" });
  await expect(page.getByRole("heading", { name: "New place" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Le Petit Cambodge");
  await page.getByRole("button", { name: "Pin it" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Le Petit Cambodge" })).toBeVisible();
});

test("pin where I am", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 48.8738, longitude: 2.3705 });
  await page.goto("./");
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Pin where I am" }).click();
  await expect(page.getByRole("heading", { name: "New place" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Le Petit Cambodge");
});

test("tag filters and delete with undo", async ({ page }) => {
  await page.goto("./");
  await pinBySearch(page, "petit cambodge", /Le Petit Cambodge/);
  await page.goto("./");
  await pinBySearch(page, "syndicat", /Le Syndicat/);
  await page.goto("./");
  await expect(page.locator(".place-row")).toHaveCount(2);
  await page.locator(".filters").getByRole("button", { name: "Drinks" }).click();
  await expect(page.locator(".place-row")).toHaveCount(1);
  await expect(page.locator(".place-row")).toContainText("Le Syndicat");
  await page.locator(".filters").getByRole("button", { name: "Drinks" }).click();
  await expect(page.locator(".place-row")).toHaveCount(2);

  await page.getByText("Le Syndicat").click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Delete this place" }).click();
  await expect(page.locator(".place-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".place-row")).toHaveCount(2);
});

/** An OpenAI-compatible server that answers like a model would. */
async function fakeModel(page: Page) {
  await page.route("http://localhost:11434/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/models")) return route.fulfill({ json: { data: [{ id: "test-model" }] } });
    const body = route.request().postDataJSON();
    const asked = JSON.stringify(body.messages);
    const content = asked.includes("Question:")
      ? {
          answer: "Holybelly for brunch.",
          placeIds: [asked.match(/([0-9a-f-]{36}) \| Holybelly/)?.[1] ?? ""],
        }
      : {
          places: [
            {
              name: "Holybelly",
              area: "Rue Lucien Sampaix",
              city: "Paris",
              tag: "Coffee",
              note: "Brunch on Sunday",
            },
            { name: "Le Syndicat", area: "", city: "Paris", tag: "Drinks", note: "Cocktails" },
          ],
        };
    return route.fulfill({
      json: {
        id: "x",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(content) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });
  });
}

test("the AI pins the places a text names, then answers from them", async ({ page }) => {
  await fakeModel(page);
  await page.goto("./#/ai/settings");
  await page.getByRole("button", { name: "A local server" }).click();
  await page.getByRole("button", { name: "Ollama" }).click();
  await page.getByLabel("Model").fill("test-model");
  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Connection works.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await page.goto("./#/ai");
  await page.getByRole("button", { name: "Add from text" }).click();
  await page
    .getByLabel("Text that names places")
    .fill("Brunch at Holybelly, then cocktails at Le Syndicat.");
  await page.getByRole("button", { name: "Find the places" }).click();
  await page.getByRole("button", { name: "Pin 2" }).click();
  await expect(page.locator(".place-row")).toHaveCount(2);

  await page.goto("./#/ai");
  await page.getByLabel("Your question").fill("Where for brunch?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Holybelly for brunch.")).toBeVisible();
  await expect(page.locator('[role="status"] .row-name')).toHaveText(["Holybelly"]);
});
