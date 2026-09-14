export const GRID_DEG = 0.05;
const GOOGLE_WEATHER_BASE = 'https://weather.googleapis.com/v1/';
const OPEN_METEO_MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_HOURS = 48;
const MAX_DAYS = 10;

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === 'string' && value ? value : null);
const rounded = (value, digits) => (value === null ? null : Number(value.toFixed(digits)));
const isoToMs = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

export function roundToGrid(value) {
  return Number((Math.round(value / GRID_DEG) * GRID_DEG).toFixed(2));
}

function coordinate(searchParams, name, limit) {
  const raw = String(searchParams.get(name) ?? '').trim();
  const value = raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

export function parseReportQuery(searchParams) {
  const lat = coordinate(searchParams, 'lat', 90);
  if (lat === null) return { error: 'lat must be a number from -90 to 90' };
  const lon = coordinate(searchParams, 'lon', 180);
  if (lon === null) return { error: 'lon must be a number from -180 to 180' };
  return { lat: roundToGrid(lat), lon: roundToGrid(lon) };
}

export function reportCacheKey({ lat, lon }) {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

function googleUrl(method, point, key, extra = {}) {
  const params = new URLSearchParams({
    'location.latitude': point.lat.toFixed(2),
    'location.longitude': point.lon.toFixed(2),
    unitsSystem: 'METRIC',
    languageCode: 'en',
    ...extra,
    key,
  });
  return `${GOOGLE_WEATHER_BASE}${method}?${params}`;
}

export const googleCurrentUrl = (point, key) => googleUrl('currentConditions:lookup', point, key);
export const googleHourlyUrl = (point, key, pageToken = '') =>
  googleUrl('forecast/hours:lookup', point, key, {
    hours: String(MAX_HOURS),
    pageSize: '24',
    ...(pageToken ? { pageToken } : {}),
  });
export const googleDailyUrl = (point, key) =>
  googleUrl('forecast/days:lookup', point, key, { days: String(MAX_DAYS), pageSize: String(MAX_DAYS) });

export function marineUrl(point) {
  const params = new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    current: 'wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature',
    daily: 'wave_height_max',
    forecast_days: '7',
    timezone: 'GMT',
  });
  return `${OPEN_METEO_MARINE_URL}?${params}`;
}

export function solarUrl(point) {
  const params = new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    current: 'shortwave_radiation,direct_radiation',
    hourly: 'soil_temperature_0cm',
    forecast_hours: '1',
    timezone: 'GMT',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

function degreesC(temperature) {
  const degrees = finite(temperature?.degrees);
  if (degrees === null) return null;
  return temperature.unit === 'FAHRENHEIT' ? rounded(((degrees - 32) * 5) / 9, 1) : degrees;
}

function speedMs(speed) {
  const value = finite(speed?.value);
  if (value === null) return null;
  return rounded(speed.unit === 'MILES_PER_HOUR' ? value * 0.44704 : value / 3.6, 2);
}

function distanceM(visibility) {
  const distance = finite(visibility?.distance);
  if (distance === null) return null;
  return Math.round(distance * (visibility.unit === 'MILES' ? 1609.344 : 1000));
}

export function googleTimeZone(json) {
  return text(json?.timeZone?.id);
}

export function normalizeGoogleNow(json) {
  if (!json || typeof json !== 'object') return null;
  return {
    condition: text(json.weatherCondition?.description?.text),
    iconType: text(json.weatherCondition?.type),
    isDaytime: json.isDaytime === true,
    temperatureC: degreesC(json.temperature),
    feelsLikeC: degreesC(json.feelsLikeTemperature),
    dewPointC: degreesC(json.dewPoint),
    humidityPct: finite(json.relativeHumidity),
    pressureHpa: finite(json.airPressure?.meanSeaLevelMillibars),
    windSpeedMs: speedMs(json.wind?.speed),
    windGustMs: speedMs(json.wind?.gust),
    windFromDeg: finite(json.wind?.direction?.degrees),
    cloudCoverPct: finite(json.cloudCover),
    visibilityM: distanceM(json.visibility),
    uvIndex: finite(json.uvIndex),
    thunderstormPct: finite(json.thunderstormProbability),
  };
}

export function normalizeGoogleHourly(pages) {
  return (Array.isArray(pages) ? pages : [])
    .flatMap((page) => (Array.isArray(page?.forecastHours) ? page.forecastHours : []))
    .map((hour) => ({
      time: isoToMs(hour?.interval?.startTime),
      condition: text(hour?.weatherCondition?.description?.text),
      iconType: text(hour?.weatherCondition?.type),
      temperatureC: degreesC(hour?.temperature),
      precipChancePct: finite(hour?.precipitation?.probability?.percent),
      windSpeedMs: speedMs(hour?.wind?.speed),
      windFromDeg: finite(hour?.wind?.direction?.degrees),
    }))
    .filter((hour) => hour.time !== null)
    .slice(0, MAX_HOURS);
}

function isoDate(displayDate) {
  const { year, month, day } = displayDate || {};
  if (![year, month, day].every((part) => Number.isInteger(part))) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeGoogleDaily(json) {
  const days = Array.isArray(json?.forecastDays) ? json.forecastDays : [];
  return days
    .map((day) => {
      const chances = [
        finite(day?.daytimeForecast?.precipitation?.probability?.percent),
        finite(day?.nighttimeForecast?.precipitation?.probability?.percent),
      ].filter((value) => value !== null);
      return {
        date: isoDate(day?.displayDate),
        dayCondition: text(day?.daytimeForecast?.weatherCondition?.description?.text),
        nightCondition: text(day?.nighttimeForecast?.weatherCondition?.description?.text),
        highC: degreesC(day?.maxTemperature),
        lowC: degreesC(day?.minTemperature),
        precipChancePct: chances.length ? Math.max(...chances) : null,
        sunrise: isoToMs(day?.sunEvents?.sunriseTime),
        sunset: isoToMs(day?.sunEvents?.sunsetTime),
      };
    })
    .filter((day) => day.date !== null)
    .slice(0, MAX_DAYS);
}

export function isOpenMeteoPayload(json) {
  return Boolean(json && typeof json === 'object' && json.current && typeof json.current === 'object');
}

export function normalizeMarine(json) {
  if (!isOpenMeteoPayload(json)) return null;
  const current = json.current;
  const values = {
    waveHeightM: finite(current.wave_height),
    wavePeriodS: finite(current.wave_period),
    waveFromDeg: finite(current.wave_direction),
    swellHeightM: finite(current.swell_wave_height),
    seaSurfaceTempC: finite(current.sea_surface_temperature),
  };
  if (Object.values(values).every((value) => value === null)) return null;
  const times = Array.isArray(json.daily?.time) ? json.daily.time : [];
  const maxima = Array.isArray(json.daily?.wave_height_max) ? json.daily.wave_height_max : [];
  return {
    ...values,
    dailyMaxWaveM: times
      .map((date, index) => ({ date: String(date), heightM: finite(maxima[index]) }))
      .filter((entry) => entry.heightM !== null),
  };
}

export function normalizeSolar(json) {
  return {
    shortwaveWm2: finite(json?.current?.shortwave_radiation),
    directWm2: finite(json?.current?.direct_radiation),
    surfaceTempC: finite(json?.hourly?.soil_temperature_0cm?.[0]),
  };
}
