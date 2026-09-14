export const SEVERE_WEATHER_LAYER_ID = 'severe-weather';
export const SEVERE_WEATHER_OVERLAY_SOURCE_ID = 'severe-weather';
/** Card lines stay short enough for a 400 px wide viewport. */
export const CARD_LINE_MAX = 44;
/** Upper bound on drawn NWS polygon positions; a quiet day measured 32,853. */
export const MAX_RENDER_POSITIONS = 150_000;
/** Conventional warning / watch / advisory colours. */
export const NWS_CATEGORY_COLORS = Object.freeze({
  emergency: '#ff2d95',
  warning: '#ff3b30',
  watch: '#ff9500',
  advisory: '#ffcc00',
  statement: '#5ac8fa',
});
/** GDACS alert-level colours. */
export const GDACS_ALERT_COLORS = Object.freeze({
  Green: '#34c759',
  Orange: '#ff9500',
  Red: '#ff3b30',
});
const CATEGORY_RANK = Object.freeze({
  emergency: 5,
  warning: 4,
  watch: 3,
  advisory: 2,
  statement: 1,
});
const SEVERITY_RANK = Object.freeze({
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
});
const SOURCE_STATUSES = Object.freeze(['ok', 'stale', 'unavailable']);
const MONTHS = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

export function nwsCategory(event) {
  const name = String(event ?? '');
  if (/\bEmergency\b/i.test(name)) return 'emergency';
  if (/\bWarning\b/i.test(name)) return 'warning';
  if (/\bWatch\b/i.test(name)) return 'watch';
  if (/\bAdvisory\b/i.test(name)) return 'advisory';
  return 'statement';
}

export function nwsAlertRank(alert) {
  return (
    CATEGORY_RANK[nwsCategory(alert?.event)] * 10 +
    (SEVERITY_RANK[alert?.severity] ?? 0)
  );
}

export function clampLine(value, max = CARD_LINE_MAX) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Validate the `/api/severe-weather` body; null when it is not usable. */
export function parseSevereWeatherPayload(payload) {
  const nws = payload?.nws;
  const gdacs = payload?.gdacs;
  if (!Array.isArray(nws?.alerts) || !Array.isArray(gdacs?.events)) return null;
  const statusOf = (value) =>
    SOURCE_STATUSES.includes(value) ? value : 'unavailable';
  return {
    nws: {
      status: statusOf(nws.status),
      alerts: nws.alerts.filter(
        (alert) =>
          typeof alert?.id === 'string' && typeof alert.event === 'string',
      ),
      zones: nws.zones && typeof nws.zones === 'object' ? nws.zones : {},
      unmappedAlerts: Number.isInteger(nws.unmappedAlerts)
        ? nws.unmappedAlerts
        : 0,
    },
    gdacs: {
      status: statusOf(gdacs.status),
      events: gdacs.events
        .filter(
          (event) =>
            typeof event?.id === 'string' &&
            Number.isFinite(event.lon) &&
            Number.isFinite(event.lat),
        )
        .map((event) => ({
          ...event,
          track: Array.isArray(event.track) ? event.track : [],
          cone: Array.isArray(event.cone) ? event.cone : [],
        })),
    },
  };
}

/**
 * One drawable area per alert polygon or per forecast zone. A zone shared by
 * several alerts is drawn once, coloured by its highest-ranked alert.
 * Sorted lowest rank first, so the most severe areas are added last.
 */
export function buildNwsAreas(nws) {
  const areas = new Map();
  const add = (key, polygons, alert) => {
    if (!Array.isArray(polygons) || polygons.length === 0) return;
    const area = areas.get(key) ?? { key, polygons, alerts: [] };
    area.alerts.push(alert);
    areas.set(key, area);
  };
  for (const alert of nws.alerts) {
    if (alert.polygons) add(`alert:${alert.id}`, alert.polygons, alert);
    else
      for (const zone of alert.zones ?? [])
        add(`zone:${zone}`, nws.zones[zone], alert);
  }
  return [...areas.values()]
    .map((area) => {
      const alerts = [...area.alerts].sort(
        (a, b) =>
          nwsAlertRank(b) - nwsAlertRank(a) || a.event.localeCompare(b.event),
      );
      return {
        ...area,
        alerts,
        color: NWS_CATEGORY_COLORS[nwsCategory(alerts[0].event)],
      };
    })
    .sort(
      (a, b) =>
        nwsAlertRank(a.alerts[0]) - nwsAlertRank(b.alerts[0]) ||
        a.key.localeCompare(b.key),
    );
}

export function countAreaPositions(area) {
  let count = 0;
  for (const polygon of area.polygons)
    for (const ring of polygon) count += ring.length;
  return count;
}

/** Keep the highest-ranked areas within the position budget. */
export function capAreasToBudget(areas, budget = MAX_RENDER_POSITIONS) {
  const kept = [];
  let used = 0;
  let dropped = 0;
  for (let i = areas.length - 1; i >= 0; i -= 1) {
    const size = countAreaPositions(areas[i]);
    if (used + size > budget) {
      dropped += 1;
      continue;
    }
    used += size;
    kept.unshift(areas[i]);
  }
  return { areas: kept, dropped };
}

function formatOffset(zone) {
  if (zone === 'Z' || zone === '+00:00' || zone === '-00:00') return 'UTC';
  const sign = zone.startsWith('-') ? '−' : '+';
  const hours = Number(zone.slice(1, 3));
  const minutes = zone.slice(4, 6);
  return `UTC${sign}${hours}${minutes === '00' ? '' : `:${minutes}`}`;
}

