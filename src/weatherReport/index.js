// src/weatherReport/index.js
import { createContextMenu } from './contextMenu.js';
import {
  UNITS_STORAGE_KEY,
  buildReportView,
  normalizeUnits,
} from './reportModel.js';
import { createReportPanel } from './reportPanel.js';
import { createReportPin } from './reportPin.js';

export const REPORT_ENDPOINT = '/api/weather-report';
const LOADING_PIN = Object.freeze({
  title: 'Loading weather',
  details: Object.freeze([]),
});
const UNAVAILABLE_PIN = Object.freeze({
  title: 'Weather unavailable',
  details: Object.freeze([]),
});

/** Right-click → pin → one report request → right-rail panel. */
export function createWeatherReport({
  viewer,
  overlayHost,
  document: doc = globalThis.document,
  fetchImpl = (...args) => fetch(...args),
  storage = null,
  requestRender = () => {},
  now = Date.now,
  createMenu = createContextMenu,
  createPin = createReportPin,
  createPanel = createReportPanel,
}) {
  let units = readUnits();
  let panel = null;
  let point = null;
  let report = null;
  let controller = null;
  let destroyed = false;

  function readUnits() {
    try {
      return normalizeUnits(storage?.getItem(UNITS_STORAGE_KEY));
    } catch {
      return 'imperial';
    }
  }

  function writeUnits(value) {
    try {
      storage?.setItem(UNITS_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }

  const coordinates = (value) =>
    `${value.lat.toFixed(3)}, ${value.lon.toFixed(3)}`;
  const pin = createPin({
    viewer,
    overlayHost,
    requestRender,
    onActivate: () => panel?.reveal(),
  });
  const menu = createMenu({
    viewer,
    document: doc,
    onPick: (picked) => open(picked),
  });

  function ensurePanel() {
    if (panel) return panel;
    const rail = doc.getElementById('right-context-rail');
    if (!rail) return null;
    panel = createPanel({
      document: doc,
      rail,
      units,
      onClose: () => close(),
      onRefresh: () => {
        if (point) open(point);
      },
      onUnitsChange: (next) => setUnits(next),
    });
    return panel;
  }

  function renderReport() {
    if (!report) return;
    const view = buildReportView(report, { units, now: now() });
    panel?.render(view);
    pin.update(view.pin);
  }

  async function open(picked) {
    if (destroyed) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    point = picked;
    report = null;
    const header = {
      title: coordinates(picked),
      coordinates: coordinates(picked),
    };
    pin.show(picked, LOADING_PIN);
    ensurePanel()?.showLoading(header);
    try {
      const params = new URLSearchParams({
        lat: picked.lat.toFixed(4),
        lon: picked.lon.toFixed(4),
      });
      const response = await fetchImpl(`${REPORT_ENDPOINT}?${params}`, {
        signal: request.signal,
      });
      const body = await response.json().catch(() => null);
      if (controller !== request) return;
      if (!response.ok || !body || body.error)
        throw new Error(body?.error || 'Weather report unavailable');
      report = body;
      renderReport();
    } catch (error) {
      if (request.signal.aborted || controller !== request) return;
      panel?.showError(error?.message || 'Weather report unavailable', header);
      pin.update(UNAVAILABLE_PIN);
    } finally {
      if (controller === request) controller = null;
    }
  }

  function setUnits(next) {
    units = normalizeUnits(next);
    writeUnits(units);
    panel?.setUnits(units);
    renderReport();
  }

  function close() {
    controller?.abort();
    controller = null;
    point = null;
    report = null;
    pin.clear();
    panel?.destroy();
    panel = null;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    close();
    menu.destroy();
    pin.destroy();
  }

  return { open, close, setUnits, getUnits: () => units, destroy };
}
