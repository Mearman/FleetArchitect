import type { BattleFrame, CrewSnapshot, ShipSnapshot } from "@/schema/battle";

/**
 * Normalise an angle into (-π, π].
 */
function wrapAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Shortest-arc linear interpolation between two angles.
 * Returns an angle in (-π, π].
 */
function lerpAngle(a: number, b: number, t: number): number {
  const delta = wrapAngle(b - a);
  return a + delta * t;
}

/**
 * Interpolate crew positions between two bracketing snapshots.
 *
 * For each crew member present in both frames, x/y are linearly interpolated;
 * discrete state (state, hp, carrying) is taken from the nearest frame.
 * Crew present in only one frame are carried through verbatim so they neither
 * pop into existence nor vanish mid-interval.
 *
 * Keyed by `id` — two crew with different ids never cross-contaminate.
 */
function interpolateCrew(
  loCrew: readonly CrewSnapshot[] | undefined,
  hiCrew: readonly CrewSnapshot[] | undefined,
  alpha: number,
): CrewSnapshot[] | undefined {
  if (loCrew === undefined && hiCrew === undefined) return undefined;

  // Index hi crew by id for O(1) lookup.
  const hiMap = new Map<string, CrewSnapshot>();
  if (hiCrew !== undefined) {
    for (const c of hiCrew) {
      hiMap.set(c.id, c);
    }
  }

  const result: CrewSnapshot[] = [];

  // Crew in the lo frame: lerp if also in hi, otherwise carry lo verbatim.
  if (loCrew !== undefined) {
    for (const lo of loCrew) {
      const hi = hiMap.get(lo.id);
      if (hi === undefined) {
        result.push(lo);
      } else {
        const nearest = alpha < 0.5 ? lo : hi;
        result.push({
          id: lo.id,
          x: lo.x + (hi.x - lo.x) * alpha,
          y: lo.y + (hi.y - lo.y) * alpha,
          state: nearest.state,
          hp: nearest.hp,
          carrying: nearest.carrying,
        });
        // Mark as processed so we don't double-add from hi.
        hiMap.delete(lo.id);
      }
    }
  }

  // Crew present only in hi (newly spawned mid-interval): carry hi verbatim.
  for (const hi of hiMap.values()) {
    result.push(hi);
  }

  return result;
}

/**
 * A frame suitable for rendering: ship positions, facings, and CoM values are
 * linearly interpolated between the two bracketing sim ticks. All other state
 * (modules, projectiles, event flags such as `brokeOff`) comes from the nearest
 * bracketing frame so that discrete events are never smeared across time.
 *
 * @param frames  The full frames array from a `BattleResult`.
 * @param t       Fractional sim-tick position, e.g. 2.7 means 70% of the way
 *                between tick 2 and tick 3.
 */
export function interpolateFrame(frames: readonly BattleFrame[], t: number): BattleFrame {
  if (frames.length === 0) {
    // Nothing to interpolate; return a synthesised empty frame.
    return { tick: 0, ships: [], projectiles: [] };
  }

  // Clamp to the available range.
  const lastIdx = frames.length - 1;
  const tClamped = Math.max(0, Math.min(lastIdx, t));

  const loIdx = Math.floor(tClamped);
  const hiIdx = Math.min(lastIdx, loIdx + 1);
  const alpha = tClamped - loIdx;

  const lo = frames[loIdx];
  const hi = frames[hiIdx];

  // Both frames guaranteed to exist after clamping; type-narrowing below.
  if (lo === undefined) {
    // Should be unreachable after the clamp, but satisfy the type checker.
    return frames[0] ?? { tick: 0, ships: [], projectiles: [] };
  }

  // When alpha is negligible or the indices are identical, skip the
  // interpolation work and return the lower frame directly.
  if (alpha < Number.EPSILON || loIdx === hiIdx || hi === undefined) {
    return lo;
  }

  // Build a map from instanceId → hi-frame snapshot for quick lookup.
  const hiMap = new Map<string, ShipSnapshot>();
  for (const s of hi.ships) {
    hiMap.set(s.instanceId, s);
  }

  const ships = lo.ships.map<ShipSnapshot>((loShip) => {
    const hiShip = hiMap.get(loShip.instanceId);

    // If the ship does not appear in the hi frame (spawned or destroyed mid-
    // interval) just use the lo snapshot verbatim.
    if (hiShip === undefined) return loShip;

    // Interpolate continuous position and orientation.
    const x = loShip.x + (hiShip.x - loShip.x) * alpha;
    const y = loShip.y + (hiShip.y - loShip.y) * alpha;

    const vx =
      loShip.vx !== undefined && hiShip.vx !== undefined
        ? loShip.vx + (hiShip.vx - loShip.vx) * alpha
        : loShip.vx;

    const vy =
      loShip.vy !== undefined && hiShip.vy !== undefined
        ? loShip.vy + (hiShip.vy - loShip.vy) * alpha
        : loShip.vy;

    const facing =
      loShip.facing !== undefined && hiShip.facing !== undefined
        ? lerpAngle(loShip.facing, hiShip.facing, alpha)
        : loShip.facing;

    const comX =
      loShip.comX !== undefined && hiShip.comX !== undefined
        ? loShip.comX + (hiShip.comX - loShip.comX) * alpha
        : loShip.comX;

    const comY =
      loShip.comY !== undefined && hiShip.comY !== undefined
        ? loShip.comY + (hiShip.comY - loShip.comY) * alpha
        : loShip.comY;

    // Discrete state (modules, alive, structure, shield, event flags) comes
    // from the nearest bracketing frame, not interpolated.
    const nearest = alpha < 0.5 ? loShip : hiShip;

    const crew = interpolateCrew(loShip.crew, hiShip.crew, alpha);

    return {
      ...nearest,
      x,
      y,
      vx,
      vy,
      facing,
      comX,
      comY,
      crew,
    };
  });

  // Projectiles, awareness, and the tick number come from the nearest frame so
  // that discrete events (hits, break-apart, sensor contacts) are never smeared
  // across the interval. Awareness is binary per tick — there is no meaningful
  // interpolation between two AwarenessSnapshots.
  const nearest = alpha < 0.5 ? lo : hi;
  return {
    tick: nearest.tick,
    ships,
    projectiles: nearest.projectiles,
    awareness: nearest.awareness,
  };
}
