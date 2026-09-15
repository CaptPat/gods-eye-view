/** WRI Global Power Plant Database CSV → compact non-hydro rows. Pure: used by the build script. */
import { parseCsv } from '../csv-points/csv.js';

export const GPPD_CSV_URL =
  'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv';

export const POWER_PLANT_FIELDS = Object.freeze([
  'id',
  'name',
  'fuel',
  'capacityMw',
  'lat',
  'lon',
  'country',
  'commissioned',
  'owner',
]);

/** A decimal degree inside ±limit, rounded to 4 places (about 11 m), or null. */
function degrees(text, limit) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit
    ? Number(value.toFixed(4))
    : null;
}

/** Hydro is left out: dams have their own layer. */
export function normalizeGppdCsv(text) {
  const rows = [];
  for (const plant of parseCsv(text)) {
    const fuel = plant.primary_fuel?.trim();
    if (!fuel || fuel === 'Hydro') continue;
    const capacity = plant.capacity_mw?.trim()
      ? Number(plant.capacity_mw)
      : NaN;
    const lat = degrees(plant.latitude, 90);
    const lon = degrees(plant.longitude, 180);
    if (!plant.gppd_idnr || !plant.name || !Number.isFinite(capacity)) continue;
    if (lat === null || lon === null) continue;
    const year = plant.commissioning_year?.trim()
      ? Number(plant.commissioning_year)
      : NaN;
    rows.push([
      plant.gppd_idnr,
      plant.name,
      fuel,
      capacity,
      lat,
      lon,
      plant.country_long || null,
      Number.isFinite(year) ? Math.floor(year) : null,
      plant.owner?.trim() || null,
    ]);
  }
  return rows;
}
