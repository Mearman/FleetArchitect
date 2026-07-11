import type { BattleFrame } from "@/schema/battle";
import { PROJECTILE_COLOUR } from "./battleConstants";
import type { Transform } from "./battleCamera";

// Cached id→position index of a raw frame's projectiles, so the streak loop can
// find each round's previous-tick position in O(1) without rebuilding a Map
// every rAF. Recorded frames are immutable snapshots, so the index is stable
// for a frame's lifetime and self-evicts when the player drops it (battle
// unload). Mirrors the per-frame memoisation in overlays/mediumTrails.ts and
// overlays/shipIndex.ts.
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

/**
 * Draw kinetic rounds (cannon, missile, torpedo) as a short streak from each
 * round's previous-tick position to its current one, so a fast round reads as a
 * contiguous line rather than a chain of disconnected dots. Beams are hitscan
 * and rendered separately. `ProjectileSnapshot` carries no velocity, so the tail
 * is the same id's position in the previous raw frame; a newborn round (no
 * history yet) falls back to a dot. This is the always-on round marker — the
 * glowing wake is a separate, medium-gated overlay (overlays/mediumTrails.ts).
 */
export function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  frame: BattleFrame,
  tick: number,
  frames: readonly BattleFrame[],
): void {
  const prevFrame = tick > 0 ? frames[tick - 1] : undefined;
  const prevProjById =
    prevFrame !== undefined ? projPosIndexFor(prevFrame) : undefined;
  const pp = { x: 0, y: 0 };
  const tail = { x: 0, y: 0 };
  ctx.save();
  ctx.lineCap = "round";
  for (const p of frame.projectiles) {
    const colour = PROJECTILE_COLOUR[p.kind];
    if (colour === undefined) continue;
    t.projectInto(pp, p.x, p.y);
    const prev = prevProjById?.get(p.id);
    if (prev === undefined) {
      ctx.fillStyle = colour;
      ctx.fillRect(pp.x - 1, pp.y - 1, 2.5, 2.5);
      continue;
    }
    t.projectInto(tail, prev.x, prev.y);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(pp.x, pp.y);
    ctx.stroke();
  }
  ctx.restore();
}
