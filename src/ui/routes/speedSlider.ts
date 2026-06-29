/**
 * Log-scale mapping for the playback-speed slider.
 *
 * The speed control is a slider whose rail spans 0.25x to 16x — a 64x
 * multiplicative span. A linear rail would cram 0.25/0.5/1 into the first few
 * percent, so the slider operates in a logarithmic position space (each doubling
 * is an equal distance along the rail) and these helpers convert between a real
 * speed multiplier and the 0..1 position the Mantine Slider works in.
 *
 * Two bounds matter:
 * - {@link MIN_SPEED} / {@link MAX_SPEED} bound the *rail* (0.25x to 16x). The
 *   upper bound leaves headroom above the desired cap so the sim-speed bar can
 *   poke past an 8x thumb when the engine is outrunning playback.
 * - {@link DESIRED_MAX_SPEED} caps the *desired* playback speed at 8x (the old
 *   preset ceiling). The thumb hits a wall there; the 8x-to-16x region is
 *   sim-speed-only.
 *
 * These are pure functions with no React/DOM dependencies, so they are unit
 * tested directly.
 */

/** Lowest value on the rail. */
export const MIN_SPEED = 0.25;
/** Highest value on the rail (sim speed can reach here; desired caps lower). */
export const MAX_SPEED = 16;
/** The desired playback thumb cannot be dragged past this. */
export const DESIRED_MAX_SPEED = 8;

/** The familiar preset speeds, kept as aim-point marks on the rail. */
export const SPEED_PRESETS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

const LOG_MIN = Math.log(MIN_SPEED);
const LOG_SPAN = Math.log(MAX_SPEED) - Math.log(MIN_SPEED);

/**
 * Convert a speed multiplier to a 0..1 rail position (log scale). Speeds outside
 * the rail clamp to the ends: a measured sim speed above 16x pegs at the right
 * edge rather than overflowing the track.
 */
export function speedToPos(speed: number): number {
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  return (Math.log(clamped) - LOG_MIN) / LOG_SPAN;
}

/**
 * Convert a 0..1 rail position back to a speed multiplier (log scale), clamped to
 * the desired cap. The Mantine Slider only ever passes a position in [0, 1], so
 * the result lies in [MIN_SPEED, DESIRED_MAX_SPEED].
 */
export function posToSpeed(pos: number): number {
  const speed = MIN_SPEED * Math.pow(MAX_SPEED / MIN_SPEED, pos);
  return Math.min(speed, DESIRED_MAX_SPEED);
}

/**
 * The Mantine Slider `marks` for the preset speeds: a tick plus a "Nx" label at
 * each preset's rail position.
 */
export function speedMarks(): { value: number; label: string }[] {
  return SPEED_PRESETS.map((s) => ({ value: speedToPos(s), label: formatSpeed(s) }));
}

/**
 * Render a speed multiplier as a compact label ("8x", "0.25x", "1.7x"). Integers
 * and round values shed trailing zeros; everything else carries up to two
 * decimals (trimmed) so sub-1 values keep their precision.
 */
export function formatSpeed(speed: number): string {
  const rounded = Math.round(speed * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}x`;
  const fixed = rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${fixed}x`;
}
