/**
 * Fork fix for Cesium draping imagery onto 3D Tiles across the 180th meridian.
 *
 * Cesium 1.138 (`ModelImageryMapping.computeCartographicBoundingRectangle`)
 * bounds a draped tile by the plain minimum and maximum vertex longitude. A
 * Google 3D tile straddling ±180° therefore gets a whole-world rectangle, and
 * its seam triangles stretch across all of the imagery: a zigzag smear along
 * the date line.
 *
 * The fix describes such a tile in unwrapped longitudes (e.g. 179°..181°, so
 * `east` runs past π), which the rest of the pipeline already handles as plain
 * min/max arithmetic, and keeps four steps consistent with it:
 *  1. the bounding rectangle is unwrapped when that makes it narrower than
 *     half the world (a polar cap that truly spans every longitude is kept);
 *  2. texture coordinates unwrap negative vertex longitudes before projecting
 *     whenever the box lies east of 0° (a seam vertex reads -180°);
 *  3. imagery coverage is computed for the parts east and west of 180° and
 *     re-expressed relative to the whole unwrapped rectangle;
 *  4. an imagery tile west of 180° (wholly in negative longitudes) is placed
 *     one world east when its texture translation and scale are computed.
 * The shader source is untouched.
 *
 * Applied only to Cesium versions it was verified against; on an upgrade it
 * steps aside (and its tests fail) until it is re-checked or Cesium fixes it.
 */
import * as CesiumModule from 'cesium';

export const DRAPE_DATELINE_FIX_VERSIONS = Object.freeze(['1.138.0']);

const TWO_PI = 2 * Math.PI;
const INSTALLED = Symbol.for('gev.drapeDatelineFix');
/** Parts narrower than this (radians) carry no imagery worth a coverage. */
const MIN_PART_WIDTH = 1e-12;
/**
 * How far (in the tile's texture coordinates) each side's coverage reaches
 * past the seam. The shader drops a fragment outside its coverage rectangle,
 * so two rectangles meeting exactly leave a float-rounding hairline at 180°.
 */
const SEAM_OVERLAP = 1e-4;

const unwrap = (longitude) => (longitude < 0 ? longitude + TWO_PI : longitude);

/** Re-express a coverage's texture rectangle from `from` to `to` (native coords). */
function relocalize(coverage, from, to, shiftX) {
  const rect = coverage.textureCoordinateRectangle;
  const minX = from.west + rect.minX * from.width + shiftX;
  const maxX = from.west + rect.maxX * from.width + shiftX;
  rect.minX = (minX - to.west) / to.width;
  rect.maxX = (maxX - to.west) / to.width;
  return coverage;
}

/**
 * Patch `cesium` in place. Returns `{ applied: true }`, or `{ applied: false,
 * reason }` when the version is untested or the fix is already in place.
 */
