# Night sky: stars, constellations, planets and deep-sky objects — design

Status: in progress (2026-09-15)
Fork: CaptPat/gods-eye-view (Cyclops View). Fork-only work; nothing is proposed upstream.

## Place in the celestial work

This is celestial sub-project 3 of 3:

1. **Strange things.** UFO Incidents and Fireballs; merged at `96552cb`.
2. **Sky events.** Aurora Forecast, Day & Night and Meteor Showers; merged at `d5d7e65`.
3. **Night sky** (this document). Objects drawn on the sky itself rather than on the Earth.

The share-link layer list holds at most 32 layers. After sub-project 2 the app has 28. This sub-project
adds two, `4` and `5`, and leaves room for two more.

## Layers

| Layer id | Name | Token | Contents |
|---|---|---|---|
| `night-sky` | Night Sky | `4` | Stars to magnitude 4.5 (921), sized by magnitude and tinted by B−V colour index; named stars to magnitude 2.5; constellation stick figures (743 segments); names of all 88 constellations |
| `sky-objects` | Planets & Deep Sky | `5` | Mercury to Neptune, positioned by astronomy-engine and updated every 10 minutes; the 110 Messier objects, coloured by type (galaxy, nebula, cluster) and labelled with common names |

Both layers join the Layers panel's "Sky" group.

## Sources

- **d3-celestial** (Olaf Frohn, BSD-3-Clause), from the repository's `data/` folder:
  - `stars.6.json`: extended Hipparcos compilation, 5,044 stars to magnitude 6;
  - `starnames.json`: 493 proper names among those stars;
  - `constellations.json`: 89 entries with name label positions;
  - `constellations.lines.json`: stick figures;
  - `messier.json`: 110 objects.

  The files store RA as longitude −180…180, with 12h–24h negative. The build converts it back to 0…360°.
  `scripts/build-night-sky.mjs` trims them into compact JSON under
  `src/data/local_data/night_sky/`, with the BSD licence text alongside.
- **astronomy-engine** 2.1.19 (MIT, no dependencies, ±1 arcminute). `GeoVector(body, date, true)` gives
  geocentric J2000 equatorial vectors. The ESM build is 412 KB, so the planets layer loads it with a
  dynamic `import()` and keeps it out of the main chunk.

## Rendering: the sky sphere

`src/layers/sky-sphere` holds three collections: points, polylines and labels. All sit on a sphere
of radius 1×10⁸ m, about 16 Earth radii.

- **Centred on the camera.** Every frame, `scene.preRender` sets each collection's `modelMatrix` to
  the camera position combined with the rotation from the inertial frame to Earth-fixed at the
  current time. Because the sphere is centred on the camera, there is no parallax at any altitude.
- **Hidden by the Earth.** The radius is far beyond any camera orbit and well inside the camera's
  5×10⁸ m far plane. Ordinary depth testing therefore hides sky objects behind the Earth, the globe
  and the 3D tiles.
- **Aligned with the star background.** The rotation uses ICRF-to-fixed, so the points line up with
  Cesium's star skybox. Until Earth orientation data loads it falls back to TEME. The sphere
  preloads that data for the current day when it attaches, and tests inject the rotation.
- **Kept turning while idle.** The app idles in requestRenderMode, so the sphere requests a render
  once a minute while attached, and the sky keeps turning.

## Testing

Each module is test-first:
- sky coordinate helpers: RA/Dec to unit vector, star size, alpha and tint;
- sphere frame following and render cadence, using fake labels because Cesium labels need `document`;
- the Night Sky and Planets & Deep Sky layer lifecycles;
- the planet positions for a known date.

Full CI parity runs before merge.
