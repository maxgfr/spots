import { describe, expect, test } from "bun:test";
import { parseMapLink } from "./links";

describe("parseMapLink: Google Maps", () => {
  test("place link: prefers the !3d!4d pin over the @ viewport", () => {
    const url =
      "https://www.google.com/maps/place/Le+Petit+Cambodge/@48.8722,2.3678,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e0c1c0e3d0f:0x5b1d2e3c4a5f6b7c!8m2!3d48.8738!4d2.3705!16s%2Fg%2F1tdq3l4m?entry=ttu";
    expect(parseMapLink(url)).toEqual({
      lat: 48.8738,
      lng: 2.3705,
      name: "Le Petit Cambodge",
      url,
      provider: "google",
    });
  });

  test("percent-encoded data and accented names", () => {
    const url =
      "https://www.google.fr/maps/place/Caf%C3%A9+de+Flore/@48.854,2.332,17z/data=%213m1%214b1%218m2%213d48.8541%214d2.3326";
    const parsed = parseMapLink(url);
    expect(parsed?.name).toBe("Café de Flore");
    expect(parsed?.lat).toBe(48.8541);
    expect(parsed?.lng).toBe(2.3326);
  });

  test("falls back to the @ viewport", () => {
    const parsed = parseMapLink("https://www.google.com/maps/@48.8738,2.3705,15z");
    expect(parsed).toMatchObject({ lat: 48.8738, lng: 2.3705, provider: "google" });
  });

  test("?q= with coordinates or a name", () => {
    expect(parseMapLink("https://maps.google.com/?q=48.87,2.37")).toMatchObject({
      lat: 48.87,
      lng: 2.37,
    });
    const named = parseMapLink("https://maps.google.com/maps?q=Le+Comptoir+du+Relais");
    expect(named?.query).toBe("Le Comptoir du Relais");
    expect(named?.lat).toBeUndefined();
  });

  test("api=1 search links", () => {
    const parsed = parseMapLink(
      "https://www.google.com/maps/search/?api=1&query=Septime%2C%20Paris&query_place_id=ChIJ",
    );
    expect(parsed?.query).toBe("Septime, Paris");
    expect(
      parseMapLink("https://www.google.com/maps/search/?api=1&query=47.5951518,-122.3316393"),
    ).toMatchObject({ lat: 47.5951518, lng: -122.3316393 });
  });

  test("ll= parameter", () => {
    expect(parseMapLink("https://maps.google.com/?ll=40.7128,-74.006&z=14")).toMatchObject({
      lat: 40.7128,
      lng: -74.006,
    });
  });

  test("/maps/search/ path with a query or coordinates", () => {
    expect(parseMapLink("https://www.google.com/maps/search/pizza+near+bastille")?.query).toBe(
      "pizza near bastille",
    );
    expect(parseMapLink("https://www.google.com/maps/search/48.8738,+2.3705")).toMatchObject({
      lat: 48.8738,
      lng: 2.3705,
    });
  });

  test("short links are unresolvable", () => {
    expect(parseMapLink("https://maps.app.goo.gl/AbCdEf123")).toEqual({
      url: "https://maps.app.goo.gl/AbCdEf123",
      provider: "google",
      unresolvable: true,
    });
    expect(parseMapLink("https://goo.gl/maps/xyz789")?.unresolvable).toBe(true);
  });

  test("finds the link inside a shared message", () => {
    const parsed = parseMapLink("Check this out! https://maps.app.goo.gl/xyz. See you there");
    expect(parsed?.url).toBe("https://maps.app.goo.gl/xyz");
    expect(parsed?.unresolvable).toBe(true);
    const shared = parseMapLink(
      "Septime\n80 Rue de Charonne, 75011 Paris\nhttps://www.google.com/maps/place/Septime/@48.8533,2.3807,17z",
    );
    expect(shared?.name).toBe("Septime");
  });

  test("ignores non-maps Google pages", () => {
    expect(parseMapLink("https://www.google.com/search?q=pizza")).toBeNull();
  });
});

