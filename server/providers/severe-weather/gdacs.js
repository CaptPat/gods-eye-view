import { cleanPositions, simplifyGeometry } from './geometry.js';

export const GDACS_EVENTS_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';
export const GDACS_CYCLONES_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC';
/** Earthquakes (EQ) are deliberately absent: the app already has a USGS Earthquakes layer. */
export const GDACS_EVENT_TYPES = Object.freeze({
  TC: 'Tropical cyclone',
  FL: 'Flood',
  DR: 'Drought',
  VO: 'Volcano',
  WF: 'Wildfire',
});
const ALERT_LEVELS = Object.freeze(['Green', 'Orange', 'Red']);
const REPORT_URL =
  /^https:\/\/www\.gdacs\.org\/report\.aspx\?eventid=\d+&episodeid=\d+&eventtype=[A-Z]{2}$/;
const GDACS_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** GDACS list dates carry no offset; they are UTC. */
export function parseGdacsDate(value) {
  if (typeof value !== 'string' || !GDACS_DATE.test(value)) return null;
  const ms = Date.parse(`${value}Z`);
  return Number.isFinite(ms) ? ms : null;
}

const cleanText = (value, max = 160) => {
  const text =
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text ? text.slice(0, max) : null;
};

/** EVENTS4APP → point events of the kept types, with the GDACS report link. */
export function normalizeGdacsEvents(json) {
  if (!json || !Array.isArray(json.features)) return null;
  const seen = new Set();
  const events = [];
  for (const feature of json.features) {
    const p = feature?.properties;
    const type = p?.eventtype;
    if (
      !Object.hasOwn(GDACS_EVENT_TYPES, type) ||
      !ALERT_LEVELS.includes(p.alertlevel)
    )
      continue;
    const eventId = Number(p.eventid);
    const [position] =
      feature.geometry?.type === 'Point'
        ? cleanPositions([feature.geometry.coordinates])
        : [];
    if (!Number.isSafeInteger(eventId) || !position) continue;
    const id = `${type}-${eventId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const report = p.url?.report;
    events.push({
      id,
      type,
      typeName: GDACS_EVENT_TYPES[type],
      eventId,
      name: cleanText(p.name) ?? GDACS_EVENT_TYPES[type],
      alertLevel: p.alertlevel,
      country: cleanText(p.country),
      fromDate: parseGdacsDate(p.fromdate),
      toDate: parseGdacsDate(p.todate),
      lon: position[0],
      lat: position[1],
      reportUrl:
        typeof report === 'string' && REPORT_URL.test(report) ? report : null,
      track: [],
      cone: [],
    });
  }
  return events;
}

const sameNode = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Join track segments that share endpoints; GDACS lists them out of order. */
export function joinTrackSegments(segments) {
  const pending = segments
    .map(cleanPositions)
    .filter((segment) => segment.length >= 2);
  const tracks = [];
  while (pending.length) {
    const track = pending.shift();
    let extended = true;
    while (extended) {
      extended = false;
      for (let i = 0; i < pending.length; i += 1) {
        const segment = pending[i];
        if (sameNode(track.at(-1), segment[0])) track.push(...segment.slice(1));
        else if (sameNode(segment.at(-1), track[0]))
          track.unshift(...segment.slice(0, -1));
        else continue;
        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    tracks.push(track);
  }
  return tracks;
}

/** MAP?eventtype=TC → per event id: the joined track lines and the simplified forecast cone. */
export function normalizeGdacsCycloneShapes(json) {
  const byEvent = new Map();
  if (!json || !Array.isArray(json.features)) return byEvent;
  for (const feature of json.features) {
    const p = feature?.properties;
    const eventId = Number(p?.eventid);
    if (p?.eventtype !== 'TC' || !Number.isSafeInteger(eventId)) continue;
    const entry = byEvent.get(eventId) ?? { segments: [], cone: [] };
    byEvent.set(eventId, entry);
    const line = /^Line_Line_(\d+)$/.exec(String(p.Class ?? ''));
    if (line && feature.geometry?.type === 'LineString') {
      entry.segments.push({
        index: Number(line[1]),
        coordinates: feature.geometry.coordinates,
      });
    } else if (p.Class === 'Poly_Cones') {
      entry.cone.push(...simplifyGeometry(feature.geometry));
    }
  }
  const shapes = new Map();
  for (const [eventId, entry] of byEvent) {
    const ordered = entry.segments
      .sort((a, b) => a.index - b.index)
      .map((segment) => segment.coordinates);
    const track = joinTrackSegments(ordered);
    if (track.length || entry.cone.length)
      shapes.set(eventId, { track, cone: entry.cone });
  }
  return shapes;
}

export function attachCycloneShapes(events, shapes) {
  return events.map((event) => {
    const shape = event.type === 'TC' ? shapes.get(event.eventId) : null;
    return shape ? { ...event, track: shape.track, cone: shape.cone } : event;
  });
}
