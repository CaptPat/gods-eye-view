export const UNITS_STORAGE_KEY = 'gev.weatherReport.units';
export const CREDITS = Object.freeze([
  'Source: Includes weather data from Google',
  'Marine, solar and surface: Weather data by Open-Meteo.com (CC BY 4.0)',
]);
const DASH = '—';
const POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeUnits(value) {
  return value === 'metric' ? 'metric' : 'imperial';
}

export function cardinal(deg) {
  if (!isNum(deg)) return '';
  const normalized = ((deg % 360) + 360) % 360;
  return POINTS[Math.round(normalized / 22.5) % 16];
}

const temperature = (c, units) =>
  isNum(c)
    ? units === 'metric'
      ? `${Math.round(c)}°C`
      : `${Math.round((c * 9) / 5 + 32)}°F`
    : DASH;
const speedNumber = (ms, units) =>
  units === 'metric' ? Math.round(ms * 3.6) : Math.round(ms * 2.236936);
const speed = (ms, units) =>
  isNum(ms)
    ? `${speedNumber(ms, units)} ${units === 'metric' ? 'km/h' : 'mph'}`
    : DASH;
const distance = (m, units) =>
  isNum(m)
    ? units === 'metric'
      ? `${(m / 1000).toFixed(1)} km`
      : `${(m / 1609.344).toFixed(1)} mi`
    : DASH;
const pressure = (hPa, units) =>
  isNum(hPa)
    ? units === 'metric'
      ? `${Math.round(hPa)} hPa`
      : `${(hPa * 0.02953).toFixed(2)} inHg`
    : DASH;
const height = (m, units) =>
  isNum(m)
    ? units === 'metric'
      ? `${m.toFixed(1)} m`
      : `${(m * 3.28084).toFixed(1)} ft`
    : DASH;
const percent = (value) => (isNum(value) ? `${Math.round(value)}%` : DASH);
const plain = (value) => (isNum(value) ? String(Math.round(value)) : DASH);
const irradiance = (value) =>
  isNum(value) ? `${Math.round(value)} W/m²` : DASH;
const wind = (ms, deg, units) =>
  isNum(ms) ? `${cardinal(deg)} ${speed(ms, units)}`.trim() : DASH;
const textOr = (value) => (typeof value === 'string' && value ? value : DASH);

export function formatClock(ms, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timeZone || 'UTC',
  }).format(ms);
}

export function utcOffsetLabel(ms, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(ms)
    .find((entry) => entry.type === 'timeZoneName');
  // Node formats UTC itself as "GMT" or "GMT+0"; both mean no offset.
  const offset = String(part?.value || 'GMT')
    .replace(/^GMT/, '')
    .replace(/^[+-]0$/, '');
  return offset ? `UTC${offset.replace('-', '−')}` : 'UTC';
}

function dayLabel(isoDate) {
  const ms = Date.parse(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(ms)) return DASH;
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(ms);
  return `${weekday} ${new Date(ms).getUTCDate()}`;
}

function forecastStatus(state) {
  if (state === 'not-configured') return 'Google weather not configured';
  return state === 'ok' ? null : 'Google forecast unavailable';
}

