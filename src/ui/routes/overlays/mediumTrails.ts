import type { WeaponType } from "@/schema/module";
import {
  INTENSITY_DRAW_THRESHOLD,
  fxGainFor,
  paletteSample,
  readFxLevel,
  resolveMediumField,
  sampleMediumIntensity,
} from "./mediumShared";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Arena medium field: sharp ANALYTIC per-entity trail streaks
// ---------------------------------------------------------------------------
//
// Sibling to `mediumGlow.ts`. The glow overlay paints the BROAD ambient field
// as one soft radial blob per excited cell (correct for the diffuse haze), but
// at a 500 m cell pitch a MOVING emitter — a thrusting ship, a burning missile
// — reads as a chain of coarse blocky blobs, not a fine streamer. This overlay
// draws the FINE structure analytically: a tapering polyline along each
// emitter's recent PATH, with brightness sampled from the medium field's local
// ε. The result reads as a sharp exhaust streak / projectile plume while
// staying medium-gated — denser, more excited medium produces brighter streaks,
// exactly like the cell-glow overlay. Both overlays share the palette, FX
// gating, field resolution, and brightness mapping via `./mediumShared`, so the two
// views never drift apart.
//
// Two streak kinds:
//   1. Thrusting-ship EXHAUST trails — a fading streak along each alive ship's
//      recent path (mirrors `movementTrail.ts`'s history walk).
//   2. Burning-projectile PLUME streaks — a short streak along each
//      projectile's recent path, brighter for powered rounds (missile/torpedo)
//      and faint for ballistic ones (cannon/plasma).
//
// Drawn beneath the ship layer (see `UNDER_SHIP_IDS` in `./index.ts`) so the
// exhaust/plume sits under the hull and the ship reads as the streak's source.

// ---------------------------------------------------------------------------
// Path sampling (history walk)
// ---------------------------------------------------------------------------
//
// Both streak kinds walk `OverlayCtx.frames` backward from the current tick to
// build a short per-entity polyline, exactly as `movementTrail.ts` does. The
// frames are discrete sim ticks (not interpolated), so each collected position
// is exact. Frames are collected newest-first: index 0 in a trail is the most
// recent past position, and the streak tapers from the entity's current
// position (newest, brightest, widest) back to the oldest (faint, thin).
//
// Once an entity is absent or dead in a historical frame, older positions are
// not contiguous with its current streak and are not collected — the streak
// belongs to this contiguous run only.

/** Number of past ticks to trace for a ship's exhaust streak. A sustained
 *  plume is short-lived (ε diffuses and decays within a few dozen ticks), so a
 *  short lookback captures the visible streak without wasted work. */
const EXHAUST_TRAIL_TICKS = 18;

/** Number of past ticks to trace for a projectile's plume streak. Projectiles
 *  are fast and short-lived; a short lookback captures the bright near-plume
 *  without reaching past the round's spawn. */
const PLUME_TRAIL_TICKS = 6;

/** A ship moving slower than this (world units per tick) is treated as
 *  stationary for the fine-streamer overlay and skipped: a stationary thruster
 *  deposits its exhaust locally and is painted as a blob by `mediumGlow`; the
 *  analytic streamer is for MOVING emitters, whose exhaust traces a path. */
const MIN_STREAMER_SPEED_M_PER_TICK = 0.5;
const MIN_STREAMER_SPEED_SQ =
  MIN_STREAMER_SPEED_M_PER_TICK * MIN_STREAMER_SPEED_M_PER_TICK;

// ---------------------------------------------------------------------------
// Streak shape (tapering, additive)
// ---------------------------------------------------------------------------

/** Peak stroke width of a ship exhaust streak, in display pixels, at its
 *  newest (widest) end. Tapers linearly toward the tail. */
const EXHAUST_MAX_WIDTH_PX = 3.5;

/** Peak stroke width of a projectile plume streak, in display pixels. Thinner
 *  than a ship exhaust — a round is much smaller than a hull. */
const PLUME_MAX_WIDTH_PX = 2.5;

