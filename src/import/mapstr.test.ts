import { describe, expect, test } from "bun:test";
import { TAG_ICONS } from "../ui/icons";
import {
  combineMapstr,
  iconForName,
  inkFor,
  isMapstrCsvHeader,
  isMapstrGeojson,
  isToTry,
  MAPSTR_ICONS,
  parseMapstrCsv,
  parseMapstrGeojson,
} from "./mapstr";

// A made-up export, shaped like Mapstr's.
const csv = [
  "date,name,address,icon,userComment,rating,tags,photos",
  '"2024-03-02T19:30:00.000Z","Chez Odette","12 Rue des Lilas, 75019 Paris, France","restaurant","Great ravioli","4.5","Restaurant",""',
  '"2024-04-10T08:00:00.000Z","Pain d’Or","3 Rue du Four, 75006 Paris, France","bakery","","","To try#Boulangerie",""',
  '"2024-05-01T12:00:00.000Z","Le Comptoir","8 Quai Bleu, 69002 Lyon, France","bar","Go early,\nbefore 7","5","Bar",""',
  '"2024-06-01T12:00:00.000Z","Only In Csv","1 Nowhere Street","generic","","2","",""',
  '"not a date","Chez Odette","40 Avenue Verte, 13001 Marseille, France","restaurant","","3","Restaurant#Places",""',
  "",
].join("\n");

const geojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.39, 48.87] },
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
      geometry: { type: "Point", coordinates: [5.37, 43.3] },
      properties: {
        name: "Chez Odette",
        address: "40 Avenue Verte, 13001 Marseille, France",
        icon: "restaurant",
        tags: [
          { name: "Restaurant", color: "#ff5161" },
          { name: "Places", color: "#3b6fd8" },
        ],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.33, 48.85] },
      properties: {
        name: "Pain d’Or",
        address: "3 Rue du Four, Paris",
        icon: "bakery",
        tags: [
          { name: "To try", color: "#6edf38" },
          { name: "Boulangerie", color: "#f5a623" },
        ],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [4.83, 45.76] },
      properties: {
        name: "Le Comptoir",
        address: "8 Quai Bleu, 69002 Lyon, France",
        icon: "bar",
        tags: [{ name: "Bar", color: "#7b2d8e" }],
      },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [3.06, 50.63] },
      properties: { name: "Only In Geo", address: "Lille", icon: "fitness", tags: [] },
    },
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: {} },
  ],
};

describe("detection", () => {
  test("a Mapstr GeoJSON, not Google's Saved Places", () => {
    expect(isMapstrGeojson(geojson)).toBe(true);
    expect(
      isMapstrGeojson({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { google_maps_url: "http://maps.google.com/?cid=1", location: {} },
          },
        ],
      }),
    ).toBe(false);
    expect(isMapstrGeojson({ version: 1, places: {} })).toBe(false);
    expect(isMapstrGeojson(null)).toBe(false);
  });

  test("a Mapstr CSV header, not a Google list's", () => {
    expect(
      isMapstrCsvHeader(["date", "name", "address", "icon", "userComment", "rating", "tags"]),
    ).toBe(true);
    expect(isMapstrCsvHeader(["Title", "Note", "URL", "Comment"])).toBe(false);
  });
});

describe("parseMapstrCsv", () => {
  test("reads ratings, dates, tags and multi-line comments", () => {
    const rows = parseMapstrCsv(csv);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      name: "Chez Odette",
      address: "12 Rue des Lilas, 75019 Paris, France",
      note: "Great ravioli",
      icon: "restaurant",
      rating: 4.5,
      createdAt: Date.parse("2024-03-02T19:30:00.000Z"),
      tags: ["Restaurant"],
    });
    expect(rows[1]?.rating).toBeUndefined();
    expect(rows[1]?.tags).toEqual(["To try", "Boulangerie"]);
    expect(rows[2]?.note).toBe("Go early,\nbefore 7");
    expect(rows[3]?.tags).toEqual([]);
    expect(rows[4]?.createdAt).toBeUndefined();
  });

  test("gives nothing for another CSV", () => {
    expect(parseMapstrCsv("Title,Note,URL\nA,b,c\n")).toEqual([]);
    expect(parseMapstrCsv("")).toEqual([]);
  });
});

describe("parseMapstrGeojson", () => {
  test("reads positions, icons and tag colours, skipping nameless features", () => {
    const geo = parseMapstrGeojson(geojson);
    expect(geo).toHaveLength(5);
    expect(geo[0]).toEqual({
      name: "Chez Odette",
      address: "12 Rue des Lilas, 75019 Paris, France",
      note: "Great ravioli",
      icon: "restaurant",
      tags: [{ name: "Restaurant", color: "#ff5161" }],
      lat: 48.87,
      lng: 2.39,
    });
    expect(geo[2]?.note).toBe("");
  });
});

