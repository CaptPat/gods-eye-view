/**
 * Turn a value grid into run-length rectangles: equal neighbouring cells in a
 * latitude row merge into one `{ level, west, south, east, north }` (degrees).
 * Runs are capped in longitude and split at the antimeridian, so no rectangle
 * surrounds a pole or spans more than 180°. Pure: no Cesium.
 */

const round6 = (value) => Math.round(value * 1e6) / 1e6;

function wrapLongitude(lon) {
  let wrapped = lon;
  while (wrapped >= 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}

function pushRun(out, level, west, east, south, north) {
  const shift = wrapLongitude(west) - west;
  const w = round6(west + shift);
  const e = round6(east + shift);
  if (e > 180) {
    out.push({ level, west: w, south, east: 180, north });
    out.push({ level, west: -180, south, east: round6(e - 360), north });
  } else {
    out.push({ level, west: w, south, east: e, north });
  }
}

/**
 * @param {object} grid
 * @param {number} grid.cols columns; column 0's west edge is `west`
 * @param {number} grid.rows rows; row 0's south edge is `south`
 * @param {number} grid.west
 * @param {number} grid.south
 * @param {number} grid.cellDeg cell size in degrees
 * @param {(row: number, col: number) => number | null | undefined} grid.levelAt
 * @param {number} [grid.maxRunDeg] longest rectangle, in degrees of longitude
 */
export function buildBands({
  cols,
  rows,
  west,
  south,
  cellDeg,
  levelAt,
  maxRunDeg = 90,
}) {
  const out = [];
  if (!(cols > 0) || !(rows > 0) || !(cellDeg > 0)) return out;
  const maxCells = Math.max(1, Math.floor(maxRunDeg / cellDeg));
  for (let row = 0; row < rows; row += 1) {
    const s = round6(Math.max(-90, south + row * cellDeg));
    const n = round6(Math.min(90, south + (row + 1) * cellDeg));
    if (n <= s) continue;
    let col = 0;
    while (col < cols) {
      const level = levelAt(row, col);
      if (level === null || level === undefined) {
        col += 1;
        continue;
      }
      let end = col + 1;
      while (end < cols && end - col < maxCells && levelAt(row, end) === level)
        end += 1;
      pushRun(out, level, west + col * cellDeg, west + end * cellDeg, s, n);
      col = end;
    }
  }
  return out;
}