/** `2026-09-15T12:00:00-08:00` → `{ text: 'Sep 15 12:00', offset: 'UTC−8' }`, in the offset NWS wrote. */
export function formatAlertTime(iso) {
  const match =
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|[+-]\d{2}:\d{2})$/.exec(
      String(iso ?? ''),
    );
  if (!match) return null;
  const [, month, day, hour, minute, zone] = match;
  return {
    text: `${MONTHS[Number(month) - 1]} ${Number(day)} ${hour}:${minute}`,
    offset: formatOffset(zone),
  };
}

/** Onset to end of the hazard (`ends`, else the message `expires`), in the alert area's local time. */
export function formatAlertWindow(alert) {
  const start = formatAlertTime(alert?.onset);
  const end = formatAlertTime(alert?.ends ?? alert?.expires);
  if (start && end) {
    return start.offset === end.offset
      ? `${start.text} – ${end.text} ${end.offset}`
      : `${start.text} ${start.offset} – ${end.text} ${end.offset}`;
  }
  if (start) return `From ${start.text} ${start.offset}`;
  if (end) return `Until ${end.text} ${end.offset}`;
  return null;
}

/** weather.gov's point forecast page lists every active alert for that spot. */
export function forecastPageUrl(lat, lon) {
  return `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
}

export function buildNwsCard(area, { lat, lon }) {
  const [alert, ...others] = area.alerts;
  const details = [
    clampLine(`${alert.severity} · ${alert.urgency} · ${alert.certainty}`),
  ];
  const window = formatAlertWindow(alert);
  if (window) details.push(clampLine(window));
  if (alert.areaDesc) details.push(clampLine(alert.areaDesc));
  if (alert.headline) details.push(clampLine(alert.headline));
  if (others.length)
    details.push(
      clampLine(
        `+${others.length} more: ${others.map((other) => other.event).join(', ')}`,
      ),
    );
  details.push('Open weather.gov forecast');
  return {
    title: clampLine(alert.event),
    details,
    accent: area.color,
    link: forecastPageUrl(lat, lon),
    source: 'NWS',
    label: alert.event,
    properties: {
      event: alert.event,
      headline: alert.headline,
      severity: alert.severity,
      urgency: alert.urgency,
      certainty: alert.certainty,
      onset: alert.onset,
      ends: alert.ends,
      expires: alert.expires,
      areaDesc: alert.areaDesc,
      senderName: alert.senderName,
      otherAlerts: others.map((other) => other.event),
    },
  };
}

function formatUtcDate(ms) {
  const date = new Date(ms);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function formatGdacsDates(event) {
  const from = Number.isFinite(event?.fromDate)
    ? formatUtcDate(event.fromDate)
    : null;
  const to = Number.isFinite(event?.toDate)
    ? formatUtcDate(event.toDate)
    : null;
  if (from && to) return from === to ? `${from} UTC` : `${from} – ${to} UTC`;
  if (from) return `From ${from} UTC`;
  if (to) return `Until ${to} UTC`;
  return null;
}

export function buildGdacsCard(event) {
  const details = [`${event.alertLevel} alert · ${event.typeName}`];
  const dates = formatGdacsDates(event);
  if (dates) details.push(dates);
  if (event.country) details.push(clampLine(event.country));
  if (event.reportUrl) details.push('Open GDACS report');
  return {
    title: clampLine(event.name),
    details,
    accent: GDACS_ALERT_COLORS[event.alertLevel] ?? GDACS_ALERT_COLORS.Green,
    link: event.reportUrl ?? null,
    source: 'GDACS',
    label: event.name,
    properties: {
      type: event.typeName,
      alertLevel: event.alertLevel,
      country: event.country ?? null,
      fromDate: event.fromDate ?? null,
      toDate: event.toDate ?? null,
      reportUrl: event.reportUrl ?? null,
    },
  };
}

/** Layer row stats; `layerPanel._buildMetaText` renders them (see the model test). */
export function buildStats({
  payload,
  lastUpdate = null,
  error = null,
  droppedAreas = 0,
}) {
  if (!payload) {
    return error
      ? {
          status: 'unavailable',
          source: 'NWS · GDACS',
          error: 'Severe weather sources unavailable',
        }
      : { status: 'ok', source: 'NWS · GDACS', count: 0, lastUpdate: null };
  }
  const part = (label, source, count, notes = []) => {
    if (source.status === 'unavailable') return `${label} unavailable`;
    const detail = source.status === 'stale' ? [...notes, 'stale'] : notes;
    return detail.length
      ? `${label} ${count} (${detail.join(', ')})`
      : `${label} ${count}`;
  };
  const nwsNotes = [];
  if (payload.nws.unmappedAlerts > 0)
    nwsNotes.push(`${payload.nws.unmappedAlerts} unmapped`);
  if (droppedAreas > 0) nwsNotes.push(`${droppedAreas} hidden`);
  const nwsCount = payload.nws.alerts.length;
  const gdacsCount = payload.gdacs.events.length;
  const stats = {
    status: 'ok',
    source: `${part('NWS', payload.nws, nwsCount, nwsNotes)} · ${part('GDACS', payload.gdacs, gdacsCount)}`,
    count: nwsCount + gdacsCount,
    lastUpdate,
  };
  if (error)
    return { ...stats, stale: true, error: 'Severe weather refresh failed' };
  if (payload.nws.status === 'stale' || payload.gdacs.status === 'stale')
    return { ...stats, stale: true };
  if (
    payload.nws.status === 'unavailable' ||
    payload.gdacs.status === 'unavailable'
  ) {
    return { ...stats, degraded: true };
  }
  return stats;
}