/** Per-kind plume gain. The analytic streak brightness is the ε-sampled
 *  intensity multiplied by this factor, so a burning motor (missile/torpedo)
 *  reads as a bright tapering plume and an unpowered round (cannon/plasma) as a
 *  faint ballistic wake. The engine deposits far more ε along a burning motor's
 *  path than a coasting slug's, so this gain is a guaranteed minimum contrast
 *  that holds even before the field has diffused.
 *
 *  `beam` is hitscan (no projectile is ever spawned) and never reaches this
 *  overlay; its gain is 0 as a defensive default. */
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
// Draw
// ---------------------------------------------------------------------------

/**
 * Medium-field analytic trails: sharp, path-based exhaust/plume streaks whose
 * brightness is sampled from the medium field. For each moving emitter the
 * recent path is traced (history walk), each segment's brightness is the local
 * ε-driven ρ-amplified intensity (shared with `mediumGlow`), and the streak is
 * stroked additively with a hot palette, tapering in width and alpha from the
 * emitter's current position back to the tail. Emitters in cold vacuum (ε ≈ 0)
 * produce no visible streak — the trails are medium-gated, like the cell glow.
 */
function drawMediumTrails(c: OverlayCtx): void {
  const { ctx } = c;

  // FX level: `off` → nothing. `reduced` → dimmer gain (applied inside the
  // intensity sample, shared with mediumGlow).
  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);

  // Resolve the field for this tick from the frame history: the most recent
  // emission at-or-before the current tick (deterministic, scrub-safe).
  const field = resolveMediumField(c.frames, c.tick);
  if (field === undefined) return; // no medium has ever been seen

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive: overlapping streaks stack
  ctx.setLineDash([]); // solid streaks (defensive: reset any prior dash state)
  ctx.lineCap = "round"; // smooth taper between segments

  drawExhaustTrails(c, field, fxGain);
  drawPlumeStreaks(c, field, fxGain);

  ctx.restore();
}

/**
 * Stroke one tapering streak along a polyline. `points` are world positions
 * ordered newest-first (index 0 = most recent past position); `origin` is the
 * entity's current world position (the streak's bright, wide end).
 * `intensities[i]` is the ε-driven streak brightness in [0, 1] for the segment
 * from `points[i]` toward the entity (index-matched to `points`, same length).
 * Each segment is stroked individually so it carries its own width and alpha;
 * the streak thus tapers in both dimensions and shifts colour with intensity
 * along its length.
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

  // Walk a sliding pair from the entity's current position back along the path.
  // Segment i connects points[i] (older) to the running `to` (newer), starting
  // at the entity itself.
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
    // keeps the streak discontinuous where there is genuinely nothing glowing.
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

/**
 * Exhaust trails for moving, thrusting ships. A ship's exhaust energy is
 * deposited along the cells it has just passed through (the engine dumps heat
 * where the thruster fires), so the recent PATH is where the plume lives.
 * Sampling the field's ε along that path recovers the plume analytically: a
 * ship driving through its own just-deposited exhaust reads as a bright
 * streamer; a ship coasting engine-off through vacuum reads as nothing.
 */
