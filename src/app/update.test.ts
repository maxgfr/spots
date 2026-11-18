import { describe, expect, test } from "bun:test";
import { FRESH_MS, type UpdateMoment, updateAction } from "./update";

const moment = (m: Partial<UpdateMoment> = {}): UpdateMoment => ({
  wasControlled: true,
  route: "home",
  sinceLoad: 60_000,
  interacted: true,
  ...m,
});

describe("a new version taking over the page", () => {
  test("does nothing on the first install: the page already runs it", () => {
    expect(updateAction(moment({ wasControlled: false }))).toBe("none");
    expect(updateAction(moment({ wasControlled: false, route: "pair", sinceLoad: 0 }))).toBe(
      "none",
    );
  });

  test("reloads at once on a pairing link, whatever was done", () => {
    expect(updateAction(moment({ route: "pair" }))).toBe("reload");
    expect(updateAction(moment({ route: "pair", sinceLoad: 0, interacted: false }))).toBe("reload");
  });

  test("reloads a page just opened and not touched yet", () => {
    expect(updateAction(moment({ sinceLoad: 1500, interacted: false }))).toBe("reload");
    expect(updateAction(moment({ sinceLoad: FRESH_MS - 1, interacted: false }))).toBe("reload");
  });

  test("offers a reload once the page is in use", () => {
    expect(updateAction(moment({ sinceLoad: 1500, interacted: true }))).toBe("offer");
    expect(updateAction(moment({ sinceLoad: FRESH_MS, interacted: false }))).toBe("offer");
    expect(updateAction(moment({ route: "edit" }))).toBe("offer");
  });
});
