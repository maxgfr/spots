import { describe, expect, test } from "bun:test";
import { auditHtml, CSP, fontsCss, serviceWorker } from "./build";

describe("build", () => {
  test("the CSP loads code, styles and fonts from the site only", () => {
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("style-src 'self'");
    expect(CSP).toContain("font-src 'self'");
    expect(CSP).not.toContain("unsafe-inline");
    expect(CSP).not.toContain("unsafe-eval");
    expect(CSP).toContain("default-src 'none'");
  });

  test("auditHtml refuses inline code and other origins", () => {
    expect(() => auditHtml("<script>alert(1)</script>")).toThrow();
    expect(() => auditHtml("<style>a{}</style>")).toThrow();
    expect(() => auditHtml('<a onclick="x()">x</a>')).toThrow();
    expect(() => auditHtml('<script src="https://cdn.example/x.js"></script>')).toThrow();
    expect(() => auditHtml('<link href="/abs.css" />')).toThrow();
    expect(() => auditHtml('<script type="module" src="./index.js"></script>')).not.toThrow();
  });

  test("the service worker precaches the files and keeps map tiles", () => {
    const sw = serviceWorker(["assets/a.js", "fonts/f.woff2"], "abc");
    expect(sw).toContain('"spots-abc"');
    expect(sw).toContain('"./assets/a.js"');
    expect(sw).toContain("tiles.openfreemap.org");
    expect(sw).toContain('"spots-tiles-kept"');
  });

  test("fonts are served from the site", () => {
    expect(fontsCss()).toContain('url("./fonts/');
    expect(fontsCss()).not.toContain("http");
  });
});
