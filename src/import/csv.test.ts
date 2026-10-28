import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("CRLF and a trailing line end", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\rb\r")).toEqual([["a"], ["b"]]);
  });

  test("quotes, escaped quotes and newlines inside quotes", () => {
    expect(parseCsv('name,note\n"Chez ""Léon""","line 1\r\nline 2, still"\n')).toEqual([
      ["name", "note"],
      ['Chez "Léon"', "line 1\r\nline 2, still"],
    ]);
  });

  test("empty fields and blank lines", () => {
    expect(parseCsv("a,,c\n\n,\n")).toEqual([["a", "", "c"], [""], ["", ""]]);
    expect(parseCsv('""')).toEqual([[""]]);
  });

  test("byte order mark", () => {
    expect(parseCsv("\uFEFFTitle,URL\nx,y")).toEqual([
      ["Title", "URL"],
      ["x", "y"],
    ]);
  });

  test("empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\uFEFF")).toEqual([]);
  });

  test("a stray quote in an unquoted field is kept", () => {
    expect(parseCsv('5" tall,x')).toEqual([['5" tall', "x"]]);
  });
});