export function installDrapeDatelineFix(Cesium = CesiumModule) {
  const mapping = Cesium?.ModelImageryMapping;
  const coverage = Cesium?.ImageryCoverage;
  const stage = Cesium?.ImageryPipelineStage;
  if (!DRAPE_DATELINE_FIX_VERSIONS.includes(Cesium?.VERSION)) {
    return {
      applied: false,
      reason: `untested Cesium version ${Cesium?.VERSION}`,
    };
  }
  if (
    typeof mapping?.computeCartographicBoundingRectangle !== 'function' ||
    typeof mapping?._createTextureCoordinates !== 'function' ||
    typeof mapping?.map !== 'function' ||
    typeof coverage?.createImageryCoverages !== 'function' ||
    typeof stage?._computeTextureTranslationAndScale !== 'function'
  ) {
    return { applied: false, reason: 'Cesium draping internals changed' };
  }
  if (mapping[INSTALLED]) {
    return { applied: false, reason: 'already installed' };
  }

  const { Cartographic, Rectangle } = Cesium;
  const originalBounds = mapping.computeCartographicBoundingRectangle;
  const originalTexCoords = mapping._createTextureCoordinates;
  const originalCoverages = coverage.createImageryCoverages;
  const originalTranslation = stage._computeTextureTranslationAndScale;

  // 1. Unwrap a seam tile's rectangle when that makes it a narrow one.
  mapping.computeCartographicBoundingRectangle = function (
    cartographicPositions,
    result,
  ) {
    const rect = originalBounds.call(this, cartographicPositions, result);
    const width = rect.east - rect.west;
    if (!(width > Math.PI)) return rect;
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    for (const position of cartographicPositions) {
      const longitude = unwrap(position.longitude);
      west = Math.min(west, longitude);
      east = Math.max(east, longitude);
    }
    // Only a genuine seam tile: a near-global tile (a polar cap) stays as is.
    if (east - west <= Math.PI) {
      rect.west = west;
      rect.east = east;
    }
    return rect;
  };

  // 2. Project the seam tile's vertices in the same unwrapped longitudes.
  const scratch = new Cartographic();
  mapping._createTextureCoordinates = function (
    cartographicPositions,
    numPositions,
    rectangle,
    projection,
  ) {
    // A box west edge at or east of 0° can only hold a negative longitude that
    // was unwrapped, including a seam vertex Cesium reports as -180° on a tile
    // that ends exactly at 180°. Ordinary tiles have no negatives to move.
    if (!(rectangle.west >= 0)) {
      return originalTexCoords.call(
        this,
        cartographicPositions,
        numPositions,
        rectangle,
        projection,
      );
    }
    const unwrapped = mapping.map(cartographicPositions, (position) => {
      scratch.longitude = unwrap(position.longitude);
      scratch.latitude = position.latitude;
      scratch.height = position.height;
      return scratch;
    });
    return originalTexCoords.call(
      this,
      unwrapped,
      numPositions,
      rectangle,
      projection,
    );
  };

  // 3. Cover the parts either side of 180°, relative to the whole rectangle.
  coverage.createImageryCoverages = function (
    inputRectangle,
    imageryLayer,
    imageryLevel,
  ) {
    if (!(inputRectangle.east > Math.PI)) {
      return originalCoverages.call(
        this,
        inputRectangle,
        imageryLayer,
        imageryLevel,
      );
    }
    const { south, north } = inputRectangle;
    const tilingScheme = imageryLayer.imageryProvider.tilingScheme;
    const native = (rect) => tilingScheme.rectangleToNativeRectangle(rect);
    const whole = native(inputRectangle);
    const worldWidth = native(tilingScheme.rectangle).width;
    const parts = [
      // East of the seam, in place.
      [new Rectangle(inputRectangle.west, south, Math.PI, north), 0],
      // West of the seam, shifted one world east to sit after it.
      [
        new Rectangle(-Math.PI, south, inputRectangle.east - TWO_PI, north),
        worldWidth,
      ],
    ];
    // Where 180° falls in the tile's texture coordinates.
    const seamU = (native(parts[0][0]).east - whole.west) / whole.width;
    const result = [];
    for (const [part, shiftX] of parts) {
      if (!(part.east - part.west > MIN_PART_WIDTH)) continue;
      const from = native(part);
      for (const covered of originalCoverages.call(
        this,
        part,
        imageryLayer,
        imageryLevel,
      )) {
        const rect = relocalize(
          covered,
          from,
          whole,
          shiftX,
        ).textureCoordinateRectangle;
        if (Math.abs(rect.maxX - seamU) < 1e-9) rect.maxX += SEAM_OVERLAP;
        if (Math.abs(rect.minX - seamU) < 1e-9) rect.minX -= SEAM_OVERLAP;
        result.push(covered);
      }
    }
    return result;
  };

  // 4. Place an imagery tile from west of 180° beside the seam, not a world
  // away. Unwrapping only yields rectangles under half the world, so the
  // imagery level is at least 1 and no tile spans both sides of 0°.
  const shiftedImagery = new Rectangle();
  stage._computeTextureTranslationAndScale = function (
    imageryLayer,
    boundingRectangle,
    imageryRectangle,
  ) {
    if (boundingRectangle.east > Math.PI && imageryRectangle.east <= 0) {
      shiftedImagery.west = imageryRectangle.west + TWO_PI;
      shiftedImagery.east = imageryRectangle.east + TWO_PI;
      shiftedImagery.south = imageryRectangle.south;
      shiftedImagery.north = imageryRectangle.north;
      return originalTranslation.call(
        this,
        imageryLayer,
        boundingRectangle,
        shiftedImagery,
      );
    }
    return originalTranslation.call(
      this,
      imageryLayer,
      boundingRectangle,
      imageryRectangle,
    );
  };

  mapping[INSTALLED] = true;
  return { applied: true };
}
