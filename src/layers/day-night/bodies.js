import * as Cesium from 'cesium';
import { moonIllumination, subpointFromVector } from './solar.js';

const sunInertial = new Cesium.Cartesian3();
const moonInertial = new Cesium.Cartesian3();
const sunFixed = new Cesium.Cartesian3();
const moonFixed = new Cesium.Cartesian3();
const inertialToFixed = new Cesium.Matrix3();

/**
 * Where the sun and moon stand overhead at `date`, and the moon's phase, from
 * Cesium's Simon1994 positions. The TEME→pseudo-fixed rotation is used on
 * purpose: computeIcrfToFixedMatrix starts an asynchronous fetch of IAU 2006
 * XYS data, and the ~0.4° it would gain is invisible on 1° twilight bands.
 */
export function computeSunMoon(date) {
  const time = Cesium.JulianDate.fromDate(date);
  Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
    time,
    sunInertial,
  );
  Cesium.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(
    time,
    moonInertial,
  );
  const matrix = Cesium.Transforms.computeTemeToPseudoFixedMatrix(
    time,
    inertialToFixed,
  );
  Cesium.Matrix3.multiplyByVector(matrix, sunInertial, sunFixed);
  Cesium.Matrix3.multiplyByVector(matrix, moonInertial, moonFixed);
  const { fraction, waxing } = moonIllumination(sunInertial, moonInertial);
  return {
    sun: subpointFromVector(sunFixed),
    moon: subpointFromVector(moonFixed),
    illumination: fraction,
    waxing,
  };
}
