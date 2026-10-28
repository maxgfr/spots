import type { Page } from "@playwright/test";

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
