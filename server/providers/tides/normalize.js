export const MDAPI_STATIONS_URL =
  'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json';
export const DATAGETTER_URL =
  'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
export const APPLICATION_NAME = 'CyclopsView';
export const PREDICTION_WINDOW_HOURS = 72;
/** Layer kind → CO-OPS Metadata API station `type`. */
export const STATION_TYPES = Object.freeze({
  tide: 'waterlevels',
  current: 'currentpredictions',
});
export const STATION_ID_PATTERN = /^[A-Za-z0-9]{1,16}$/;
const HOUR_MS = 3_600_000;
const EARTH_RADIUS_KM = 6371;

/** Metadata `timezone` abbreviation → IANA zone (HAST and AST are split by `state`). */
const ZONES = Object.freeze({
  EST: 'America/New_York',
  CST: 'America/Chicago',
  PST: 'America/Los_Angeles',
  AKST: 'America/Anchorage',
  ChST: 'Pacific/Guam',
  SST: 'Pacific/Pago_Pago',
  NZST: 'Pacific/Kwajalein',
});

const finite = (value) => {
  const number =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const rounded = (value, digits) => Number(value.toFixed(digits));

export function stationListUrl(kind) {
  return `${MDAPI_STATIONS_URL}?type=${STATION_TYPES[kind]}`;
}

/**
 * The metadata's `observedst` flag is unreliable (Pearl Harbor says true and
 * stays at UTC−10), so zones come from the abbreviation and the state.
 */
export function tideStationTimeZone(timezone, state) {
  if (timezone === 'HAST')
    return state === 'AK' ? 'America/Adak' : 'Pacific/Honolulu';
  if (timezone === 'AST')
    return state === 'Bermuda' ? 'Atlantic/Bermuda' : 'America/Puerto_Rico';
  return ZONES[timezone] ?? null;
}

function coordinates(entry) {
  const lat = finite(entry?.lat);
  const lon = finite(entry?.lng);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return { lat: rounded(lat, 5), lon: rounded(lon, 5) };
}

/** Tidal and Great Lakes water-level stations; non-tidal stations are dropped. */
export function normalizeTideStations(json) {
  if (!Array.isArray(json?.stations)) return null;
  const byId = new Map();
  for (const entry of json.stations) {
    const id = text(entry?.id);
    if (!STATION_ID_PATTERN.test(id) || byId.has(id)) continue;
    const greatLakes = entry.greatlakes === true;
    if (entry.tidal !== true && !greatLakes) continue;
    const point = coordinates(entry);
    if (!point) continue;
    byId.set(id, {
      id,
      name: text(entry.name) || id,
      ...point,
      state: text(entry.state),
      timeZone: tideStationTimeZone(entry.timezone, entry.state),
      greatLakes,
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function distanceKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Current stations carry no usable zone; borrow the nearest water-level station's. */
export function nearestTimeZone(point, tideStations) {
  let best = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const station of tideStations) {
    if (!station.timeZone) continue;
    const km = distanceKm(point, station);
    if (km < bestKm) {
      bestKm = km;
      best = station;
    }
  }
  return best?.timeZone ?? null;
}

/** One entry per station id with its prediction bins; weak-and-variable (W) and bin 0 are dropped. */
export function normalizeCurrentStations(json, tideStations = []) {
  if (!Array.isArray(json?.stations)) return null;
  const byId = new Map();
  for (const entry of json.stations) {
    const id = text(entry?.id);
    if (!STATION_ID_PATTERN.test(id) || entry.type === 'W') continue;
    const bin = finite(entry.currbin);
    if (!Number.isInteger(bin) || bin < 1) continue;
    const point = coordinates(entry);
    if (!point) continue;
    let station = byId.get(id);
    if (!station) {
      station = {
        id,
        name: text(entry.name) || id,
        ...point,
        bins: [],
        timeZone: null,
      };
      byId.set(id, station);
    }
    if (!station.bins.includes(bin)) station.bins.push(bin);
  }
  const stations = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const station of stations) {
    station.bins.sort((a, b) => a - b);
    station.timeZone = nearestTimeZone(station, tideStations);
  }
  return stations;
}

/** `yyyyMMdd HH:00` in UTC for the hour containing `nowMs`. */
export function beginHour(nowMs) {
  const iso = new Date(Math.floor(nowMs / HOUR_MS) * HOUR_MS).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

function datagetterUrl(params) {
  const query = new URLSearchParams({
    ...params,
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    application: APPLICATION_NAME,
  });
  return `${DATAGETTER_URL}?${query}`;
}

export function hiloUrl(id, nowMs) {
  return datagetterUrl({
    product: 'predictions',
    station: id,
    begin_date: beginHour(nowMs),
    range: String(PREDICTION_WINDOW_HOURS),
    datum: 'MLLW',
    interval: 'hilo',
  });
}

export function waterLevelUrl(id, datum) {
  return datagetterUrl({
    product: 'water_level',
    station: id,
    date: 'latest',
    datum,
  });
}

export function latestPredictionUrl(id) {
  return datagetterUrl({
    product: 'predictions',
    station: id,
    date: 'latest',
    datum: 'MLLW',
  });
}

export function currentsUrl(id, bin, nowMs) {
  return datagetterUrl({
    product: 'currents_predictions',
    station: id,
    bin: String(bin),
    begin_date: beginHour(nowMs),
    range: String(PREDICTION_WINDOW_HOURS),
    interval: 'MAX_SLACK',
  });
}

/**
 * CO-OPS reports failures three ways: `{ error: { message } }` with HTTP 400,
 * the same body with HTTP 200, and an API-gateway `{ message: 'Forbidden' }`.
 */
export function upstreamError(json) {
  if (!json || typeof json !== 'object') return 'malformed response';
  const message =
    json.error?.message ??
    (typeof json.message === 'string' ? json.message : null);
  if (message === null || message === undefined) return null;
  return String(message).trim() || 'upstream error';
}

/** `yyyy-MM-dd HH:mm` in GMT → epoch ms. */
export function parseGmtTime(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)
  )
    return null;
  const ms = Date.parse(`${value.replace(' ', 'T')}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeHilo(json) {
  if (!Array.isArray(json?.predictions)) return null;
  return json.predictions
    .map((row) => ({
      time: parseGmtTime(row?.t),
      type: row?.type === 'H' ? 'high' : row?.type === 'L' ? 'low' : null,
      heightM: finite(row?.v),
    }))
    .filter(
      (row) => row.time !== null && row.type !== null && row.heightM !== null,
    )
    .sort((a, b) => a.time - b.time);
}

export function normalizeWaterLevel(json) {
  const row = Array.isArray(json?.data) ? json.data.at(-1) : null;
  const time = parseGmtTime(row?.t);
  const heightM = finite(row?.v);
  return time === null || heightM === null ? null : { time, heightM };
}

/** The 6-minute prediction at exactly the observation's timestamp. */
export function predictionAt(json, time) {
  if (!Array.isArray(json?.predictions)) return null;
  return finite(
    json.predictions.find((row) => parseGmtTime(row?.t) === time)?.v,
  );
}

export function normalizeCurrents(json) {
  const block = json?.current_predictions;
  if (!Array.isArray(block?.cp)) return null;
  if (typeof block.units === 'string' && !block.units.includes('cm/s'))
    return null;
  const events = block.cp
    .map((row) => ({
      time: parseGmtTime(row?.Time),
      type: ['flood', 'ebb', 'slack'].includes(row?.Type) ? row.Type : null,
      velocity: finite(row?.Velocity_Major),
    }))
    .filter(
      (row) => row.time !== null && row.type !== null && row.velocity !== null,
    )
    .map(({ time, type, velocity }) => ({
      time,
      type,
      speedMs: rounded(Math.abs(velocity) / 100, 3),
    }))
    .sort((a, b) => a.time - b.time);
  const first = block.cp[0] ?? {};
  return {
    depthM: finite(first.Depth),
    floodDirDeg: finite(first.meanFloodDir),
    ebbDirDeg: finite(first.meanEbbDir),
    events,
  };
}
