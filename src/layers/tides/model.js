/** The weather report's units switch; station cards follow the same preference. */
export const UNITS_STORAGE_KEY = 'gev.weatherReport.units';
export const NOAA_SOURCE = 'NOAA CO-OPS';
export const CARD_LOADING = 'Loading NOAA CO-OPS…';
export const CARD_FAILED = 'NOAA CO-OPS unavailable';

export const STATION_LAYERS = Object.freeze({
  tide: Object.freeze({
    kind: 'tide',
    id: 'tide-stations',
    name: 'Tide Stations',
    icon: '🌊',
    color: '#38bdf8',
    selectedSourceId: 'tide-stations-selected',
  }),
  current: Object.freeze({
    kind: 'current',
    id: 'current-stations',
    name: 'Current Stations',
    icon: '🧭',
    color: '#f59e0b',
    selectedSourceId: 'current-stations-selected',
  }),
});

const DASH = '—';
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const TITLE_NAME_CHARS = 30;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeUnits(value) {
  return value === 'metric' ? 'metric' : 'imperial';
}

export function cardinal(deg) {
  if (!isNum(deg)) return '';
  const normalized = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(normalized / 22.5) % 16];
}

/** Validate `/api/tides/stations` for one layer kind. */
export function parseStationsPayload(payload, kind) {
  if (!payload || payload.kind !== kind || !Array.isArray(payload.stations)) return null;
  const stations = [];
  for (const entry of payload.stations) {
    const lat = Number(entry?.lat);
    const lon = Number(entry?.lon);
    if (typeof entry?.id !== 'string' || !entry.id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const station = {
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      lat,
      lon,
      timeZone: typeof entry.timeZone === 'string' && entry.timeZone ? entry.timeZone : null,
    };
    if (kind === 'tide') {
      station.greatLakes = entry.greatLakes === true;
    } else {
      station.bins = Array.isArray(entry.bins) ? entry.bins.filter((bin) => Number.isInteger(bin) && bin > 0) : [];
      if (!station.bins.length) continue;
    }
    stations.push(station);
  }
  return { stations, stale: payload.stale === true };
}

/** `Mon 16:11 EDT` in the station's zone, or UTC when the zone is unknown. */
export function formatStationTime(ms, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    }).formatToParts(ms);
  } catch {
    return timeZone ? formatStationTime(ms, null) : DASH;
  }
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('weekday')} ${part('hour')}:${part('minute')} ${part('timeZoneName')}`;
}

export function formatHeight(meters, units) {
  if (!isNum(meters)) return DASH;
  return units === 'metric' ? `${meters.toFixed(2)} m` : `${(meters * 3.28084).toFixed(1)} ft`;
}

export function formatSpeed(metersPerSecond, units) {
  if (!isNum(metersPerSecond)) return DASH;
  return units === 'metric'
    ? `${metersPerSecond.toFixed(2)} m/s`
    : `${(metersPerSecond * 1.943844).toFixed(1)} kn`;
}

export function formatDepth(meters, units) {
  if (!isNum(meters)) return DASH;
  return units === 'metric' ? `${meters.toFixed(1)} m` : `${Math.round(meters * 3.28084)} ft`;
}

export function noaaStationUrl(kind, id, bin) {
  const station = encodeURIComponent(id);
  return kind === 'current'
    ? `https://tidesandcurrents.noaa.gov/noaacurrents/predictions?id=${station}_${bin}`
    : `https://tidesandcurrents.noaa.gov/stationhome.html?id=${station}`;
}

export function stationTitle(station) {
  const name =
    station.name.length > TITLE_NAME_CHARS ? `${station.name.slice(0, TITLE_NAME_CHARS - 1)}…` : station.name;
  return `${name} · ${station.id}`;
}

export function buildPendingCard(station, message) {
  return { title: stationTitle(station), details: [message] };
}

/** The next four highs and lows, the latest observation against its prediction, and the datum. */
export function buildTideCard(station, report, { units, now }) {
  const system = normalizeUnits(units);
  const zone = station.timeZone;
  const details = [];
  if (station.greatLakes) {
    details.push('Great Lakes: no tide predictions');
  } else if (report.sources?.predictions === 'ok') {
    const next = (report.predictions ?? []).filter((entry) => entry.time > now).slice(0, 4);
    if (!next.length) details.push('No upcoming tides in range');
    for (const entry of next) {
      const label = entry.type === 'high' ? 'High' : 'Low';
      details.push(`${label} ${formatHeight(entry.heightM, system)} · ${formatStationTime(entry.time, zone)}`);
    }
  } else {
    details.push('Tide predictions unavailable');
  }
  if (report.observed) {
    const predicted = isNum(report.observed.predictedM)
      ? ` vs pred ${formatHeight(report.observed.predictedM, system)}`
      : '';
    details.push(
      `Obs ${formatHeight(report.observed.heightM, system)}${predicted} · ${formatStationTime(report.observed.time, zone)}`,
    );
  } else {
    details.push('Latest observation unavailable');
  }
  details.push(`Datum ${report.datum} · click card for NOAA page`);
  return { title: stationTitle(station), details };
}

/** The next maximum flood and ebb with direction, the next slack, and the bin depth. */
export function buildCurrentCard(station, report, { units, now }) {
  const system = normalizeUnits(units);
  const zone = station.timeZone;
  const bin = [`Bin ${report.bin}`];
  if (isNum(report.depthM)) bin.push(`depth ${formatDepth(report.depthM, system)}`);
  if (station.bins.length > 1) bin.push(`${station.bins.length} bins`);
  const details = [bin.join(' · ')];
  if (report.sources?.predictions !== 'ok') {
    details.push('Current predictions unavailable');
  } else {
    const upcoming = (report.events ?? []).filter((event) => event.time > now);
    const next = (type) => upcoming.find((event) => event.type === type);
    const flow = (label, event, deg) =>
      event
        ? `${label} ${formatSpeed(event.speedMs, system)} ${cardinal(deg)} (${Math.round(deg)}°) · ${formatStationTime(event.time, zone)}`
        : `${label} ${DASH}`;
    details.push(flow('Flood', next('flood'), report.floodDirDeg));
    details.push(flow('Ebb', next('ebb'), report.ebbDirDeg));
    const slack = next('slack');
    details.push(slack ? `Slack · ${formatStationTime(slack.time, zone)}` : `Slack ${DASH}`);
  }
  details.push('Click card for NOAA predictions');
  return { title: stationTitle(station), details };
}