function drawExhaustTrails(
  c: OverlayCtx,
  // `field`/`fxGain` are passed in (rather than re-resolved) so both streak
  // kinds share one FX read and one field-resolution lookup per draw.
  field: Parameters<typeof sampleMediumIntensity>[0],
  fxGain: number,
): void {
  const { frame, tick, frames } = c;
  if (frames.length === 0 || tick <= 0) return;

  // Collect alive, non-stationary ships. A stationary thruster's exhaust is a
  // localized blob (handled by mediumGlow); the fine streamer is for ships with
  // a path to trace. Legacy replays without velocity data are skipped (their
  // exhaust is still painted as a blob by mediumGlow).
  type LiveShip = { id: string; x: number; y: number };
  const live: LiveShip[] = [];
  for (const s of frame.ships) {
    if (!s.alive) continue;
    const vx = s.vx;
    const vy = s.vy;
    if (vx === undefined || vy === undefined) continue;
    if (vx * vx + vy * vy < MIN_STREAMER_SPEED_SQ) continue;
    live.push({ id: s.instanceId, x: s.x, y: s.y });
  }
  if (live.length === 0) return;

  // Walk history backward, per ship, stopping where a ship is absent/dead so the
  // streak stays contiguous with the current run. Mirrors movementTrail.ts.
  const firstIdx = Math.max(0, tick - EXHAUST_TRAIL_TICKS);
  const paths = new Map<string, Array<{ x: number; y: number }>>();
  const stopped = new Set<string>();
  for (let i = tick - 1; i >= firstIdx; i -= 1) {
    const f = frames[i];
    if (f === undefined) break;
    // One per-frame index of {x, y, alive} so each ship is an O(1) lookup
    // rather than a frame.ships scan (same pattern as movementTrail /
    // damagePulse).
    const index = new Map<string, { x: number; y: number; alive: boolean }>();
    for (const s of f.ships) {
      index.set(s.instanceId, { x: s.x, y: s.y, alive: s.alive });
    }
    for (const ship of live) {
      if (stopped.has(ship.id)) continue;
      const past = index.get(ship.id);
      if (past === undefined || !past.alive) {
        stopped.add(ship.id);
        continue;
      }
      let path = paths.get(ship.id);
      if (path === undefined) {
        path = [];
        paths.set(ship.id, path);
      }
      path.push({ x: past.x, y: past.y });
    }
  }

  for (const ship of live) {
    const path = paths.get(ship.id);
    if (path === undefined || path.length === 0) continue;

    // Pre-sample each path point's intensity once: the peak check decides
    // whether the ship has any visible streak at all (skip entirely if it is in
    // cold vacuum), and the stroke pass reuses the samples.
    const intensities: number[] = [];
    let peak = 0;
    for (const pt of path) {
      const I = sampleMediumIntensity(field, pt.x, pt.y, fxGain);
      intensities.push(I);
      if (I > peak) peak = I;
    }
    if (peak < INTENSITY_DRAW_THRESHOLD) continue; // trail would be invisible

    strokeTaperedStreak(
      c,
      { x: ship.x, y: ship.y },
      path,
      intensities,
      EXHAUST_MAX_WIDTH_PX,
    );
  }
}

/**
 * Plume streaks for projectiles. `ProjectileSnapshot` carries no velocity and
 * no burn flag — only id, position, and kind — so the streak's path is inferred
 * by walking the frame history (like the ship exhaust) and its burn brightness
 * is inferred from the weapon kind: missile/torpedo are powered (bright plume),
 * cannon/plasma are unpowered (faint wake). The ε-sampling guarantees the
 * streak still reads medium-gated — denser, more excited medium along the
 * round's path lifts the plume, vacuum keeps it dim.
 */
function drawPlumeStreaks(
  c: OverlayCtx,
  field: Parameters<typeof sampleMediumIntensity>[0],
  fxGain: number,
): void {
  const { frame, tick, frames } = c;
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
    const index = new Map<string, { x: number; y: number }>();
    for (const p of f.projectiles) {
      index.set(p.id, { x: p.x, y: p.y });
    }
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

  for (const proj of live) {
    const path = paths.get(proj.id);
    if (path === undefined || path.length === 0) continue;

    // Intensity per path point = ε-sampled intensity × per-kind plume gain.
    // Both factors are ≤ 1, so the product stays in [0, 1] without a clamp.
    const intensities: number[] = [];
    let peak = 0;
    for (const pt of path) {
      const I = sampleMediumIntensity(field, pt.x, pt.y, fxGain) * proj.gain;
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
}

/** Overlay definition: analytic per-entity medium trails (exhaust/plume
 *  streaks), drawn beneath the ship layer so the streak sits under the hull. */
export const mediumTrails: OverlayDef = {
  id: "medium-trails",
  label: "Medium trails (exhaust / plume streaks)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawMediumTrails,
};
