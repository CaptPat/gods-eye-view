/**
 * RFC 4180 CSV → objects keyed by the header row. Quoted fields may contain
 * commas, doubled quotes and line breaks; CR outside quotes is ignored and
 * blank lines are skipped. Pure: used by the bundled-data build scripts.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') endField();
    else if (char === '\n') endRow();
    else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length) endRow();
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) =>
      Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])),
    );
}
