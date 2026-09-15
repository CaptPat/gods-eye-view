/** Pure sky helpers: equatorial directions and star styling. No Cesium. */

const RAD = Math.PI / 180;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Right ascension and declination (degrees) → unit vector in the equatorial frame. */
export function raDecToUnit(raDeg, decDeg) {
  const ra = raDeg * RAD;
  const dec = decDeg * RAD;
  const cosDec = Math.cos(dec);
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  };
}

/** 1.5 px at magnitude 4.5, one more per magnitude brighter, capped at 7 px. */
export function starPixelSize(mag) {
  return round2(clamp(1.5 + (4.5 - mag), 1.5, 7));
}

/** Faint stars fade to 35% opacity; magnitude 0.5 and brighter are nearly opaque. */
export function starAlpha(mag) {
  return round2(clamp(0.35 + (4.5 - mag) * 0.13, 0.35, 1));
}

const TINTS = [
  [-0.4, '#9bb0ff'],
  [0, '#cad7ff'],
  [0.4, '#f8f7ff'],
  [0.8, '#fff4e8'],
  [1.2, '#ffd2a1'],
  [1.6, '#ffb56c'],
  [2, '#ff9d3f'],
];

/** B−V colour index → the nearest spectral tint; white when unknown. */
export function bvToColor(bv) {
  if (!Number.isFinite(bv)) return '#ffffff';
  let best = TINTS[0];
  for (const tint of TINTS)
    if (Math.abs(tint[0] - bv) < Math.abs(best[0] - bv)) best = tint;
  return best[1];
}
