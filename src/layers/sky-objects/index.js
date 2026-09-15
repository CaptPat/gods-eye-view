import * as Cesium from 'cesium';
import { createSkySphere, skyPosition } from '../sky-sphere/sphere.js';
import { raDecToUnit } from '../sky-sphere/celestial.js';
import { loadMessierCatalogue } from './bundledSource.js';
import {
  MESSIER_COLORS,
  SKY_OBJECTS_META,
  messierLabel,
  parseMessier,
  skyObjectsStatus,
} from './model.js';
import {
  loadAstronomy as loadAstronomyModule,
  planetDirections,
} from './planets.js';

export * from './model.js';
export { loadAstronomy, planetDirections } from './planets.js';
export {
  SKY_OBJECTS_MESSIER_URL,
  loadMessierCatalogue,
} from './bundledSource.js';

/** Planets drift slowly against the stars; ten minutes is far finer than a pixel. */
export const SKY_OBJECTS_REFRESH_MS = 10 * 60_000;

const FONT = '"JetBrains Mono", "SF Mono", monospace';
const LABEL_OUTLINE = Cesium.Color.BLACK.withAlpha(0.8);

/** Mercury to Neptune and the Messier catalogue on the camera-centred sky sphere. */
export function createSkyObjectsLayer({
  fetchImpl = (...args) => fetch(...args),
  loadAstronomy = loadAstronomyModule,
  createSphere = createSkySphere,
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  now = Date.now,
} = {}) {
  const id = SKY_OBJECTS_META.id;
  let sphere = null;
  let enabled = false;
  let astronomy = null;
  let messier = null;
  /** index-aligned with PLANETS: { point, label } */
  const planets = [];
  let lastUpdate = null;
  let error = null;
  let loading = false;
  let request = null;

  const label = (position, text, color, size, offset) => ({
    position,
    text,
    font: `${size}px ${FONT}`,
    fillColor: color,
    outlineColor: LABEL_OUTLINE,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    pixelOffset: new Cesium.Cartesian2(offset, 0),
  });

  function placePlanets(date) {
    planetDirections(astronomy, date).forEach((planet, index) => {
      const position = skyPosition(planet);
      const entry = planets[index];
      if (entry) {
        entry.point.position = position;
        entry.label.position = position;
        return;
      }
      const color = Cesium.Color.fromCssColorString(planet.color);
      planets[index] = {
        point: sphere.points.add({ position, pixelSize: 6, color }),
        label: sphere.labels.add(label(position, planet.name, color, 12, 9)),
      };
    });
  }

  function buildMessier(objects) {
    for (const object of objects) {
      const position = skyPosition(raDecToUnit(object.ra, object.dec));
      const color = Cesium.Color.fromCssColorString(
        MESSIER_COLORS[object.category],
      );
      sphere.points.add({ position, pixelSize: 4, color });
      sphere.labels.add(
        label(position, messierLabel(object), color.withAlpha(0.85), 10, 7),
      );
    }
  }

  const loaded = () => Boolean(messier) && planets.length > 0;

  const layer = {
    id,
    name: SKY_OBJECTS_META.name,
    icon: SKY_OBJECTS_META.icon,
    source: SKY_OBJECTS_META.source,
    updateInterval: 0,
    refreshInterval: SKY_OBJECTS_REFRESH_MS,

    init(viewer) {
      sphere = createSphere(viewer, { id, requestRender });
    },

    enable(viewer) {
      enabled = true;
      registerCredit(viewer, credit);
      sphere.attach();
      sphere.show(true);
      requestRender(id);
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      loading = false;
      sphere?.show(false);
      sphere?.detach();
      requestRender(id);
    },

    async update(_viewer, { signal } = {}) {
      if (!enabled || !sphere || signal?.aborted) return false;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = !loaded();
      try {
        const catalogue = messier
          ? null
          : parseMessier(
              await loadMessierCatalogue({
                fetchImpl,
                signal: controller.signal,
              }),
            );
        if (!messier && !catalogue)
          throw new Error('malformed Messier catalogue');
        astronomy ??= await loadAstronomy();
        if (!enabled || request !== controller) return true;
        placePlanets(new Date(now()));
        if (catalogue) {
          buildMessier(catalogue);
          messier = catalogue;
        }
        error = null;
        lastUpdate = now();
        // Planet moves are timer-driven scene changes the idle governor cannot see.
        requestRender(id);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        error = SKY_OBJECTS_META.unavailableText;
        return true;
      } finally {
        if (request === controller) {
          request = null;
          loading = false;
        }
        signal?.removeEventListener?.('abort', onAbort);
      }
    },

    destroy() {
      layer.disable();
      sphere?.destroy();
      sphere = null;
      planets.length = 0;
      messier = null;
    },

    getStats() {
      const count = planets.length + (messier?.length ?? 0);
      if (loading)
        return {
          loading: true,
          loadingLabel: SKY_OBJECTS_META.loadingLabel,
          count,
          lastUpdate,
        };
      if (error && !loaded()) return { count: 0, lastUpdate: null, error };
      if (error) return { stale: true, count, lastUpdate, error };
      if (!loaded()) return { count: 0, lastUpdate: null };
      return {
        count,
        lastUpdate,
        loadingLabel: skyObjectsStatus({
          planets: planets.length,
          messier: messier.length,
        }),
      };
    },
  };
  return layer;
}
