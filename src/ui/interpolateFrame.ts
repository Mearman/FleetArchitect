import type { BattleFrame, CrewSnapshot, ProjectileSnapshot, ShipSnapshot } from "@/schema/battle";

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
 * The continuous fields an interpolated ship always carries as own keys
 * (overriding whatever the nearest discrete snapshot held). Used by the
 * pooled-ship stale-key cleanup to tell which keys are always legitimate even
 * when the nearest frame no longer lists them (e.g. `crew` is always set by
 * the override whether or not the nearest snapshot carried it).
 */
const SHIP_CONTINUOUS_KEYS = new Set<string>([
  "x",
  "y",
  "vx",
  "vy",
  "facing",
  "comX",
  "comY",
  "crew",
]);

/**
 * Per-ship reusable interpolation scratch, keyed by instance id on each output
 * buffer. Bundles the pooled interpolated ship object with its reusable crew
 * result array and crew-object pool so the common interpolated path allocates
 * nothing once warm.
 */
interface ShipScratch {
  /** The reusable interpolated ship object (one entry in the output array). */
  ship: ShipSnapshot;
  /** Reusable crew result array, assigned back to `ship.crew` when present. */
  crewArr: CrewSnapshot[];
  /** Reusable crew objects by id, for crew present in both bracketing frames. */
  crewPool: Map<string, CrewSnapshot>;
}

/**
 * One persistent output frame plus its pooled entry objects. Two of these are
 * alternated per call (double buffered) so overwriting last call's frame can
 * never race a slow consumer — and no consumer retains the interpolated frame
 * across rAF anyway (audited across `src/ui/render`, the canvas draw, and every
 * overlay; movement/medium trails key on the HISTORY frames passed separately,
 * not the interpolated frame).
 */
interface OutputBuffer {
  frame: BattleFrame;
  ships: ShipSnapshot[];
  projectiles: ProjectileSnapshot[];
  shipPool: Map<string, ShipScratch>;
  projPool: Map<string, ProjectileSnapshot>;
}

function makeBuffer(): OutputBuffer {
  const ships: ShipSnapshot[] = [];
  const projectiles: ProjectileSnapshot[] = [];
  return {
    // `frame.ships`/`frame.projectiles` are the SAME array refs as
    // `ships`/`projectiles` above, so truncating and refilling the pooled
    // arrays is visible through the returned frame without re-pointing it.
    frame: { tick: 0, ships, projectiles },
    ships,
    projectiles,
    shipPool: new Map(),
    projPool: new Map(),
  };
}

// Two output buffers alternated per call. Selected by a boolean (not a tuple
// index) so the narrowing under noUncheckedIndexedAccess needs no assertion.
const BUF_A = makeBuffer();
const BUF_B = makeBuffer();
let useBufferA = true;

// Transient hi-frame lookup maps, cleared and repopulated each call.
// interpolateFrame is never re-entered (single-threaded, no recursion), so a
// single shared pair is safe and avoids two Map allocations per display frame.
const HI_SHIP_MAP = new Map<string, ShipSnapshot>();
const HI_PROJ_MAP = new Map<string, ProjectileSnapshot>();
const CREW_HI_MAP = new Map<string, CrewSnapshot>();

/**
 * Interpolate crew positions between two bracketing snapshots, writing into
 * the reusable `out` array and reusing pooled crew objects for members present
 * in both frames.
 *
 * For each crew member present in both frames, x/y are linearly interpolated;
 * discrete state (state, hp, carrying) is taken from the nearest frame. Crew
 * present in only one frame are carried through as the original snapshot object
 * so they neither pop into existence nor vanish mid-interval, exactly as the
 * allocating version did.
 *
 * Keyed by `id` — two crew with different ids never cross-contaminate.
 *
 * Returns the `out` array, or `undefined` when neither frame carries crew (so
 * the caller's `ship.crew` is set to `undefined`, matching the original).
 */
function interpolateCrew(
  loCrew: readonly CrewSnapshot[] | undefined,
  hiCrew: readonly CrewSnapshot[] | undefined,
  alpha: number,
  out: CrewSnapshot[],
  pool: Map<string, CrewSnapshot>,
): CrewSnapshot[] | undefined {
  if (loCrew === undefined && hiCrew === undefined) return undefined;

  // Index hi crew by id for O(1) lookup (cleared and repopulated — no alloc).
  CREW_HI_MAP.clear();
  if (hiCrew !== undefined) {
    for (const c of hiCrew) {
      CREW_HI_MAP.set(c.id, c);
    }
  }

  out.length = 0;

  // Crew in the lo frame: lerp if also in hi, otherwise carry lo verbatim.
  if (loCrew !== undefined) {
    for (const lo of loCrew) {
      const hi = CREW_HI_MAP.get(lo.id);
      if (hi === undefined) {
        out.push(lo);
      } else {
        const nearest = alpha < 0.5 ? lo : hi;
        // Pooled crew object (fixed {id,x,y,state,hp,carrying} shape — no
        // stale-key work needed). Created once per crew id, reused after.
        let c = pool.get(lo.id);
        if (c === undefined) {
          c = {
            id: lo.id,
            x: 0,
            y: 0,
            state: nearest.state,
            hp: nearest.hp,
            carrying: nearest.carrying,
          };
          pool.set(lo.id, c);
        }
        c.id = lo.id;
        c.x = lo.x + (hi.x - lo.x) * alpha;
        c.y = lo.y + (hi.y - lo.y) * alpha;
        c.state = nearest.state;
        c.hp = nearest.hp;
        c.carrying = nearest.carrying;
        out.push(c);
        // Mark as processed so we don't double-add from hi.
        CREW_HI_MAP.delete(lo.id);
      }
    }
  }

  // Crew present only in hi (newly spawned mid-interval): carry hi verbatim.
  for (const hi of CREW_HI_MAP.values()) {
    out.push(hi);
  }

  return out;
}

