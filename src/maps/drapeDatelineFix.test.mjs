import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  DRAPE_DATELINE_FIX_VERSIONS,
  installDrapeDatelineFix,
} from './drapeDatelineFix.js';

const { Cartographic, ImageryCoverage, ModelImageryMapping, Rectangle } =
  Cesium;
const DEG = Math.PI / 180;
const at = (lonDeg, latDeg) => new Cartographic(lonDeg * DEG, latDeg * DEG, 0);
const degrees = (radians) => Math.round((radians / DEG) * 1000) / 1000;

// Captured before the fix is installed, to compare untouched behaviour.
const originalCoverages = ImageryCoverage.createImageryCoverages;
const install = installDrapeDatelineFix(Cesium);

/** A real Web Mercator imagery layer; nothing is fetched until rendering. */
function imageryLayer() {
  return new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://tiles.invalid/{z}/{x}/{y}.png',
      maximumLevel: 10,
    }),
  );
}

const coverageRects = (coverages) =>
  coverages
    .map((c) => ({
      x: c.x,
      minX: c.textureCoordinateRectangle.minX,
      maxX: c.textureCoordinateRectangle.maxX,
      minY: c.textureCoordinateRectangle.minY,
      maxY: c.textureCoordinateRectangle.maxY,
    }))
    .sort((a, b) => a.minX - b.minX);

test('the fix installs once on the tested Cesium version', () => {
  assert.deepEqual(install, { applied: true });
  assert.ok(DRAPE_DATELINE_FIX_VERSIONS.includes(Cesium.VERSION));
  assert.deepEqual(installDrapeDatelineFix(Cesium), {
    applied: false,
    reason: 'already installed',
  });
});

test('an untested Cesium version is left alone', () => {
  const untouched = () => 'original';
  const fake = {
    VERSION: '9.99.0',
    ModelImageryMapping: { computeCartographicBoundingRectangle: untouched },
    ImageryCoverage: { createImageryCoverages: untouched },
    ImageryPipelineStage: { _computeTextureTranslationAndScale: untouched },
  };
  const result = installDrapeDatelineFix(fake);
  assert.equal(result.applied, false);
  assert.match(result.reason, /9\.99\.0/);
  assert.equal(
    fake.ModelImageryMapping.computeCartographicBoundingRectangle,
    untouched,
  );
});

test('a tile straddling 180° gets a narrow unwrapped box, not the whole world', () => {
  const rect = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(179.2, -17),
    at(-179.4, -16.5),
    at(179.9, -16),
  ]);
  assert.deepEqual(
    [degrees(rect.west), degrees(rect.east)],
    [179.2, 180.6],
    'east runs past 180° instead of wrapping to -179.4°',
  );
  assert.equal(degrees(rect.width), 1.4);
});

test('ordinary tiles and polar tiles keep the plain min/max box', () => {
  const plain = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(-118.5, 33),
    at(-118, 34),
  ]);
  assert.deepEqual([degrees(plain.west), degrees(plain.east)], [-118.5, -118]);

  // A cap tile around the pole really spans every longitude.
  const polar = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(-170, 88),
    at(-60, 88),
    at(50, 88),
    at(160, 88),
  ]);
  assert.deepEqual([degrees(polar.west), degrees(polar.east)], [-170, 160]);
});

test('texture coordinates run smoothly across the seam', () => {
  const positions = [at(179.5, -16.5), at(-179.5, -16.5)];
  const rect = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(179, -17),
    at(-179, -16),
  ]);
  const coords = ModelImageryMapping._createTextureCoordinates(
    positions,
    positions.length,
    rect,
    new Cesium.WebMercatorProjection(),
  );
  const [u0, , u1] = coords;
  assert.ok(Math.abs(u0 - 0.25) < 1e-3, `179.5° maps to u≈0.25, got ${u0}`);
  assert.ok(Math.abs(u1 - 0.75) < 1e-3, `-179.5° maps to u≈0.75, got ${u1}`);
});

