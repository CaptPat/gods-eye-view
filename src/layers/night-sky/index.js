import * as Cesium from 'cesium';
import { createSkySphere, skyPosition } from '../sky-sphere/sphere.js';
import { raDecToUnit } from '../sky-sphere/celestial.js';
import { loadNightSkyCatalogue } from './bundledSource.js';
import {
  NIGHT_SKY_META,
  nightSkyStatus,
  parseNightSkyData,
  starStyle,
} from './model.js';

export * from './model.js';
export { NIGHT_SKY_DATA_URLS, loadNightSkyCatalogue } from './bundledSource.js';

/** The catalogue is bundled and never changes; the sphere turns the sky itself. */
export const NIGHT_SKY_REFRESH_MS = 24 * 60 * 60_000;

const LINE_COLOR = Cesium.Color.fromCssColorString('#6ea8ff').withAlpha(0.35);
const CONSTELLATION_FILL =
  Cesium.Color.fromCssColorString('#9ec5ff').withAlpha(0.7);
const STAR_NAME_FILL = Cesium.Color.WHITE.withAlpha(0.85);
const LABEL_OUTLINE = Cesium.Color.BLACK.withAlpha(0.8);
const at = ({ ra, dec }) => skyPosition(raDecToUnit(ra, dec));

/** Bright stars, constellation figures and names on the camera-centred sky sphere. */
export function createNightSkyLayer({
  fetchImpl = (...args) => fetch(...args),
  createSphere = createSkySphere,
  // Cesium materials need a canvas; tests running under Node inject a stand-in.
  createLineMaterial = (color) => Cesium.Material.fromType('Color', { color }),
  requestRender = () => {},
  registerCredit = () => false,
  credit = null,
  now = Date.now,
} = {}) {
  const id = NIGHT_SKY_META.id;
  let sphere = null;
  let enabled = false;
  let catalogue = null;
  let lastUpdate = null;
  let error = null;
  let loading = false;
  let request = null;

  function build(data) {
    for (const star of data.stars) {
      const style = starStyle(star);
      sphere.points.add({
        position: at(star),
        pixelSize: style.pixelSize,
        color: Cesium.Color.fromCssColorString(style.color).withAlpha(
          style.alpha,
        ),
      });
    }
    const material = createLineMaterial(LINE_COLOR);
    for (const line of data.lines)
      sphere.lines.add({ positions: line.map(at), width: 1, material });
    for (const star of data.names)
      sphere.labels.add({
        position: at(star),
        text: star.name,
        font: '11px "JetBrains Mono", "SF Mono", monospace',
        fillColor: STAR_NAME_FILL,
        outlineColor: LABEL_OUTLINE,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(8, 0),
      });
    for (const label of data.labels)
      sphere.labels.add({
        position: at(label),
        text: label.name,
        font: '10px "JetBrains Mono", "SF Mono", monospace',
        fillColor: CONSTELLATION_FILL,
        outlineColor: LABEL_OUTLINE,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      });
  }

  const layer = {
    id,
    name: NIGHT_SKY_META.name,
    icon: NIGHT_SKY_META.icon,
    source: NIGHT_SKY_META.source,
    updateInterval: 0,
    refreshInterval: NIGHT_SKY_REFRESH_MS,

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
      if (catalogue) return true;
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const onAbort = () => controller.abort();
      signal?.addEventListener?.('abort', onAbort, { once: true });
      loading = true;
      try {
        const parsed = parseNightSkyData(
          await loadNightSkyCatalogue({ fetchImpl, signal: controller.signal }),
        );
        if (!parsed) throw new Error('malformed night sky catalogue');
        if (!enabled || request !== controller) return true;
        build(parsed);
        catalogue = parsed;
        error = null;
        lastUpdate = now();
        requestRender(id);
        return true;
      } catch {
        if (signal?.aborted) return false;
        if (controller.signal.aborted) return true;
        error = NIGHT_SKY_META.unavailableText;
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
      catalogue = null;
    },

    getStats() {
      const count = catalogue?.stars.length ?? 0;
      if (loading)
        return {
          loading: true,
          loadingLabel: NIGHT_SKY_META.loadingLabel,
          count,
          lastUpdate,
        };
      if (error && !catalogue) return { count: 0, lastUpdate: null, error };
      if (!catalogue) return { count: 0, lastUpdate: null };
      return { count, lastUpdate, loadingLabel: nightSkyStatus(catalogue) };
    },
  };
  return layer;
}
