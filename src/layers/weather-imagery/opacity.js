/** The three opacity steps every weather imagery layer offers. */
export const IMAGERY_OPACITIES = Object.freeze([0.4, 0.7, 1]);

/** Snap to an offered opacity step, or null when the value is not one. */
export function normalizeImageryOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return (
    IMAGERY_OPACITIES.find((option) => Math.abs(option - numeric) < 0.001) ??
    null
  );
}
