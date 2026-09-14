// src/layers/severe-weather/selection.js
import * as Cesium from 'cesium';
import {
  SEVERE_WEATHER_LAYER_ID as LAYER_ID,
  SEVERE_WEATHER_OVERLAY_SOURCE_ID as SOURCE_ID,
  buildGdacsCard,
  buildNwsCard,
} from './model.js';
import { isSevereWeatherPickId } from './rendering.js';

const LAYER_NAME = 'Severe Weather';
const CARD_SOURCE_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Click an alert area or event to pin one selected card (the FIRMS selected-card
 * pattern) and publish it to the shared context store. Clicking the card opens
 * its link; clicking empty globe clears it.
 */
export function createSevereWeatherSelection({
  viewer,
  rendering,
  overlayHost,
  context,
  picking,
  pickGround,
  openLink,
  screenSpaceEventHandlerFactory,
  getData,
}) {
  let handler = null;
  /** { kind: 'nws' | 'gdacs', key, lat, lon } */
  let selected = null;

  function cardFor(selection) {
    if (!selection) return null;
    const data = getData();
    if (selection.kind === 'nws') {
      const area = data.areas.find(
        (candidate) => candidate.key === selection.key,
      );
      return area ? buildNwsCard(area, selection) : null;
    }
    const event = data.events.find(
      (candidate) => candidate.id === selection.key,
    );
    return event ? buildGdacsCard(event) : null;
  }

  function publish(card, { announce }) {
    const position = Cesium.Cartesian3.fromDegrees(selected.lon, selected.lat);
    const { link } = card;
    overlayHost.setVisible(SOURCE_ID, true);
    overlayHost.setEntries(
      SOURCE_ID,
      [
        {
          id: `selected:${selected.kind}:${selected.key}`,
          position,
          variant: 'card',
          title: card.title,
          details: card.details,
          accent: card.accent,
          selected: true,
          priority: Number.MAX_SAFE_INTEGER,
          collisionGroup: 'ambient-card',
          interactive: Boolean(link),
          accessibilityLabel: link ? `Open details for ${card.title}` : '',
          activate: link
            ? () => {
                openLink(link);
                return true;
              }
            : undefined,
          edgeFade: 'keyhole',
          horizonCull: true,
          terrainOcclusion: false,
          gapPx: 14,
          placement: 'above',
        },
      ],
      CARD_SOURCE_OPTIONS,
    );
    const carrier = { show: true, __localBaseCartesian: position };
    context.registerEntityContext(carrier, {
      id: `${LAYER_ID}:${selected.kind}:${selected.key}`,
      layerId: LAYER_ID,
      layerName: LAYER_NAME,
      source: card.source,
      label: card.label,
      latitude: selected.lat,
      longitude: selected.lon,
      properties: card.properties,
    });
    if (announce) context.selectEntityContext(carrier);
    rendering.setSelected(`${selected.kind}:${selected.key}`);
  }

  function clear() {
    if (!selected) return;
    selected = null;
    overlayHost.clearSource(SOURCE_ID);
    context.clearSelectedEntityContextForLayer(LAYER_ID);
    context.removeEntityContextsForLayer(LAYER_ID);
    rendering.setSelected(null);
  }

  function select(target, anchor) {
    selected = {
      kind: target.kind,
      key: target.key,
      lat: anchor.lat,
      lon: anchor.lon,
    };
    const card = cardFor(selected);
    if (!card) {
      clear();
      return false;
    }
    publish(card, { announce: true });
    return true;
  }

  function eventAnchor(id) {
    const event = getData().events.find((candidate) => candidate.id === id);
    return event ? { lat: event.lat, lon: event.lon } : null;
  }

  function onClick(click) {
    const position = click?.position;
    if (!position) return;
    if (
      selected &&
      overlayHost.hitTest?.(position.x, position.y, { sourceId: SOURCE_ID })
    ) {
      const card = cardFor(selected);
      if (card?.link) openLink(card.link);
      return;
    }
    const picked = viewer.scene.pick(position);
    const target = rendering.targetFor(picked);
    if (target) {
      const anchor =
        target.kind === 'gdacs'
          ? eventAnchor(target.key)
          : pickGround(viewer, position);
      if (anchor) select(target, anchor);
      return;
    }
    const pickedId = picked ? picking.resolvePickId(picked) : null;
    // A pick owned by a sibling layer is not empty space: leave the card alone.
    if (pickedId && picking.isOwnedByOtherLayer(LAYER_ID, pickedId)) return;
    clear();
  }

  return {
    install() {
      if (handler) return;
      handler = screenSpaceEventHandlerFactory(viewer);
      handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      picking.registerPickOwner(LAYER_ID, isSevereWeatherPickId);
    },

    uninstall() {
      clear();
      handler?.destroy();
      handler = null;
      picking.unregisterPickOwner(LAYER_ID);
      overlayHost.setVisible(SOURCE_ID, false);
    },

    select,
    clear,

    /** After new data: keep the card current without re-announcing, or drop it when its alert or event is gone. */
    refresh() {
      if (!selected) return;
      const card = cardFor(selected);
      if (!card) clear();
      else publish(card, { announce: false });
    },

    selected: () => (selected ? { ...selected } : null),
  };
}
