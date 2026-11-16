/**
 * Just enough CSV for customer lists, in both directions.
 *
 * Spreadsheets are the format shops actually have their customers in, so this
 * follows RFC 4180 where it matters: quotes doubled inside quoted fields,
 * newlines allowed inside them, CRLF between records. No dependency for it —
 * the rules fit in a page and a parser we own can give useful errors.
 */

/** Quotes a field only when it needs it, so the file stays readable. */
function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: (string | null | undefined)[][]): string {
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map((v) => escape(v ?? "")).join(","));
  // A trailing newline keeps `wc -l` and most editors happy.
  return lines.join("\r\n") + "\r\n";
}

/**
 * Parses CSV into rows of raw strings. Handles quoted fields, doubled quotes,
 * embedded newlines, CRLF or LF, and a UTF-8 BOM (which Excel writes).
 * Returns [] for an empty file rather than throwing.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;   // this field has begun, so a bare "" is distinguishable

  const endField = () => { row.push(field); field = ""; started = false; };
  const endRow = () => {
    endField();
    // Ignore the blank row a trailing newline leaves behind.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"' && !started) { quoted = true; started = true; continue; }
    if (c === ",") { endField(); continue; }
    if (c === "\r") { if (src[i + 1] === "\n") i++; endRow(); continue; }
    if (c === "\n") { endRow(); continue; }
    field += c;
    started = true;
  }

  // A file that does not end in a newline still has a last row.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/**
 * Maps a parsed sheet onto its header row, matching names loosely: case,
 * spaces, underscores and dashes are all ignored, so "Postal Code",
 * "postal_code" and "postalcode" are the same column.
 */
export function withHeaders(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const key = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const headers = rows[0].map(key);
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}
