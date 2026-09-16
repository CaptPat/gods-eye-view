/** Pure Marine Depths model: layer meta and the two NOAA imagery addresses. */

export const MARINE_DEPTHS_META = Object.freeze({
  id: 'marine-depths',
  name: 'Marine Depths',
  icon: '🌊',
  source: 'NOAA',
});

/**
 * NCEI's global DEM mosaic (GEBCO-based offshore, higher-resolution US
 * coastal models inshore). Served as float elevations, so a rendering rule
 * masks everything above sea level and colours the rest in chart-style bands.
 */
export const NCEI_DEM_EXPORT_URL =
  'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage';

/** Band upper bounds in metres (shallowest last), deep navy → pale cyan. */
export const DEPTH_BANDS = Object.freeze([
  Object.freeze({ fromM: -12000, toM: -6000, rgb: [8, 20, 62] }),
  Object.freeze({ fromM: -6000, toM: -4000, rgb: [14, 42, 104] }),
  Object.freeze({ fromM: -4000, toM: -2000, rgb: [22, 70, 140] }),
  Object.freeze({ fromM: -2000, toM: -1000, rgb: [32, 102, 172] }),
  Object.freeze({ fromM: -1000, toM: -200, rgb: [48, 134, 196] }),
  Object.freeze({ fromM: -200, toM: -100, rgb: [74, 164, 212] }),
  Object.freeze({ fromM: -100, toM: -50, rgb: [112, 192, 226] }),
  Object.freeze({ fromM: -50, toM: -20, rgb: [156, 216, 236] }),
  Object.freeze({ fromM: -20, toM: 0, rgb: [196, 234, 244] }),
]);

/**
 * The ArcGIS rendering rule: Remap each band to a class (land and anything
 * unmatched becomes NoData, so it is transparent), then Colormap the classes.
 */
export function depthRenderingRule(bands = DEPTH_BANDS) {
  return {
    rasterFunction: 'Colormap',
    rasterFunctionArguments: {
      Colormap: bands.map(({ rgb }, index) => [index + 1, ...rgb]),
      Raster: {
        rasterFunction: 'Remap',
        rasterFunctionArguments: {
          InputRanges: bands.flatMap(({ fromM, toM }) => [fromM, toM]),
          OutputValues: bands.map((_, index) => index + 1),
          AllowUnmatched: false,
        },
      },
    },
    outputPixelType: 'U8',
  };
}

/**
 * A Cesium URL template for Web Mercator tiles. UrlTemplateImageryProvider
 * fills the projected bounds per tile and `{renderingRule}` from a custom tag:
 * Cesium unescapes `%7B` before templating, so JSON cannot sit in the template.
 */
export const DEPTH_BANDS_TILE_TEMPLATE =
  `${NCEI_DEM_EXPORT_URL}?bbox={westProjected},{southProjected},{eastProjected},{northProjected}` +
  '&bboxSR=3857&imageSR=3857&size={width},{height}&format=png32' +
  '&renderingRule={renderingRule}&f=image';

/** The `{renderingRule}` tag value (Cesium URI-encodes it). */
export const DEPTH_RENDERING_RULE_JSON = JSON.stringify(depthRenderingRule());

/** Web Mercator level the global bands stop refining at (~30 m). */
export const DEPTH_BANDS_MAX_LEVEL = 12;

/**
 * NOAA's Chart Display Service renders every US ENC with S-52 symbology.
 * Sublayer 2 is "Depths, currents, etc": soundings, depth contours and depth
 * areas, with no buoys, lights or other navaids. Land draws transparent.
 */
export const NOAA_CHART_WMS_URL =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer';
export const NOAA_CHART_DEPTH_LAYER = '2';

/**
 * Chart depths only draw from this terrain level down. Zoomed further out the
 * service returns bare depth-area fills whose opaque white deep water would
 * hide the global bands without adding soundings.
 */
export const CHART_DEPTHS_MIN_TERRAIN_LEVEL = 11;
export const CHART_DEPTHS_MAX_LEVEL = 18;
