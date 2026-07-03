import type { BattleFrame, ShipSnapshot } from "@/schema/battle";

// ---------------------------------------------------------------------------
// Shared per-frame ship index cache
// ---------------------------------------------------------------------------
//
// Several overlays (atmosphereBreach, damagePulse, sensorPulse, targetLock,
// movementTrail, mediumTrails) need to look a frame's ships up by instance id.
// Each used to build its own fresh `Map<string, ...>` by iterating
// `frame.ships` on every draw — once per rAF tick, per overlay. Frames in
// `OverlayCtx.frames` are IMMUTABLE recorded snapshots (parsed once from the
// battle result and never mutated afterwards), so a frame's id→ship index is
// stable for the frame's whole lifetime.
//
// Caching that index in a single WeakMap keyed by the frame object means it is
// built at most ONCE per frame, ever — across every overlay, every rAF tick of
// playback, and every scrub position — instead of being rebuilt by each overlay
// on every draw. The WeakMap lets the index self-evict when the player drops a
// frame (battle unload), so the cache cannot leak past the battle.
//
// The cache holds the FULL `Map<string, ShipSnapshot>` (every ship, alive or
// dead) for one frame. The overlays differ in what they filter (alive-only vs
// all, position-only vs side vs structure), so the correct generalisation —
// established by mediumTrails and applied here — is to cache the whole map once
// and let each overlay read and filter the fields it needs off the cached
// snapshot. Because the cache is keyed on frame identity (not on a single
// "current frame"), it serves any frame, including the PREVIOUS frame that
// damagePulse reads for its structure delta.

const shipFrameIndexCache = new WeakMap<BattleFrame, Map<string, ShipSnapshot>>();

/**
 * The id→ship index for a frame, built once and cached for the frame's
 * lifetime. Returns the FULL map (all ships, alive or dead); callers filter
 * (alive-only, by-id lookup, a single field) on top of it. Reads straight off
 * the cached snapshot reference — no per-entity trimmed copy is allocated.
 */
export function shipIndexFor(frame: BattleFrame): Map<string, ShipSnapshot> {
  const cached = shipFrameIndexCache.get(frame);
  if (cached !== undefined) return cached;
  const index = new Map<string, ShipSnapshot>();
  for (const s of frame.ships) index.set(s.instanceId, s);
  shipFrameIndexCache.set(frame, index);
  return index;
}
