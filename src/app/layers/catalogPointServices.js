import { registerDynamicCredit } from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  resolvePickId,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import {
  clearOverlaySource,
  hitTestWorldOverlay,
  setOverlayEntries,
  setOverlaySourceVisible,
} from '../../overlays/worldOverlay.js';

/** The application's overlay host, render governor, credit display, link opener and pick registry. */
export function catalogPointServices(credit) {
  return {
    overlayHost: {
      setEntries: setOverlayEntries,
      setVisible: setOverlaySourceVisible,
      clearSource: clearOverlaySource,
      hitTest: hitTestWorldOverlay,
    },
    requestRender: governorRequestRender,
    registerCredit: registerDynamicCredit,
    credit,
    openUrl: (url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'),
    picking: {
      registerPickOwner,
      unregisterPickOwner,
      resolvePickId,
      isOwnedByOtherLayer,
    },
  };
}
