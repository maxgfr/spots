/**
 * A small RFC 4180 CSV parser: quoted fields, doubled quotes inside them, CRLF, LF or CR line
 * ends, newlines inside quotes, a leading byte order mark and a final line end. Lenient on
 * malformed input (a stray quote inside an unquoted field is kept as is) rather than throwing.
 */

/** Parses CSV text into rows of fields. A final empty line does not make an extra row. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  /** Whether anything was read since the last line end. */
  let open = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    open = false;
  };

  while (i < src.length) {
    const c = src[i];
    open = true;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" || c === "\n") {
      endRow();
      if (c === "\r" && src[i + 1] === "\n") i++;
    } else {
      field += c;
    }
    i++;
  }
  // Text not ending with a line end leaves a last row open.
  if (open) endRow();
  return rows;
}
