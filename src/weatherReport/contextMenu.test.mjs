import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { installFakeDocument } from '../testSupport/fakeDom.mjs';
import { MENU_ITEM_LABEL, createContextMenu } from './contextMenu.js';

const TYPES = Cesium.ScreenSpaceEventType;
const POINT = { lat: 30.2671, lon: -97.7431 };

function setup(t, { pickResult = POINT } = {}) {
  const document = installFakeDocument(t);
  const canvas = document.createElement('canvas');
  canvas._rect = { left: 100, top: 50, width: 800, height: 600 };
  document.body.appendChild(canvas);
  const handler = { actions: new Map(), destroyed: false, setInputAction(fn, type) { this.actions.set(type, fn); }, destroy() { this.destroyed = true; } };
  const camera = { moveStart: new Cesium.Event() };
  const picks = [];
  const chosen = [];
  const menu = createContextMenu({
    viewer: { scene: { canvas }, camera },
    document,
    onPick: (point) => chosen.push(point),
    pick: (_viewer, position) => { picks.push(position); return pickResult; },
    createHandler: (target) => { assert.equal(target, canvas); return handler; },
  });
  const rightClick = (from, to = from) => {
    handler.actions.get(TYPES.RIGHT_DOWN)({ position: from });
    if (to !== from) handler.actions.get(TYPES.MOUSE_MOVE)({ startPosition: from, endPosition: to });
    handler.actions.get(TYPES.RIGHT_UP)({ position: to });
    handler.actions.get(TYPES.RIGHT_CLICK)({ position: to });
  };
  const key = (target, name) => {
    const event = Object.assign(new Event('keydown', { cancelable: true, bubbles: true }), { key: name });
    target.dispatchEvent(event);
    return event;
  };
  const menuElement = () => document.body.querySelector('[role="menu"]');
  return { document, canvas, handler, camera, picks, chosen, menu, rightClick, key, menuElement };
}

test('a right click opens the menu at the pointer with the coordinates, focused', (t) => {
  const s = setup(t);
  s.rightClick({ x: 10, y: 20 });
  const element = s.menuElement();
  assert.ok(element);
  assert.equal(element.style.left, '110px');
  assert.equal(element.style.top, '70px');
  const item = element.querySelector('[role="menuitem"]');
  assert.equal(item.textContent, MENU_ITEM_LABEL);
  assert.equal(element.querySelector('.weather-report-menu-coords').textContent, '30.267, -97.743');
  assert.equal(s.document.activeElement, item);
  assert.deepEqual(s.picks, [{ x: 10, y: 20 }]);
  const contextmenu = new Event('contextmenu', { cancelable: true });
  s.canvas.dispatchEvent(contextmenu);
  assert.equal(contextmenu.defaultPrevented, true);
});

test('a right drag, a sky pick and cockpit mode open nothing', (t) => {
  const drag = setup(t);
  drag.rightClick({ x: 10, y: 20 }, { x: 30, y: 20 });
  assert.equal(drag.menuElement(), null);
  assert.equal(drag.picks.length, 0);
  drag.menu.destroy();

  const sky = setup(t, { pickResult: null });
  sky.rightClick({ x: 10, y: 20 });
  assert.equal(sky.menuElement(), null);
  sky.menu.destroy();

  const cockpit = setup(t);
  cockpit.document.body.classList.add('cockpit-mode');
  cockpit.rightClick({ x: 10, y: 20 });
  assert.equal(cockpit.menuElement(), null);
});

test('Enter, Space and click pick exactly once and close the menu', (t) => {
  for (const activate of ['Enter', ' ', 'click']) {
    const s = setup(t);
    s.rightClick({ x: 10, y: 20 });
    const item = s.menuElement().querySelector('[role="menuitem"]');
    if (activate === 'click') item.click();
    else s.key(s.menuElement(), activate);
    item.click();
    assert.deepEqual(s.chosen, [POINT], `activation via ${JSON.stringify(activate)}`);
    assert.equal(s.menu.isOpen(), false);
    assert.equal(s.menuElement(), null);
    s.menu.destroy();
  }
});

test('Escape, an outside pointerdown, a wheel and a camera move close it', (t) => {
  const closers = [
    (s) => s.key(s.menuElement(), 'Escape'),
    (s) => s.document.dispatchEvent(new Event('pointerdown')),
    (s) => s.canvas.dispatchEvent(new Event('wheel')),
    (s) => s.camera.moveStart.raiseEvent(),
  ];
  for (const close of closers) {
    const s = setup(t);
    s.rightClick({ x: 10, y: 20 });
    close(s);
    assert.equal(s.menuElement(), null);
    assert.deepEqual(s.chosen, []);
    assert.equal(s.camera.moveStart.numberOfListeners, 0);
    s.menu.destroy();
  }
});

test('destroy closes the menu and removes the handler and listeners', (t) => {
  const s = setup(t);
  s.rightClick({ x: 10, y: 20 });
  s.menu.destroy();
  assert.equal(s.menuElement(), null);
  assert.equal(s.handler.destroyed, true);
  const contextmenu = new Event('contextmenu', { cancelable: true });
  s.canvas.dispatchEvent(contextmenu);
  assert.equal(contextmenu.defaultPrevented, false);
});

test('keys the menu handles do not reach page-wide shortcuts', (t) => {
  const s = setup(t);
  s.rightClick({ x: 10, y: 20 });
  const escape = s.key(s.menuElement(), 'Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.cancelBubble, true, 'Escape must not reach the tracking layers\' document listeners');
  assert.equal(s.menuElement(), null);
  s.menu.destroy();
});
