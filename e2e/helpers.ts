import type { BrowserContext, Page } from "@playwright/test";

/** Photon and Nominatim are answered locally so the tests do not depend on them. */
export async function fakeGeocoder(page: Page): Promise<void> {
  await page.route("https://photon.komoot.io/**", (route) => {
    const url = new URL(route.request().url());
    const reverse = url.pathname.includes("reverse");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const cambodge: [string, number, number, string, string] = [
      "Le Petit Cambodge",
      48.8738,
      2.3705,
      "restaurant",
      "Rue Alibert",
    ];
    const known: Record<string, [string, number, number, string, string]> = {
      cambodge,
      syndicat: ["Le Syndicat", 48.8703, 2.3555, "bar", "Rue du Faubourg Saint-Denis"],
      holybelly: ["Holybelly", 48.8716, 2.3612, "cafe", "Rue Lucien Sampaix"],
    };
    const hit = Object.entries(known).find(([k]) => q.includes(k))?.[1];
    if (!reverse && !hit)
      return route.fulfill({ json: { type: "FeatureCollection", features: [] } });
    const [name, lat, lng, kind, street] = hit ?? cambodge;
    const at = reverse
      ? [Number(url.searchParams.get("lon")), Number(url.searchParams.get("lat"))]
      : [lng, lat];
    return route.fulfill({
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: at },
            properties: {
              osm_type: "N",
              osm_id: name.length,
              osm_key: "amenity",
              osm_value: kind,
              name,
              street,
              postcode: "75010",
              city: "Paris",
            },
          },
        ],
      },
    });
  });
  await page.route("https://nominatim.openstreetmap.org/**", (route) =>
    route.fulfill({ status: 503 }),
  );
}

/** English, whatever the machine's language. */
export async function english(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!localStorage.getItem("spots:lang")) localStorage.setItem("spots:lang", "en");
  });
}

/** Pins a place found by the (fake) search. */
export async function pinBySearch(page: Page, query: string, name: RegExp): Promise<void> {
  await page.getByPlaceholder("Search a place, paste a link…").fill(query);
  await page.getByRole("button", { name }).first().click();
  await page.getByRole("button", { name: "Pin it" }).click();
}

/**
 * A gist server and repositories (`owner/name`, private or not, branch main) in memory,
 * shared by every page that uses it, like GitHub's own. The Contents API checks every sha.
 */
export function fakeGitHub(repos: Record<string, { private: boolean }> = {}) {
  const gists = new Map<string, { description: string; content: string }>();
  /** Repository files by `owner/name/path`. */
  const files = new Map<string, { content: string; sha: string }>();
  const commits: { file: string; message: string; sha?: string }[] = [];
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
      const view = (id: string) => {
        const g = gists.get(id);
        return (
          g && { id, description: g.description, files: { "spots.json": { content: g.content } } }
        );
      };
      if (path === "/user") return route.fulfill({ json: { login: "tester" } });
      const inRepo = path.match(/^\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+))?$/);
      if (inRepo) {
        const [, name = "", filePath] = inRepo;
        const repo = repos[name];
        if (!repo) return route.fulfill({ status: 404, json: { message: "Not Found" } });
        if (!filePath) {
          return route.fulfill({
            json: { default_branch: "main", private: repo.private, permissions: { push: true } },
          });
        }
        const key = `${name}/${filePath}`;
        const file = files.get(key);
        if (method === "PUT") {
          const body = req.postDataJSON();
          commits.push({ file: key, message: body.message, sha: body.sha });
          if (body.branch !== "main") return route.fulfill({ status: 404, json: {} });
          if (file ? body.sha !== file.sha : body.sha) {
            return route.fulfill({ status: 409, json: { message: "does not match" } });
          }
          const sha = `sha${++seq}`;
          files.set(key, { content: Buffer.from(body.content, "base64").toString("utf8"), sha });
          return route.fulfill({ status: file ? 200 : 201, json: { content: { sha } } });
        }
        if (!file) return route.fulfill({ status: 404, json: { message: "Not Found" } });
        const content = Buffer.from(file.content, "utf8").toString("base64");
        return route.fulfill({
          json: { type: "file", sha: file.sha, encoding: "base64", content },
        });
      }
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
  return { gists, files, commits, attach };
}

/** Connects the Sync screen to the account's secret gist with a token. */
export async function connect(page: Page, token: string) {
  await page.goto("./#/sync");
  await page.getByRole("button", { name: "Secret gist" }).click();
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

/** Connects the Sync screen to a repository (the default choice) with a token. */
export async function connectRepo(page: Page, token: string, repo: string) {
  await page.goto("./#/sync");
  await page.getByRole("button", { name: "Private repository" }).click();
  await page.getByLabel("Repository").fill(repo);
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}
