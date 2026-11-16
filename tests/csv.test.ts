/**
 * The CSV reader and writer behind customer import and export.
 *
 * Shops export from whatever they are on now, so the awkward cases are the
 * point: quoted commas, doubled quotes, an address with a newline in it, CRLF
 * from Excel, and the BOM Excel puts at the front of a UTF-8 file.
 */
import { describe, expect, test } from "vitest";
import { parseCsv, toCsv, withHeaders } from "../src/lib/csv";

describe("writing", () => {
  test("quotes only the fields that need it", () => {
    expect(toCsv(["a", "b"], [["plain", "has,comma"]]))
      .toBe('a,b\r\nplain,"has,comma"\r\n');
  });

  test("doubles quotes inside a quoted field", () => {
    expect(toCsv(["a"], [['He said "hi"']])).toBe('a\r\n"He said ""hi"""\r\n');
  });

  test("treats null and undefined as empty", () => {
    expect(toCsv(["a", "b", "c"], [["x", null, undefined]])).toBe("a,b,c\r\nx,,\r\n");
  });

  test("keeps a newline inside a field", () => {
    expect(toCsv(["a"], [["line1\nline2"]])).toBe('a\r\n"line1\nline2"\r\n');
  });
});

describe("reading", () => {
  test("a plain file", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  test("CRLF, as Excel writes it", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("strips the BOM Excel puts at the front", () => {
    expect(parseCsv("﻿name\nDave")).toEqual([["name"], ["Dave"]]);
  });

  test("quoted commas stay in one field", () => {
    expect(parseCsv('a,b\n"12 Main St, Toronto",x')).toEqual([["a", "b"], ["12 Main St, Toronto", "x"]]);
  });

  test("doubled quotes come back as one", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  test("a newline inside a quoted field does not split the row", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([["a", "b"], ["line1\nline2", "x"]]);
  });

  test("empty fields are preserved", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  test("a trailing newline does not add a blank row", () => {
    expect(parseCsv("a\n1\n")).toEqual([["a"], ["1"]]);
  });

  test("an empty file is no rows", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n")).toEqual([]);
  });

  test("a file with no trailing newline keeps its last row", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("round-trips what it writes", () => {
    const rows = [["Dave, Jr.", 'say "hi"', "line1\nline2", ""]];
    const parsed = parseCsv(toCsv(["w", "x", "y", "z"], rows));
    expect(parsed[1]).toEqual(rows[0]);
  });
});

describe("matching columns to a heading", () => {
  test("ignores case, spaces, underscores and dashes", () => {
    const rows = parseCsv("Name,Postal Code,vehicle_vin,Vehicle-Make\nDave,M4C 1A1,ABC,Ford");
    expect(withHeaders(rows)[0]).toEqual({
      name: "Dave", postalcode: "M4C 1A1", vehiclevin: "ABC", vehiclemake: "Ford",
    });
  });

  test("trims the values", () => {
    expect(withHeaders(parseCsv("name\n  Dave  "))[0]).toEqual({ name: "Dave" });
  });

  test("a heading with no rows under it is no records", () => {
    expect(withHeaders(parseCsv("name,email"))).toEqual([]);
  });

  test("a short row leaves the missing columns empty", () => {
    expect(withHeaders(parseCsv("name,email,phone\nDave"))[0])
      .toEqual({ name: "Dave", email: "", phone: "" });
  });
});
