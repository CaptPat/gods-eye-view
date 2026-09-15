/** OurAirports CSV → compact rows for large and medium airports. Pure: used by the build script. */
import { parseCsv } from '../csv-points/csv.js';

export const OURAIRPORTS_CSV_URL =
  'https://davidmegginson.github.io/ourairports-data/airports.csv';

export const AIRPORT_FIELDS = Object.freeze([
  'id',
  'size',
  'name',
  'icao',
  'iata',
  'lat',
  'lon',
  'elevationFt',
  'city',
  'country',
  'scheduled',
  'wikipedia',
]);

const SIZES = Object.freeze({
  large_airport: 'large',
  medium_airport: 'medium',
});

function degrees(text, limit) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit
    ? Number(value.toFixed(4))
    : null;
}

export function normalizeOurAirportsCsv(text) {
  const rows = [];
  for (const airport of parseCsv(text)) {
    const size = SIZES[airport.type];
    const lat = degrees(airport.latitude_deg, 90);
    const lon = degrees(airport.longitude_deg, 180);
    if (
      !size ||
      !airport.ident ||
      !airport.name ||
      lat === null ||
      lon === null
    )
      continue;
    const elevation = airport.elevation_ft?.trim()
      ? Number(airport.elevation_ft)
      : NaN;
    rows.push([
      airport.ident,
      size,
      airport.name,
      airport.icao_code || null,
      airport.iata_code || null,
      lat,
      lon,
      Number.isFinite(elevation) ? elevation : null,
      airport.municipality || null,
      airport.iso_country || null,
      airport.scheduled_service === 'yes',
      airport.wikipedia_link || null,
    ]);
  }
  return rows;
}
