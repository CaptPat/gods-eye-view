// src/weatherReport/contextMenu.js
import * as Cesium from 'cesium';
import {
  bindTrackingClickGesture,
  isTrackingSelectionGesture,
} from '../data/trackingClickGesture.js';
import { pickGround } from './groundPick.js';

export const MENU_ITEM_LABEL = 'Weather report here';

/** Right-click (not right-drag) on the globe opens a one-item menu for the picked ground point. */
export function createContextMenu({
  viewer,
  document: doc = globalThis.document,
  isSuppressed = () => doc.body.classList.contains('cockpit-mode'),
  onPick,
  pick = pickGround,
  createHandler = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  eventTypes = Cesium.ScreenSpaceEventType,
}) {
  const canvas = viewer.scene.canvas;
  const handler = createHandler(canvas);
  let menu = null;
  let removeMoveStart = null;

  const onContextMenu = (event) => event.preventDefault();
  const onOutsidePointer = (event) => {
    if (menu && !menu.contains(event.target)) close();
  };
  const onWheel = () => close();

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    doc.removeEventListener('pointerdown', onOutsidePointer, true);
    canvas.removeEventListener('wheel', onWheel);
    removeMoveStart?.();
    removeMoveStart = null;
  }

  function open(point, windowPosition) {
    close();
    const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
    menu = doc.createElement('div');
    menu.className = 'weather-report-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.round(rect.left + windowPosition.x)}px`;
    menu.style.top = `${Math.round(rect.top + windowPosition.y)}px`;
    const item = doc.createElement('button');
    item.className = 'weather-report-menu-item';
    item.setAttribute('role', 'menuitem');
    item.setAttribute('type', 'button');
    item.textContent = MENU_ITEM_LABEL;
    const coords = doc.createElement('div');
    coords.className = 'weather-report-menu-coords';
    coords.textContent = `${point.lat.toFixed(3)}, ${point.lon.toFixed(3)}`;
    menu.append(item, coords);

    let chosen = false;
    const choose = () => {
      if (chosen) return;
      chosen = true;
      close();
      onPick(point);
    };
    item.addEventListener('click', choose);
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        choose();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });

    doc.body.appendChild(menu);
    doc.addEventListener('pointerdown', onOutsidePointer, true);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    removeMoveStart =
      viewer.camera?.moveStart?.addEventListener?.(close) ?? null;
    item.focus();
  }

  bindTrackingClickGesture(
    handler,
    (click, gesture) => {
      if (!isTrackingSelectionGesture(gesture) || isSuppressed()) return;
      const point = pick(viewer, click?.position);
      if (point) open(point, click.position);
    },
    {
      eventTypes: {
        LEFT_DOWN: eventTypes.RIGHT_DOWN,
        MOUSE_MOVE: eventTypes.MOUSE_MOVE,
        LEFT_UP: eventTypes.RIGHT_UP,
        LEFT_CLICK: eventTypes.RIGHT_CLICK,
      },
    },
  );
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    close,
    isOpen: () => Boolean(menu),
    destroy() {
      close();
      canvas.removeEventListener('contextmenu', onContextMenu);
      handler.destroy();
    },
  };
}
