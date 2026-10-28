import { describe, expect, test } from "bun:test";
import { listNameFromFile, parseSavedListCsv, parseSavedPlaces } from "./takeout";

const newer = {
  type: "FeatureCollection",
  features: [
    {
      geometry: { coordinates: [2.3705, 48.8738], type: "Point" },
      properties: {
        date: "2023-05-14T18:03:11Z",
        google_maps_url: "http://maps.google.com/?cid=12345678901234567890",
        location: {
          address: "20 Rue Alibert, 75010 Paris, France",
          country_code: "FR",
          name: "Le Petit Cambodge",
        },
        Comment: "Bobun!",
      },
      type: "Feature",
    },
    {
      geometry: { coordinates: [0, 0], type: "Point" },
      properties: {
        date: "2022-01-02T10:00:00Z",
        google_maps_url: "https://www.google.com/maps/search/48.8533,2.3807",
        location: { address: "80 Rue de Charonne, 75011 Paris", name: "Septime" },
      },
      type: "Feature",
    },
    {
      geometry: { coordinates: [0, 0], type: "Point" },
      properties: {
        date: "2021-07-08T10:00:00Z",
        google_maps_url: "http://maps.google.com/?cid=98765",
        location: { address: "Rue de la Paix, Paris", name: "Somewhere" },
      },
      type: "Feature",
    },
    {
      geometry: { coordinates: [-0.1276, 51.5072], type: "Point" },
      properties: {
        date: "2021-07-08T10:00:00Z",
        google_maps_url: "https://www.google.com/maps/search/51.5072,-0.1276",
        location: { latitude: 51.5072, longitude: -0.1276 },
      },
      type: "Feature",
    },
    { type: "Feature", properties: {}, geometry: { coordinates: [0, 0] } },
    "junk",
  ],
};

const older = {
  type: "FeatureCollection",
  features: [
    {
      geometry: { coordinates: [2.3326, 48.8541], type: "Point" },
      properties: {
        "Google Maps URL": "http://maps.google.com/?cid=111",
        Location: {
          Address: "172 Bd Saint-Germain, 75006 Paris, France",
          "Business Name": "Café de Flore",
          "Country Code": "FR",
          "Geo Coordinates": { Latitude: "48.8541", Longitude: "2.3326" },
        },
        Published: "2019-03-04T12:00:00Z",
        Title: "Café de Flore",
        Updated: "2019-03-04T12:00:00Z",
      },
      type: "Feature",
    },
    {
      geometry: { coordinates: [0, 0], type: "Point" },
      properties: {
        "Google Maps URL": "http://maps.google.com/?cid=222",
        Location: {
          Address: "1 Place du Tertre, Paris",
          "Business Name": "La Mère Catherine",
          "Geo Coordinates": { Latitude: "48.8865", Longitude: "2.3407" },
        },
        Title: "La Mère Catherine",
      },
      type: "Feature",
    },
  ],
};

describe("parseSavedPlaces", () => {
  test("newer format", () => {
    expect(parseSavedPlaces(newer)).toEqual([
      {
        name: "Le Petit Cambodge",
        address: "20 Rue Alibert, 75010 Paris, France",
        lat: 48.8738,
        lng: 2.3705,
        note: "Bobun!",
        url: "http://maps.google.com/?cid=12345678901234567890",
      },
      {
        name: "Septime",
        address: "80 Rue de Charonne, 75011 Paris",
        lat: 48.8533,
        lng: 2.3807,
        note: "",
        url: "https://www.google.com/maps/search/48.8533,2.3807",
      },
      {
        name: "Somewhere",
        address: "Rue de la Paix, Paris",
        note: "",
        url: "http://maps.google.com/?cid=98765",
      },
      {
        name: "51.50720, -0.12760",
        address: "",
        lat: 51.5072,
        lng: -0.1276,
        note: "",
        url: "https://www.google.com/maps/search/51.5072,-0.1276",
      },
    ]);
  });

  test("older format", () => {
    const places = parseSavedPlaces(older);
    expect(places[0]).toEqual({
      name: "Café de Flore",
      address: "172 Bd Saint-Germain, 75006 Paris, France",
      lat: 48.8541,
      lng: 2.3326,
      note: "",
      url: "http://maps.google.com/?cid=111",
    });
    expect(places[1]).toMatchObject({ name: "La Mère Catherine", lat: 48.8865, lng: 2.3407 });
  });

  test("not a feature collection", () => {
    expect(parseSavedPlaces(null)).toEqual([]);
    expect(parseSavedPlaces({ features: "x" })).toEqual([]);
  });
});

describe("parseSavedListCsv", () => {
  test("Title,Note,URL,Comment with a blank line after the header", () => {
    const csv = [
      "Title,Note,URL,Comment",
      "",
      "Le Petit Cambodge,Go early,https://www.google.com/maps/place/Le+Petit+Cambodge/data=!4m2!3m1!1s0x47e66e0c1c0e3d0f:0x5b1d2e3c4a5f6b7c,",
      '"Septime","Book 3 weeks ahead","https://www.google.com/maps/place/Septime/@48.8533,2.3807,17z/data=!8m2!3d48.8533!4d2.3807","Tasting menu, ""carte blanche"""',
      ",orphan note,https://www.google.com/maps/place/x,",
      "",
    ].join("\r\n");
    expect(parseSavedListCsv(csv)).toEqual([
      {
        name: "Le Petit Cambodge",
        address: "",
        note: "Go early",
        url: "https://www.google.com/maps/place/Le+Petit+Cambodge/data=!4m2!3m1!1s0x47e66e0c1c0e3d0f:0x5b1d2e3c4a5f6b7c",
      },
      {
        name: "Septime",
        address: "",
        lat: 48.8533,
        lng: 2.3807,
        note: 'Book 3 weeks ahead\nTasting menu, "carte blanche"',
        url: "https://www.google.com/maps/place/Septime/@48.8533,2.3807,17z/data=!8m2!3d48.8533!4d2.3807",
      },
    ]);
  });

  test("Tags column and header case", () => {
    const csv = "\uFEFFtitle,NOTE,Url,Tags,Comment\nTen Belles,,,coffee,Flat white\n";
    expect(parseSavedListCsv(csv)).toEqual([
      { name: "Ten Belles", address: "", note: "Flat white" },
    ]);
  });

  test("no Title column", () => {
    expect(parseSavedListCsv("Name,URL\nx,y")).toEqual([]);
    expect(parseSavedListCsv("")).toEqual([]);
  });
});

test("listNameFromFile", () => {
  expect(listNameFromFile("Want to go.csv")).toBe("Want to go");
  expect(listNameFromFile("Takeout/Saved/Favourite places.csv")).toBe("Favourite places");
  expect(listNameFromFile("C:\\Users\\me\\Takeout\\Saved\\Brunch.spots.csv")).toBe("Brunch.spots");
  expect(listNameFromFile("Saved Places.json")).toBe("Saved Places");
  expect(listNameFromFile("README")).toBe("README");
});