export function buildReportView(
  report,
  { units: rawUnits, now = Date.now() } = {},
) {
  const units = normalizeUnits(rawUnits);
  const sources = report.sources || {};
  const coordinates = `${report.point.lat.toFixed(3)}, ${report.point.lon.toFixed(3)}`;
  const clock = formatClock(report.generatedAt, report.timeZone);
  const n = sources.google === 'ok' ? report.now : null;
  const firstDay = sources.google === 'ok' ? report.daily?.[0] : null;

  const solarRows = [];
  if (sources.openMeteoSolar === 'ok' && report.solar) {
    solarRows.push(
      {
        label: 'Shortwave radiation',
        value: irradiance(report.solar.shortwaveWm2),
      },
      { label: 'Direct radiation', value: irradiance(report.solar.directWm2) },
      {
        label: 'Surface temperature',
        value: temperature(report.solar.surfaceTempC, units),
      },
    );
  }
  if (firstDay && isNum(firstDay.sunrise) && isNum(firstDay.sunset)) {
    solarRows.push(
      {
        label: 'Sunrise',
        value: formatClock(firstDay.sunrise, report.timeZone),
      },
      { label: 'Sunset', value: formatClock(firstDay.sunset, report.timeZone) },
    );
  }

  const marine = sources.openMeteoMarine === 'ok' ? report.marine : null;
  return {
    title: report.place || coordinates,
    coordinates,
    updated: report.timeZone
      ? `Updated ${clock} local (${utcOffsetLabel(report.generatedAt, report.timeZone)})`
      : `Updated ${clock} UTC`,
    status: report.stale
      ? `Showing weather from ${Math.max(0, Math.round((now - report.generatedAt) / 60_000))} min ago`
      : null,
    now: n
      ? {
          temperature: temperature(n.temperatureC, units),
          condition: textOr(n.condition),
          feelsLike: `Feels like ${temperature(n.feelsLikeC, units)}`,
          grid: [
            { label: 'Humidity', value: percent(n.humidityPct) },
            { label: 'Dew point', value: temperature(n.dewPointC, units) },
            { label: 'Pressure', value: pressure(n.pressureHpa, units) },
            { label: 'Wind', value: wind(n.windSpeedMs, n.windFromDeg, units) },
            { label: 'Gusts', value: speed(n.windGustMs, units) },
            { label: 'Cloud cover', value: percent(n.cloudCoverPct) },
            { label: 'Visibility', value: distance(n.visibilityM, units) },
            { label: 'UV index', value: plain(n.uvIndex) },
            { label: 'Thunderstorms', value: percent(n.thunderstormPct) },
          ],
        }
      : null,
    hourly:
      sources.google === 'ok'
        ? (report.hourly || []).map((hour) => ({
            time: formatClock(hour.time, report.timeZone),
            condition: textOr(hour.condition),
            temperature: temperature(hour.temperatureC, units),
            precip: percent(hour.precipChancePct),
            wind: wind(hour.windSpeedMs, hour.windFromDeg, units),
          }))
        : [],
    daily:
      sources.google === 'ok'
        ? (report.daily || []).map((day) => ({
            day: dayLabel(day.date),
            dayCondition: textOr(day.dayCondition),
            nightCondition: textOr(day.nightCondition),
            high: temperature(day.highC, units),
            low: temperature(day.lowC, units),
            precip: percent(day.precipChancePct),
          }))
        : [],
    marine: marine
      ? {
          rows: [
            {
              label: 'Waves',
              value: `${height(marine.waveHeightM, units)} from ${cardinal(marine.waveFromDeg) || DASH}, ${plain(marine.wavePeriodS)} s`,
            },
            { label: 'Swell', value: height(marine.swellHeightM, units) },
            {
              label: 'Sea surface',
              value: temperature(marine.seaSurfaceTempC, units),
            },
          ],
          dailyMax: (marine.dailyMaxWaveM || []).map((entry) => ({
            day: dayLabel(entry.date),
            value: height(entry.heightM, units),
          })),
        }
      : null,
    solar: solarRows.length ? { rows: solarRows } : null,
    sections: {
      forecast: forecastStatus(sources.google),
      marine:
        sources.openMeteoMarine === 'unavailable'
          ? 'Open-Meteo unavailable'
          : null,
      solar:
        sources.openMeteoSolar === 'unavailable'
          ? 'Open-Meteo unavailable'
          : null,
    },
    credits: CREDITS,
    pin: n
      ? {
          title: `${temperature(n.temperatureC, units)} · ${textOr(n.condition)}`,
          details: [
            isNum(n.windSpeedMs)
              ? `Wind ${speed(n.windSpeedMs, units)} ${cardinal(n.windFromDeg)}`.trim() +
                (isNum(n.windGustMs)
                  ? `, gusts ${speedNumber(n.windGustMs, units)}`
                  : '')
              : 'Wind —',
            'Includes weather data from Google',
          ],
        }
      : { title: 'Weather unavailable', details: [] },
  };
}