/**
 * A frame suitable for rendering: ship positions, facings, and CoM values are
 * linearly interpolated between the two bracketing sim ticks. All other state
 * (modules, projectiles, event flags such as `brokeOff`) comes from the nearest
 * bracketing frame so that discrete events are never smeared across time.
 *
 * The output is written into a pair of persistent buffers alternated per call
 * (double buffered): the ships/projectiles arrays are truncated and refilled,
 * and per-instance ship/projectile/crew objects are pooled and updated in
 * place. This makes the hot playback path allocate nothing once warm — it had
 * been a steady GC driver, allocating fresh Maps plus mapped
 * ship/projectile/crew arrays every display frame. No consumer retains the
 * interpolated frame across rAF (the draw and every overlay read it
 * synchronously; trails key on the HISTORY frames), so overwriting the previous
 * buffer is safe.
 *
 * The interpolated frame carries only `{tick, ships, projectiles, awareness}`
 * (matching the prior allocating implementation): beams, pods, atmosphere, and
 * the medium field are deliberately omitted and resolved from the discrete
 * frame history by the overlays/draw that need them.
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
  // interpolation work and return the lower frame directly. These early exits
  // return the original history frame (not the scratch buffer), preserving the
  // prior behaviour where integer-tick reads alias the real frame.
  if (alpha < Number.EPSILON || loIdx === hiIdx || hi === undefined) {
    return lo;
  }

  // Select and advance the output buffer (double buffered).
  const buf = useBufferA ? BUF_A : BUF_B;
  useBufferA = !useBufferA;

  // Rebuild the hi-frame lookup maps (cleared and repopulated — no alloc).
  HI_SHIP_MAP.clear();
  for (const s of hi.ships) {
    HI_SHIP_MAP.set(s.instanceId, s);
  }
  HI_PROJ_MAP.clear();
  for (const p of hi.projectiles) {
    HI_PROJ_MAP.set(p.id, p);
  }

  // Ships: truncate the reusable output array, then push one entry per lo ship.
  // Ships present only in lo (spawned/destroyed mid-interval) carry the lo
  // snapshot verbatim; ships in both are interpolated into a pooled object.
  const ships = buf.ships;
  ships.length = 0;
  for (const loShip of lo.ships) {
    const hiShip = HI_SHIP_MAP.get(loShip.instanceId);

    if (hiShip === undefined) {
      ships.push(loShip);
      continue;
    }

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

    let scratch = buf.shipPool.get(loShip.instanceId);
    if (scratch === undefined) {
      // First sight of this instance: seed the pooled ship with nearest's
      // shape (a one-off allocation per ship per buffer).
      const ship: ShipSnapshot = { ...nearest };
      scratch = { ship, crewArr: [], crewPool: new Map() };
      buf.shipPool.set(loShip.instanceId, scratch);
    } else {
      // Reuse: refresh the discrete state from nearest, then drop any stale
      // keys nearest no longer carries (e.g. `brokeOff` clearing after the
      // spawn frame, or `targetId` dropping off when a target is lost). The
      // continuous keys are always legitimate (set by the override below) so
      // they are never deleted here.
      const existing = scratch.ship;
      Object.assign(existing, nearest);
      for (const k of Object.keys(existing)) {
        if (
          !SHIP_CONTINUOUS_KEYS.has(k) &&
          !Object.prototype.hasOwnProperty.call(nearest, k)
        ) {
          Reflect.deleteProperty(existing, k);
        }
      }
    }

    const ship = scratch.ship;
    ship.x = x;
    ship.y = y;
    ship.vx = vx;
    ship.vy = vy;
    ship.facing = facing;
    ship.comX = comX;
    ship.comY = comY;
    ship.crew = interpolateCrew(loShip.crew, hiShip.crew, alpha, scratch.crewArr, scratch.crewPool);
    ships.push(ship);
  }

  // Projectiles: interpolate x/y by id so fast-moving shots glide smoothly
  // at all playback speeds (especially slow-mo where snapping is most visible).
  // Projectiles present only in the lo frame (about to expire) are carried
  // through verbatim. Projectiles present only in the hi frame (newly spawned
  // this tick) are NOT shown until the next interval — a round should not
  // appear before its birth tick. Pooled projectile objects have a fixed
  // {id,x,y,kind} shape, so no stale-key work is needed.
  const projectiles = buf.projectiles;
  projectiles.length = 0;
  for (const loP of lo.projectiles) {
    const hiP = HI_PROJ_MAP.get(loP.id);
    if (hiP === undefined) {
      projectiles.push(loP);
      continue;
    }
    let proj = buf.projPool.get(loP.id);
    if (proj === undefined) {
      proj = { id: loP.id, x: 0, y: 0, kind: loP.kind };
      buf.projPool.set(loP.id, proj);
    }
    proj.id = loP.id;
    proj.x = loP.x + (hiP.x - loP.x) * alpha;
    proj.y = loP.y + (hiP.y - loP.y) * alpha;
    proj.kind = loP.kind;
    projectiles.push(proj);
  }

  // Awareness and the tick number come from the nearest frame so that discrete
  // events (sensor contacts) are never smeared across the interval. The frame
  // object itself is reused (stable identity); only its fields are refreshed.
  const nearest = alpha < 0.5 ? lo : hi;
  buf.frame.tick = nearest.tick;
  buf.frame.awareness = nearest.awareness;
  return buf.frame;
}
