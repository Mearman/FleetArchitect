import type { BattleFrame, MediumSnapshot, ProjectileSnapshot } from "@/schema/battle";
import type { WeaponType } from "@/schema/module";
import {
  INTENSITY_DRAW_THRESHOLD,
  mediumCellIntensity,
  paletteSample,
  worldToCellIndex,
} from "./mediumShared";
import type { OverlayCtx } from "./types";

// ---------------------------------------------------------------------------
// Analytic projectile plume streaks (continuous, medium-gated)
// ---------------------------------------------------------------------------
//
// A continuous plume ribbon along each in-flight projectile's recent path,
// brightness sampled from the medium field's excitation (ε). This restores the
// fine continuous trail that the particle wake alone cannot render for a FAST
// round: the particle wake deposits one stationary bead per tick, and for a
// fast missile those beads end up far apart and short-lived, reading as a
// beaded chain rather than a solid plume. Drawing the plume as one tapering
// polyline along the path fills those gaps — the wake beads then read as
// texture within a continuous ribbon instead of disconnected spots.
//
// Drawn as a pass within `battleGlow` (between the field glow and the particle
// glow), sharing the resolved medium field, FX gain, palette, and additive
// composite so the plume never drifts from the cell/particle glow. Renderer-
// only: reads the immutable recorded frame history; changes no engine state.

/** Number of past ticks to trace for a projectile's plume. Projectiles are fast
 *  and short-lived; a short lookback captures the bright near-plume without
 *  reaching past the round's spawn. */
const PLUME_TRAIL_TICKS = 6;

/** Peak stroke width of a projectile plume streak, in display pixels, at its
 *  newest (widest) end. Tapers linearly toward the tail. Thinner than a ship
 *  exhaust — a round is much smaller than a hull. */
const PLUME_MAX_WIDTH_PX = 2.5;

/** Per-kind plume gain. The streak brightness is the ε-sampled intensity
 *  multiplied by this factor, so a burning motor (missile/torpedo) reads as a
 *  bright tapering plume and an unpowered round (cannon/plasma) as a faint
 *  ballistic wake. `beam` is hitscan (no projectile is ever spawned) and never
 *  reaches this pass; its gain is 0 as a defensive default. */
const PLUME_GAIN_BURNING = 1.0; // missile, torpedo: powered motor, bright plume
const PLUME_GAIN_BALLISTIC = 0.35; // cannon, plasma: unpowered, faint wake

const PLUME_GAIN_BY_KIND: Record<WeaponType, number> = {
  beam: 0, // hitscan — never a projectile
  cannon: PLUME_GAIN_BALLISTIC,
  missile: PLUME_GAIN_BURNING,
  torpedo: PLUME_GAIN_BURNING,
  plasma: PLUME_GAIN_BALLISTIC, // energetic bolt but unpowered; faint wake
};

// ---------------------------------------------------------------------------
// Per-frame projectile index cache
// ---------------------------------------------------------------------------
//
// Memoised id→projectile index per frame, keyed on frame identity. Frames in
// `OverlayCtx.frames` are IMMUTABLE recorded snapshots, so the index is stable
// for a frame's whole lifetime and self-evicts when the player drops a frame
// (battle unload). Same WeakMap-on-frame-identity idiom as `./shipIndex`.

const projFrameIndexCache = new WeakMap<
  BattleFrame,
  Map<string, ProjectileSnapshot>
>();

function projIndexFor(frame: BattleFrame): Map<string, ProjectileSnapshot> {
  const cached = projFrameIndexCache.get(frame);
  if (cached !== undefined) return cached;
  const index = new Map<string, ProjectileSnapshot>();
  for (const p of frame.projectiles) index.set(p.id, p);
  projFrameIndexCache.set(frame, index);
  return index;
}

// ---------------------------------------------------------------------------
// Streak shape (tapering, additive)
// ---------------------------------------------------------------------------

/**
 * Stroke one tapering streak along a polyline. `points` are world positions
 * ordered newest-first (index 0 = most recent past position); `origin` is the
 * projectile's current world position (the streak's bright, wide end).
 * `intensities[i]` is the ε-driven streak brightness in [0, 1] for the segment
 * from `points[i]` toward the projectile (index-matched to `points`). Each
 * segment is stroked individually so it carries its own width and alpha; the
 * streak thus tapers in both dimensions and shifts colour with intensity along
 * its length.
 */