describe("helpers", () => {
  test("isToTry", () => {
    expect(isToTry("To try")).toBe(true);
    expect(isToTry(" À essayer ")).toBe(true);
    expect(isToTry("à tester")).toBe(true);
    expect(isToTry("Want to go")).toBe(true);
    expect(isToTry("Restaurant")).toBe(false);
  });

  test("inkFor takes the nearest label ink", () => {
    expect(inkFor("#ec7a2c")).toBe("vermilion");
    expect(inkFor("#ff5161")).toBe("vermilion");
    expect(inkFor("#7b2d8e")).toBe("plum");
    expect(inkFor("#4ba0e0")).toBe("cobalt");
    expect(inkFor("#000")).toBe("ink");
    expect(inkFor("red")).toBe("ink");
    expect(inkFor("")).toBe("ink");
    expect(inkFor(undefined)).toBe("ink");
  });

  test("inkFor passes over the inks already taken while one is left", () => {
    expect(inkFor("#ff5161", new Set(["vermilion"]))).not.toBe("vermilion");
    expect(inkFor("#ff5161", new Set(["vermilion", "rose"]))).not.toBe("rose");
    const all = new Set([
      "vermilion",
      "cobalt",
      "mustard",
      "green",
      "plum",
      "teal",
      "rose",
      "ink",
    ] as const);
    expect(inkFor("#ff5161", all)).toBe("vermilion");
  });

  test("iconForName reads a tag's name, accents and case aside", () => {
    expect(iconForName("Boulangerie / Pâtisserie")).toBe("croissant");
    expect(iconForName("Café")).toBe("coffee");
    expect(iconForName("Bar")).toBe("cocktail");
    expect(iconForName("Restaurant")).toBe("utensils");
    expect(iconForName("Glacier / Ice cream")).toBe("ice-cream");
    expect(iconForName("Places")).toBeUndefined();
    expect(iconForName("Barcelona")).toBeUndefined();
    for (const name of ["boulangerie", "glace", "cafe", "vin", "biere", "bar", "restaurant"]) {
      expect(TAG_ICONS[iconForName(name) ?? ""]).toBeDefined();
    }
  });

  test("every Mapstr icon is a tag glyph", () => {
    for (const icon of Object.values(MAPSTR_ICONS)) expect(TAG_ICONS[icon]).toBeDefined();
  });
});

describe("combineMapstr", () => {
  const places = combineMapstr(parseMapstrGeojson(geojson), parseMapstrCsv(csv));
  const byAddress = (address: string) => places.find((p) => p.address.startsWith(address));

  test("joins both halves by name and address", () => {
    expect(places).toHaveLength(6);
    expect(byAddress("12 Rue des Lilas")).toEqual({
      name: "Chez Odette",
      address: "12 Rue des Lilas, 75019 Paris, France",
      note: "Great ravioli",
      lat: 48.87,
      lng: 2.39,
      tags: [{ name: "Restaurant", color: "vermilion", icon: "utensils" }],
      rating: 4.5,
      createdAt: Date.parse("2024-03-02T19:30:00.000Z"),
      state: "visited",
    });
    // Same name, other address: matched to its own row, not to the first Chez Odette.
    const marseille = byAddress("40 Avenue Verte");
    expect(marseille?.rating).toBe(3);
    expect(marseille?.lat).toBe(43.3);
    expect(marseille?.tags?.map((t) => t.name)).toEqual(["Restaurant", "Places"]);
  });

  test("falls back on a name found once on each side when the addresses differ", () => {
    const bakery = places.filter((p) => p.name === "Pain d’Or");
    expect(bakery).toHaveLength(1);
    expect(bakery[0]?.address).toBe("3 Rue du Four, Paris");
    expect(bakery[0]?.lat).toBe(48.85);
    expect(bakery[0]?.createdAt).toBe(Date.parse("2024-04-10T08:00:00.000Z"));
  });

  test("does not fall back on a name found twice", () => {
    const joined = combineMapstr(
      [
        { name: "Twin", address: "A", note: "", icon: "", tags: [], lat: 1, lng: 1 },
        { name: "Twin", address: "B", note: "", icon: "", tags: [], lat: 2, lng: 2 },
      ],
      [{ name: "Twin", address: "C", note: "", icon: "", rating: 4, tags: [] }],
    );
    expect(joined).toHaveLength(3);
    expect(joined.filter((p) => p.rating === 4 && p.lat === undefined)).toHaveLength(1);
  });

  test("turns To try into the state, and 5 stars into a favourite", () => {
    const bakery = places.find((p) => p.name === "Pain d’Or");
    expect(bakery?.state).toBe("try");
    expect(bakery?.tags).toEqual([{ name: "Boulangerie", color: "mustard", icon: "croissant" }]);
    expect(places.find((p) => p.name === "Le Comptoir")?.state).toBe("favorite");
    expect(places.find((p) => p.name === "Only In Csv")?.state).toBe("visited");
  });

  test("keeps the halves that have no match", () => {
    const csvOnly = places.find((p) => p.name === "Only In Csv");
    expect(csvOnly?.lat).toBeUndefined();
    expect(csvOnly?.rating).toBe(2);
    expect(csvOnly?.tags).toBeUndefined();
    const geoOnly = places.find((p) => p.name === "Only In Geo");
    expect(geoOnly?.lat).toBe(50.63);
    expect(geoOnly?.rating).toBeUndefined();
    expect(geoOnly?.state).toBe("visited");
  });

  test("gives a tag its commonest glyph, a pin when none is known", () => {
    const places2 = combineMapstr(
      [],
      parseMapstrCsv(
        [
          "date,name,address,icon,userComment,rating,tags,photos",
          '"","A","x","cafe","","","Mix",""',
          '"","B","y","bar","","","Mix",""',
          '"","C","z","bar","","","Mix#Odd",""',
          '"","D","w","generic","","","Odd",""',
        ].join("\n"),
      ),
    );
    const tag = (name: string) => places2.flatMap((p) => p.tags ?? []).find((t) => t.name === name);
    expect(tag("Mix")).toEqual({ name: "Mix", color: "ink", icon: "cocktail" });
    expect(tag("Odd")?.icon).toBe("cocktail");
    expect(places2.every((p) => p.lat === undefined)).toBe(true);
  });

  test("works from the GeoJSON alone", () => {
    const only = combineMapstr(parseMapstrGeojson(geojson), []);
    expect(only).toHaveLength(5);
    expect(only.every((p) => p.lat !== undefined && p.createdAt === undefined)).toBe(true);
  });
});
