import type { BattleFrame, ShipSnapshot } from "@/schema/battle";
import type { Transform } from "../battleCamera";

/**
 * Whether an overlay draws for the followed ship only ("active") or for every
 * ship in scope ("all"). Set per overlay by the user via the overlays popover.
 */
export type OverlayScope = "active" | "all";

/**
 * The context passed to every overlay's `draw` function. Overlays are pure
 * consumers of this context: they read frame state and the world-to-screen
 * transform, and draw onto the canvas. They never mutate battle state, never
 * own React state, and never read from refs directly — everything they need is
 * handed to them so the overlay layer stays the single seam that later agents
 * extend without touching BattleRoute.
 *
 * Fields:
 * - `ctx`        The canvas 2D context, already scaled for DPR by the caller.
 * - `frame`      The (possibly interpolated) frame being drawn this rAF tick.
 * - `t`          The world-to-screen transform (scale, centre, sx/sy) in effect.
 * - `followId`   The currently followed ship's instance id, or null when none.
 * - `tick`       The integer sim-tick position of the nearest discrete frame.
 * - `frames`     The full discrete frame history (for trail-style overlays that
 *                need to reach back across ticks without re-deriving playback).
 * - `inScope`    Predicate that returns true when a ship should be drawn by this
 *                overlay given its current scope and the follow target. Built
 *                per overlay per draw by the caller from `scope` and `followId`.
 */
export interface OverlayCtx {
  ctx: CanvasRenderingContext2D;
  frame: BattleFrame;
  t: Transform;
  followId: string | null;
  tick: number;
  frames: readonly BattleFrame[];
  inScope: (ship: ShipSnapshot) => boolean;
}

/**
 * Definition of a single battle overlay. Each overlay is a pure draw function
 * bound by id; BattleRoute holds the on/scope state per id and dispatches to
 * each enabled overlay's `draw` with a fresh OverlayCtx, so overlays never need
 * to touch BattleRoute directly.
 *
 * Layering is decided by the caller (BattleRoute), not by OverlayDef: under-ship
 * overlays are drawn before the ship loop, over-ship overlays after it. The
 * `defaultScope` only seeds initial UI state; the user can change it at runtime.
 *
 * Fields:
 * - `id`            Stable identifier; keys the per-overlay state in BattleRoute.
 * - `label`         Human-readable name for the overlays popover.
 * - `defaultOn`     Whether the overlay is enabled on first load.
 * - `defaultScope`  Initial scope: "active" (followed ship only) or "all".
 * - `draw`          Pure draw callback receiving an OverlayCtx.
 */
export interface OverlayDef {
  id: string;
  label: string;
  defaultOn: boolean;
  defaultScope: OverlayScope;
  draw: (c: OverlayCtx) => void;
}
