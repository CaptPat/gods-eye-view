// src/weatherReport/reportPanel.js
import { CREDITS, normalizeUnits } from './reportModel.js';

export const PANEL_ID = 'weather-report-panel';

/** Right-rail weather report panel. Every string is set as text: the place name comes from Nominatim. */
export function createReportPanel({
  document: doc = globalThis.document,
  rail,
  units = 'imperial',
  onClose = () => {},
  onRefresh = () => {},
  onUnitsChange = () => {},
}) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text, label) => {
    const node = el('button', className, text);
    node.setAttribute('type', 'button');
    if (label) node.setAttribute('aria-label', label);
    return node;
  };

  const element = el('section', 'panel-collapsible weather-report-panel');
  element.id = PANEL_ID;
  element.setAttribute('data-panel-id', PANEL_ID);
  element.setAttribute('aria-label', 'Weather report');
  const inner = el('div', 'weather-report-panel-inner');
  const header = el('div', 'panel-header');
  const unitsButton = button('weather-report-units', '°F');
  const refreshButton = button(
    'weather-report-refresh',
    '↻',
    'Refresh weather report',
  );
  const closeButton = button(
    'weather-report-close',
    '×',
    'Close weather report',
  );
  header.append(
    el('span', 'panel-title', 'WEATHER'),
    el('span', 'panel-divider'),
    unitsButton,
    refreshButton,
    closeButton,
  );
  const place = el('p', 'weather-report-place');
  const updated = el('p', 'weather-report-updated');
  const status = el('p', 'weather-report-status');
  status.setAttribute('aria-live', 'polite');
  const body = el('div', 'weather-report-body');
  const footer = el('footer', 'weather-report-credits');
  for (const credit of CREDITS) footer.append(el('p', null, credit));
  inner.append(header, place, updated, status, body, footer);
  element.append(el('div', 'panel-glow'), inner);
  rail.prepend(element);

  let currentUnits = normalizeUnits(units);
  const syncUnits = () => {
    unitsButton.textContent = currentUnits === 'metric' ? '°C' : '°F';
    unitsButton.setAttribute(
      'aria-label',
      currentUnits === 'metric' ? 'Show °F' : 'Show °C',
    );
  };
  syncUnits();
  unitsButton.addEventListener('click', () =>
    onUnitsChange(currentUnits === 'metric' ? 'imperial' : 'metric'),
  );
  refreshButton.addEventListener('click', () => onRefresh());
  closeButton.addEventListener('click', () => onClose());

  const grid = (rows) => {
    const list = el('dl', 'weather-report-grid');
    for (const row of rows)
      list.append(el('dt', null, row.label), el('dd', null, row.value));
    return list;
  };
  const section = (heading, statusText, ...content) => {
    const node = el('section', 'weather-report-section');
    node.append(el('h3', null, heading));
    if (statusText) {
      const line = el('p', 'weather-report-section-status', statusText);
      line.setAttribute('aria-live', 'polite');
      node.append(line);
    }
    node.append(...content);
    return node;
  };
  const row = (className, ...cells) => {
    const node = el('div', className);
    for (const cell of cells) node.append(el('span', null, cell));
    return node;
  };

  function setHeader({ title, coordinates }, statusText) {
    place.textContent = title;
    updated.textContent = coordinates;
    status.textContent = statusText;
  }

  function render(view) {
    place.textContent = view.title;
    updated.textContent = `${view.coordinates} · ${view.updated}`;
    status.textContent = view.status ?? '';
    refreshButton.disabled = false;
    const sections = [
      section(
        'Now',
        view.sections.forecast,
        ...(view.now
          ? [
              el('div', 'weather-report-now-temp', view.now.temperature),
              el(
                'div',
                'weather-report-now-condition',
                `${view.now.condition} · ${view.now.feelsLike}`,
              ),
              grid(view.now.grid),
            ]
          : []),
      ),
    ];
    if (view.hourly.length) {
      const strip = el('div', 'weather-report-hourly');
      for (const hour of view.hourly) {
        strip.append(
          row(
            'weather-report-hour',
            hour.time,
            hour.condition,
            hour.temperature,
            hour.precip,
            hour.wind,
          ),
        );
      }
      sections.push(section('Next 48 hours', null, strip));
    }
    if (view.daily.length) {
      const days = el('div', 'weather-report-daily');
      for (const day of view.daily) {
        days.append(
          row(
            'weather-report-day',
            day.day,
            `${day.dayCondition} / ${day.nightCondition}`,
            `${day.high} / ${day.low}`,
            day.precip,
          ),
        );
      }
      sections.push(section('10 days', null, days));
    }
    if (view.marine || view.sections.marine) {
      const content = [];
      if (view.marine) {
        content.push(grid(view.marine.rows));
        if (view.marine.dailyMax.length) {
          const maxima = el('div', 'weather-report-wave-max');
          for (const entry of view.marine.dailyMax)
            maxima.append(
              row('weather-report-wave-day', entry.day, entry.value),
            );
          content.push(maxima);
        }
      }
      sections.push(section('Marine', view.sections.marine, ...content));
    }
    if (view.solar || view.sections.solar) {
      sections.push(
        section(
          'Sun and surface',
          view.sections.solar,
          ...(view.solar ? [grid(view.solar.rows)] : []),
        ),
      );
    }
    body.replaceChildren(...sections);
  }

  return {
    element,
    setUnits(nextUnits) {
      currentUnits = normalizeUnits(nextUnits);
      syncUnits();
    },
    showLoading(header) {
      setHeader(header, 'Loading weather');
      refreshButton.disabled = true;
      body.replaceChildren();
    },
    showError(message, header) {
      setHeader(header, message);
      refreshButton.disabled = false;
      body.replaceChildren();
    },
    render,
    reveal() {
      element.scrollIntoView?.({ block: 'nearest' });
      closeButton.focus();
    },
    destroy() {
      element.remove();
    },
  };
}