test('imagery coverage takes tiles from both sides of 180° and they meet at the seam', () => {
  const rect = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(179, -17),
    at(-179, -16),
  ]);
  const level = 6;
  const rects = coverageRects(
    ImageryCoverage.createImageryCoverages(rect, imageryLayer(), level),
  );
  const lastColumn = 2 ** level - 1;
  assert.deepEqual(
    [...new Set(rects.map((r) => r.x))],
    [lastColumn, 0],
    'the easternmost column, then column 0 beyond the seam',
  );
  const column = (x) => {
    const tiles = rects.filter((r) => r.x === x);
    return {
      minX: Math.min(...tiles.map((r) => r.minX)),
      maxX: Math.max(...tiles.map((r) => r.maxX)),
      minY: Math.min(...tiles.map((r) => r.minY)),
      maxY: Math.max(...tiles.map((r) => r.maxY)),
    };
  };
  // Each rectangle places a whole imagery tile in the 3D tile's texture
  // space, so it may reach past [0, 1]; the two sides must meet at 180°
  // (u = 0.5 here) and together cover all of [0, 1].
  const east = column(lastColumn);
  const west = column(0);
  assert.ok(Math.abs(east.maxX - 0.5) < 1e-3, 'east ends at the seam');
  assert.ok(Math.abs(west.minX - 0.5) < 1e-3, 'west starts at the seam');
  assert.ok(
    east.maxX > west.minX,
    'the two sides overlap a hair, so float rounding leaves no gap at 180°',
  );
  assert.ok(east.minX <= 0 && west.maxX >= 1, 'u is covered end to end');
  for (const side of [east, west]) {
    assert.ok(side.minY <= 0 && side.maxY >= 1, 'v is covered end to end');
  }
});

test('coverage for an ordinary tile is exactly what Cesium computes', () => {
  const rect = Rectangle.fromDegrees(-118.5, 33, -118, 34);
  const layer = imageryLayer();
  assert.deepEqual(
    coverageRects(ImageryCoverage.createImageryCoverages(rect, layer, 8)),
    coverageRects(originalCoverages.call(ImageryCoverage, rect, layer, 8)),
  );
});

test('the shader places an imagery tile past 180° beside the seam, not a world away', () => {
  const bounds = ModelImageryMapping.computeCartographicBoundingRectangle([
    at(179, -17),
    at(-179, -16),
  ]);
  const layer = imageryLayer();
  const tiling = layer.imageryProvider.tilingScheme;
  const level = 6;
  const translate = (x) =>
    Cesium.ImageryPipelineStage._computeTextureTranslationAndScale(
      layer,
      bounds,
      tiling.tileXYToRectangle(x, 34, level),
    );
  const tileDegrees = 360 / 2 ** level;
  // East of the seam (174.375°..180°): the box starts 4.625° into the tile.
  const east = translate(2 ** level - 1);
  assert.ok(Math.abs(east.x - 4.625 / tileDegrees) < 1e-9, `east ${east.x}`);
  // West of the seam (-180°..-174.375°, i.e. 180°..185.625° unwrapped): the
  // box starts 1° before it, not a whole world later.
  const west = translate(0);
  assert.ok(Math.abs(west.x - -1 / tileDegrees) < 1e-9, `west ${west.x}`);
  assert.ok(Math.abs(west.z - east.z) < 1e-12, 'same scale on both sides');
});

test('a tile ending exactly on 180° maps its seam vertices to the right edge', () => {
  // Cesium reports a vertex on the seam as -180°, so a tile from 175° to the
  // seam has a box ending at exactly 180°.
  const positions = [at(175, 72), at(177.5, 73), at(-180, 72), at(-180, 74)];
  const rect =
    ModelImageryMapping.computeCartographicBoundingRectangle(positions);
  assert.deepEqual([degrees(rect.west), degrees(rect.east)], [175, 180]);
  const coords = ModelImageryMapping._createTextureCoordinates(
    positions,
    positions.length,
    rect,
    new Cesium.WebMercatorProjection(),
  );
  const u = [0, 1, 2, 3].map((i) => coords[2 * i]);
  assert.ok(Math.abs(u[0]) < 1e-6, `175° at u=0, got ${u[0]}`);
  assert.ok(Math.abs(u[1] - 0.5) < 1e-6, `177.5° at u=0.5, got ${u[1]}`);
  assert.ok(Math.abs(u[2] - 1) < 1e-6, `seam vertex at u=1, got ${u[2]}`);
  assert.ok(Math.abs(u[3] - 1) < 1e-6, `seam vertex at u=1, got ${u[3]}`);
});