function strokeTaperedStreak(
  c: OverlayCtx,
  origin: { x: number; y: number },
  points: ReadonlyArray<{ x: number; y: number }>,
  intensities: ReadonlyArray<number>,
  maxWidthPx: number,
): void {
  const { ctx, t } = c;
  const segCount = points.length;
  if (segCount === 0) return;

  // Walk a sliding pair from the projectile's current position back along the
  // path. Segment i connects points[i] (older) to the running `to` (newer),
  // starting at the projectile itself.
  let toX = origin.x;
  let toY = origin.y;
  for (let i = 0; i < segCount; i += 1) {
    const from = points[i];
    if (from === undefined) break;
    const intensity = intensities[i];
    if (intensity === undefined) break;
    // Linear taper: segment 0 (newest) at full, last at ~0.
    const taper = 1 - i / segCount;
    const alpha = intensity * taper;
    // Skip near-invisible segments (e.g. where the path crosses cold vacuum) —
    // keeps the streak absent where there is genuinely nothing glowing.
    if (alpha >= 0.01) {
      const [r, g, bl] = paletteSample(intensity);
      const a = t.project(from.x, from.y);
      const b = t.project(toX, toY);
      ctx.strokeStyle = `rgba(${r | 0},${g | 0},${bl | 0},${alpha})`;
      ctx.lineWidth = maxWidthPx * taper;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    toX = from.x;
    toY = from.y;
  }
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/**
 * The medium field's ε-driven, ρ-amplified glow intensity at a world point —
 * the ONE brightness truth the field glow uses (`mediumCellIntensity`), sampled
 * at the projectile's path so the plume reads identically to the ambient cell
 * glow and never drifts from it. 0 outside the grid or where no ε is deposited
 * (vacuum → no plume, exactly like the cell glow).
 */
function sampleFieldIntensity(
  field: MediumSnapshot,
  wx: number,
  wy: number,
  fxGain: number,
): number {
  const idx = worldToCellIndex(field, wx, wy);
  if (idx < 0) return 0;
  const epsSource = field.epsVis ?? field.eps;
  const eps = epsSource[idx] ?? 0;
  const rho = field.rho[idx] ?? 0;
  return mediumCellIntensity(eps, rho, fxGain);
}

/**
 * Plume streaks for projectiles. `ProjectileSnapshot` carries no velocity and
 * no burn flag — only id, position, and kind — so the streak's path is inferred
 * by walking the frame history and its burn brightness is inferred from the
 * weapon kind: missile/torpedo are powered (bright plume), cannon/plasma are
 * unpowered (faint wake). The ε-sampling guarantees the streak reads
 * medium-gated — denser, more excited medium along the round's path lifts the
 * plume, vacuum keeps it dim. Self-contained: sets its own additive composite
 * and round line caps, scoped by save/restore.
 */
export function drawPlumeStreaks(
  c: OverlayCtx,
  field: MediumSnapshot,
  fxGain: number,
): void {
  const { ctx, frame, tick, frames } = c;
  if (frames.length === 0 || tick <= 0) return;

  // Collect current projectiles, keyed by id, with their per-kind plume gain.
  type LiveProj = { id: string; x: number; y: number; gain: number };
  const live: LiveProj[] = [];
  for (const p of frame.projectiles) {
    const gain = PLUME_GAIN_BY_KIND[p.kind];
    if (gain === undefined || gain <= 0) continue;
    live.push({ id: p.id, x: p.x, y: p.y, gain });
  }
  if (live.length === 0) return;

  // Walk history backward per projectile id; stop where a round is absent (it
  // spawned or expired mid-window). Projectiles carry no alive flag, so absence
  // is the contiguity signal.
  const firstIdx = Math.max(0, tick - PLUME_TRAIL_TICKS);
  const paths = new Map<string, Array<{ x: number; y: number }>>();
  const stopped = new Set<string>();
  for (let i = tick - 1; i >= firstIdx; i -= 1) {
    const f = frames[i];
    if (f === undefined) break;
    // Cached id→projectile index for this frame (built once, ever), so the
    // lookback never re-indexes the frame.
    const index = projIndexFor(f);
    for (const proj of live) {
      if (stopped.has(proj.id)) continue;
      const past = index.get(proj.id);
      if (past === undefined) {
        stopped.add(proj.id);
        continue;
      }
      let path = paths.get(proj.id);
      if (path === undefined) {
        path = [];
        paths.set(proj.id, path);
      }
      path.push({ x: past.x, y: past.y });
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: overlapping streaks stack
  ctx.setLineDash([]); // solid streaks (defensive: reset any prior dash state)
  ctx.lineCap = "round"; // smooth taper between segments

  for (const proj of live) {
    const path = paths.get(proj.id);
    if (path === undefined || path.length === 0) continue;

    // Intensity per path point = ε-sampled intensity × per-kind plume gain.
    // Both factors are ≤ 1, so the product stays in [0, 1] without a clamp.
    const intensities: number[] = [];
    let peak = 0;
    for (const pt of path) {
      const I = sampleFieldIntensity(field, pt.x, pt.y, fxGain) * proj.gain;
      intensities.push(I);
      if (I > peak) peak = I;
    }
    if (peak < INTENSITY_DRAW_THRESHOLD) continue; // plume would be invisible

    strokeTaperedStreak(
      c,
      { x: proj.x, y: proj.y },
      path,
      intensities,
      PLUME_MAX_WIDTH_PX,
    );
  }

  ctx.restore();
}
