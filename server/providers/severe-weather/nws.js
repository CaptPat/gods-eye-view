import { simplifyGeometry } from './geometry.js';

export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';
export const NWS_ZONE_URL_PREFIX = 'https://api.weather.gov/zones/';
const ZONE_KEY = /^(forecast|county|fire)\/[A-Z]{2}[CZ]\d{3}$/;
const SEVERITIES = Object.freeze([
  'Extreme',
  'Severe',
  'Moderate',
  'Minor',
  'Unknown',
]);
const URGENCIES = Object.freeze([
  'Immediate',
  'Expected',
  'Future',
  'Past',
  'Unknown',
]);
const CERTAINTIES = Object.freeze([
  'Observed',
  'Likely',
  'Possible',
  'Unlikely',
  'Unknown',
]);
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

export function isZoneKey(key) {
  return ZONE_KEY.test(String(key ?? ''));
}

/** `https://api.weather.gov/zones/forecast/AKZ844` → `forecast/AKZ844`; anything else → null. */
export function zoneKeyFromUrl(url) {
  const text = String(url ?? '');
  if (!text.startsWith(NWS_ZONE_URL_PREFIX)) return null;
  const key = text.slice(NWS_ZONE_URL_PREFIX.length);
  return isZoneKey(key) ? key : null;
}

export function zoneUrl(key) {
  return `${NWS_ZONE_URL_PREFIX}${key}`;
}

const cleanText = (value, max = 400) => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
};
const oneOf = (values, value) => (values.includes(value) ? value : 'Unknown');
/** Keep the NWS string as written: its offset is the alert area's local time. */
const isoTime = (value) =>
  typeof value === 'string' &&
  ISO_WITH_OFFSET.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;

/** Active alerts → `Actual` messages with their own simplified polygons, or the zone keys to resolve. */
export function normalizeNwsAlerts(json) {
  if (!json || !Array.isArray(json.features)) return null;
  const updatedAt = Date.parse(json.updated);
  const seen = new Set();
  const alerts = [];
  for (const feature of json.features) {
    const p = feature?.properties;
    if (!p || p.status !== 'Actual') continue;
    const id = cleanText(p.id, 200);
    const event = cleanText(p.event, 80);
    if (!id || !event || seen.has(id)) continue;
    seen.add(id);
    const polygons = feature.geometry ? simplifyGeometry(feature.geometry) : [];
    const zones = polygons.length
      ? []
      : [
          ...new Set(
            (Array.isArray(p.affectedZones) ? p.affectedZones : [])
              .map(zoneKeyFromUrl)
              .filter(Boolean),
          ),
        ];
    alerts.push({
      id,
      event,
      headline: cleanText(p.headline),
      severity: oneOf(SEVERITIES, p.severity),
      urgency: oneOf(URGENCIES, p.urgency),
      certainty: oneOf(CERTAINTIES, p.certainty),
      onset: isoTime(p.onset) ?? isoTime(p.effective),
      ends: isoTime(p.ends),
      expires: isoTime(p.expires),
      areaDesc: cleanText(p.areaDesc),
      senderName: cleanText(p.senderName, 120),
      zones,
      polygons: polygons.length ? polygons : null,
    });
  }
  return { updatedAt: Number.isFinite(updatedAt) ? updatedAt : null, alerts };
}
