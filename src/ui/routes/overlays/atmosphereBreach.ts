import type { BattleFrame } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";
import { pathWorldCircle } from "@/ui/routes/battleProject";

/** Minimum number of breached cells before the haze is drawn. A single
 *  cracked cell in an otherwise intact hull is too subtle to warrant a
 *  full-ship overlay. */
const MIN_BREACHED_CELLS = 1;

/** Maximum alpha of the breach haze at full breach severity (all cells venting). */
const BREACH_HAZE_MAX_ALPHA = 0.45;

/** Radius multiplier applied to the ship's hull radius when drawing the haze
 *  disc. A slight oversize keeps the haze visible even on small ships. */
const HAZE_RADIUS_FACTOR = 1.4;

/** Fallback hull radius in world units for ships with no cell layout. Chosen
 *  to roughly match the legacy blob radius used in the main renderer. */
const FALLBACK_HULL_RADIUS_WORLD = 7;

/** Threshold below which atmosphere level is considered critically thin. */
const THIN_ATMO_THRESHOLD = 0.5;

/** Alpha of the blue tint drawn when a ship's atmosphere is low but not
 *  breached (venting slowly). */
const THIN_ATMO_TINT_ALPHA = 0.18;

/**
 * Resolve the per-ship atmosphere summary for a given tick from the discrete
 * frame history: the array from the most recent emission tick AT OR BEFORE
 * `tick`. Pure function of `(frames, tick)` — deterministic, so the overlay
 * tracks the timeline under scrubbing instead of freezing on one snapshot. A
 * previous module-scoped "last-seen" cache broke here: scrubbing is
 * random-access and `interpolateFrame` strips `atmosphere` on fractional ticks,
 * so the cache held whichever emission forward playback last visited (backward
 * scrub painted future atmosphere, forward scrub painted stale atmosphere).
 *
 * The snapshot emits `frame.atmosphere` only every RESOURCE_EVERY ticks, so the
 * backward scan terminates within RESOURCE_EVERY - 1 steps; returns undefined
 * when no frame in range has atmosphere (a battle without life-support, or an
 * old replay).
 */
function resolveAtmosphere(
  frames: readonly BattleFrame[],
  tick: number,
): BattleFrame["atmosphere"] {
  const start = Math.min(Math.max(0, Math.floor(tick)), frames.length - 1);
  for (let i = start; i >= 0; i -= 1) {
    const f = frames[i];
    if (f === undefined) continue;
    if (f.atmosphere !== undefined && f.atmosphere.length > 0) return f.atmosphere;
  }
  return undefined;
}

/**
 * Atmosphere/breach overlay: draws a semi-transparent red haze over ships
 * that have breached cells (rapid decompression), and a blue tint over ships
 * with thin atmosphere (slow venting or low reserves). Reads from
 * frame.atmosphere, which is computed per-tick by the snapshot module from
 * the resource step's atmosphere field.
 *
 * Neither haze is drawn when frame.atmosphere is absent (old replays or
 * battles with no life-support wired in stay byte-identical to baseline).
 */
function drawAtmosphereBreach(c: OverlayCtx): void {
  const { ctx, frame, t, descriptors, frames, tick } = c;

  // Index live ship positions by instance id for O(1) lookup. Entries for ships
  // no longer live are skipped during the draw — there is no held state to prune.
  const shipPos = new Map<string, { x: number; y: number }>();
  for (const s of frame.ships) {
    if (s.alive) shipPos.set(s.instanceId, { x: s.x, y: s.y });
  }

  // Resolve the atmosphere summary for this tick from the frame history (the
  // most recent emission at-or-before the current tick), so the overlay tracks
  // the timeline under scrubbing rather than freezing on one snapshot.
  const atmosphere = resolveAtmosphere(frames, tick);
  if (atmosphere === undefined) return;

  ctx.save();

  for (const entry of atmosphere) {
    const pos = shipPos.get(entry.shipId);
    if (pos === undefined) continue; // ship destroyed or not yet present

    // Derive the haze radius from the ship's hull extent. Use the farthest
    // cell from the ship centre (the hull radius in world units) when cell
    // layout is available; fall back to a fixed radius otherwise.
    const descriptor = descriptors.get(entry.shipId);
    let hullRadiusWorld = FALLBACK_HULL_RADIUS_WORLD;
    if (descriptor?.cells !== undefined && descriptor.cells.length > 0) {
      let maxDistSq = 0;
      for (const cell of descriptor.cells) {
        const dSq = cell.ox * cell.ox + cell.oy * cell.oy;
        if (dSq > maxDistSq) maxDistSq = dSq;
      }
      if (maxDistSq > 0) hullRadiusWorld = Math.sqrt(maxDistSq);
    }

    const hazeWorld = hullRadiusWorld * HAZE_RADIUS_FACTOR;

    if (entry.breachedCells >= MIN_BREACHED_CELLS) {
      // Breach haze: red, severity proportional to fraction of cells breached
      // relative to the total. The total is not in the snapshot, but
      // atmosphereLevel gives a complementary view: low level = severe breach.
      const severity = 1 - entry.atmosphereLevel;
      ctx.globalAlpha = BREACH_HAZE_MAX_ALPHA * Math.max(0, Math.min(1, severity));
      ctx.fillStyle = "#ff3a3a";
      pathWorldCircle(ctx, t, pos.x, pos.y, hazeWorld);
      ctx.fill();
    } else if (entry.atmosphereLevel < THIN_ATMO_THRESHOLD) {
      // Thin atmosphere tint: blue, for a ship losing air slowly without a
      // direct breach reading (gradual leak rather than puncture).
      ctx.globalAlpha = THIN_ATMO_TINT_ALPHA * (1 - entry.atmosphereLevel / THIN_ATMO_THRESHOLD);
      ctx.fillStyle = "#5ab0ff";
      pathWorldCircle(ctx, t, pos.x, pos.y, hazeWorld);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Atmosphere/breach overlay: red haze for venting hulls, blue tint for thin
 *  atmosphere. Drawn beneath ships so the hull silhouette remains visible. */
export const atmosphereBreach: OverlayDef = {
  id: "atmosphere-breach",
  label: "Atmosphere / hull breach",
  defaultOn: false,
  defaultScope: "all",
  draw: drawAtmosphereBreach,
};
