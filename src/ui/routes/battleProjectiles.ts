import type { BattleFrame } from "@/schema/battle";
import { PROJECTILE_COLOUR } from "./battleConstants";
import type { Transform } from "./battleCamera";

// Cached id→position index of a raw frame's projectiles, so the streak loop can
// find each round's past position in O(1) without rebuilding a Map every rAF.
// Recorded frames are immutable snapshots, so the index is stable for a frame's
// lifetime and self-evicts when the player drops it (battle unload). Mirrors
// the per-frame memoisation in overlays/plumeStreaks.ts and overlays/shipIndex.ts.
const projPosIndexCache = new WeakMap<
  BattleFrame,
  ReadonlyMap<string, { x: number; y: number }>
>();

function projPosIndexFor(
  frame: BattleFrame,
): ReadonlyMap<string, { x: number; y: number }> {
  const cached = projPosIndexCache.get(frame);
  if (cached !== undefined) return cached;
  const index = new Map<string, { x: number; y: number }>();
  for (const p of frame.projectiles) index.set(p.id, { x: p.x, y: p.y });
  projPosIndexCache.set(frame, index);
  return index;
}

/** How many past frames to walk back for a round's streak tail. The streak
 *  scales with the round's speed (fast round = long streak, slow = short) so it
 *  stays visible at whole-battle zoom instead of collapsing to a sub-pixel dot.
 *  Matches the plume lookback in overlays/plumeStreaks.ts. */
const STREAK_LOOKBACK = 6;

/**
 * Draw kinetic rounds (cannon, missile, torpedo) as a streak whose length
 * scales with the round's speed, so a fast round reads as a contiguous line
 * rather than a chain of disconnected dots. Beams are hitscan and rendered
 * separately. `ProjectileSnapshot` carries no velocity, so the tail is found by
 * walking the frame history back up to {@link STREAK_LOOKBACK} ticks for the
 * oldest position the round held; a newborn round (no history yet) falls back to
 * a dot. This is the always-on round marker — the glowing plume is a separate,
 * medium-gated pass in overlays/plumeStreaks.ts (drawn by battleGlow).
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  frame: BattleFrame,
  tick: number,
  frames: readonly BattleFrame[],
): void {
  const pp = { x: 0, y: 0 };
  const tail = { x: 0, y: 0 };
  const startIdx = Math.max(0, tick - STREAK_LOOKBACK);
  ctx.save();
  ctx.lineCap = "round";
  for (const p of frame.projectiles) {
    const colour = PROJECTILE_COLOUR[p.kind];
    if (colour === undefined) continue;
    t.projectInto(pp, p.x, p.y);
    // Walk back up to STREAK_LOOKBACK frames for the OLDEST position this round
    // held, so the streak scales with speed and stays visible at any zoom. Stop
    // at the first frame where the round is absent (it spawned mid-window).
    let tailX = p.x;
    let tailY = p.y;
    let haveTail = false;
    for (let i = tick - 1; i >= startIdx; i -= 1) {
      const f = frames[i];
      if (f === undefined) break;
      const past = projPosIndexFor(f).get(p.id);
      if (past === undefined) break;
      tailX = past.x;
      tailY = past.y;
      haveTail = true;
    }
    if (!haveTail) {
      // Newborn round (no history within the lookback): draw a dot.
      ctx.fillStyle = colour;
      ctx.fillRect(pp.x - 1, pp.y - 1, 2.5, 2.5);
      continue;
    }
    t.projectInto(tail, tailX, tailY);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(pp.x, pp.y);
    ctx.stroke();
  }
  ctx.restore();
}