describe("parseMapLink: Apple Maps", () => {
  test("ll and q", () => {
    expect(
      parseMapLink("https://maps.apple.com/?ll=48.8738,2.3705&q=Le%20Petit%20Cambodge"),
    ).toEqual({
      lat: 48.8738,
      lng: 2.3705,
      name: "Le Petit Cambodge",
      url: "https://maps.apple.com/?ll=48.8738,2.3705&q=Le%20Petit%20Cambodge",
      provider: "apple",
    });
  });

  test("address only", () => {
    const parsed = parseMapLink("https://maps.apple.com/?address=10+Rue+Alibert,+75010+Paris");
    expect(parsed?.query).toBe("10 Rue Alibert, 75010 Paris");
    expect(parsed?.lat).toBeUndefined();
  });

  test("coordinate and name (new style)", () => {
    expect(
      parseMapLink(
        "https://maps.apple.com/place?coordinate=48.8738,2.3705&name=Le%20Petit%20Cambodge&address=20%20Rue%20Alibert",
      ),
    ).toMatchObject({ lat: 48.8738, lng: 2.3705, name: "Le Petit Cambodge" });
  });
});

describe("parseMapLink: OpenStreetMap", () => {
  test("#map= fragment", () => {
    expect(parseMapLink("https://www.openstreetmap.org/#map=17/48.87380/2.37050")).toMatchObject({
      lat: 48.8738,
      lng: 2.3705,
      provider: "osm",
    });
  });

  test("mlat/mlon win over the viewport", () => {
    expect(
      parseMapLink("https://www.openstreetmap.org/?mlat=48.8738&mlon=2.3705#map=12/48.86/2.35"),
    ).toMatchObject({ lat: 48.8738, lng: 2.3705 });
  });

  test("a node link without coordinates gives nothing", () => {
    expect(parseMapLink("https://www.openstreetmap.org/node/123456")).toBeNull();
  });
});

describe("parseMapLink: geo URIs", () => {
  test("coordinates and a name", () => {
    expect(parseMapLink("geo:48.8738,2.3705?q=Le%20Petit%20Cambodge")).toMatchObject({
      lat: 48.8738,
      lng: 2.3705,
      name: "Le Petit Cambodge",
      provider: "geo",
    });
  });

  test("Android style with a label", () => {
    expect(parseMapLink("geo:0,0?q=48.8738,2.3705(Le Petit Cambodge)")).toMatchObject({
      lat: 48.8738,
      lng: 2.3705,
      name: "Le Petit Cambodge",
    });
  });

  test("uncertainty parameter", () => {
    expect(parseMapLink("geo:48.8738,2.3705;u=35")).toMatchObject({ lat: 48.8738, lng: 2.3705 });
  });

  test("search only", () => {
    const parsed = parseMapLink("geo:0,0?q=Septime+Paris");
    expect(parsed?.query).toBe("Septime Paris");
    expect(parsed?.lat).toBeUndefined();
  });
});

describe("parseMapLink: bare coordinates", () => {
  test("comma, space and degree signs", () => {
    for (const text of [
      "48.8738, 2.3705",
      "48.8738 2.3705",
      "48.8738°, 2.3705°",
      " 48.8738,2.3705 ",
    ]) {
      expect(parseMapLink(text)).toMatchObject({ lat: 48.8738, lng: 2.3705, provider: "coords" });
    }
  });

  test("hemisphere letters", () => {
    expect(parseMapLink("33.8688° S, 151.2093° E")).toMatchObject({ lat: -33.8688, lng: 151.2093 });
    expect(parseMapLink("40.7128° N 74.0060° W")).toMatchObject({ lat: 40.7128, lng: -74.006 });
  });

  test("validates ranges", () => {
    expect(parseMapLink("95.1, 2.3")).toBeNull();
    expect(parseMapLink("48.1, 200.5")).toBeNull();
    expect(parseMapLink("https://maps.google.com/?q=95,2")).toBeNull();
  });

  test("rejects plain text", () => {
    expect(parseMapLink("")).toBeNull();
    expect(parseMapLink("Le Petit Cambodge")).toBeNull();
    expect(parseMapLink("https://example.com/maps/place/x")).toBeNull();
  });
});
