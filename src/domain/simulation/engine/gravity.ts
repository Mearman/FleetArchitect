/**
 * Per-tick N-body gravitational field for a black-hole battle.
 *
 * Extracted from `movement.ts` as a cohesive, pure subsystem: the field is
 * built once per tick (positions snapshotted before any ship moves) and each
 * ship reads its pull from it in a fixed lexicographic-id order. The move is
 * purely mechanical — no behaviour change — so frame output is byte-identical
 * and the preset-determinism signature is unaffected.
 */

import { GRAVITY_CONSTANT_ARENA, SIM } from "./config";
import { fastHypot } from "./hypot";
import type { SimShip } from "./types";

/**
 * One body in the per-tick N-body gravitational field: its `G·M` (already
 * folded with the arena gravitational constant, so the acceleration it induces
 * is `gm / r^2`), its position SNAPSHOTTED at the start of the tick, and a
 * stable `id` used solely to order the accumulation deterministically. The
 * black hole carries a sentinel id that sorts before every ship id so it is
 * always first in the summation; ships carry their `instanceId`.
 */
interface MassBody {
  id: string;
  gm: number;
  x: number;
  y: number;
}

/**
 * The sentinel id for the black hole on the gravitational body list. Chosen to
 * sort lexicographically before any ship `instanceId` (a control character
 * below every printable character) so the well is always the first term in the
 * fixed-order force summation, independent of the ship ids present.
 */
const BLACK_HOLE_BODY_ID = "black-hole";

/**
 * Build the N-body gravitational field for this tick: the black hole followed
 * by every alive, non-phantom ship, each as a {@link MassBody} with positions
 * snapshotted NOW — before any ship has moved — so the field every ship reads
 * is the same simultaneous configuration and the step does not depend on
 * iteration order. The list is sorted by `id` lexicographically: the
 * deterministic accumulation order is a property of the list, so summing a
 * ship's pulls in list order is byte-reproducible across runs. A ship's `gm` is
 * `GRAVITY_CONSTANT_ARENA · mass` — the same `G·M` law the black hole obeys, so
 * heavy ships pull harder and the equivalence principle (mass-independent
 * acceleration of the pulled body) still holds.
 *
 * Built only inside a black-hole battle. The well is the field's dominant mass
 * by ~5000×; ships gravitate within it (and on each other) as a real N-body
 * system. In open space (no anomaly) there is no dominant mass and the only
 * gravitating bodies would be the ships themselves, whose mutual pull at combat
 * ranges is far below the precision of every other force — modelling it there
 * would only perturb baseline combat with physically-negligible noise. So
 * gravity is a feature of the gravitational scenario, and the caller skips this
 * entirely when there is no black hole.
 */
export function buildGravityField(ships: readonly SimShip[]): MassBody[] {
  const bodies: MassBody[] = [
    { id: BLACK_HOLE_BODY_ID, gm: SIM.blackHoleStrength, x: 0, y: 0 },
  ];
  for (const s of ships) {
    if (!s.alive || s.phantom !== undefined) continue;
    bodies.push({
      id: s.instanceId,
      gm: GRAVITY_CONSTANT_ARENA * s.mass,
      x: s.x,
      y: s.y,
    });
  }
  // Lexicographic id sort: the determinism contract. Floating-point addition is
  // not associative, so the summation order below must be fixed and identical
  // across runs; sorting by the stable instanceId (with the black hole's
  // sentinel sorting first) fixes it.
  bodies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return bodies;
}

/**
 * The net gravitational acceleration on the ship at (`shipX`, `shipY`) with id
 * `shipId`, summed over every OTHER body in the field in the field's fixed
 * lexicographic order. Each body contributes `gm / r^2` directed toward it,
 * with `r` softened to the lethal radius so the singularity at r→0 stays finite
 * (the same softening the scalar black-hole pull used). A body at the ship's
 * own position (the ship itself, matched by id) is skipped. Returns the
 * acceleration components in world units per tick^2, to be added to velocity.
 */
export function gravityAcceleration(
  field: readonly MassBody[],
  shipId: string,
  shipX: number,
  shipY: number,
): { ax: number; ay: number } {
  let ax = 0;
  let ay = 0;
  for (const body of field) {
    if (body.id === shipId) continue;
    const dx = body.x - shipX;
    const dy = body.y - shipY;
    const dist = fastHypot(dx, dy);
    if (dist <= 0) continue;
    // Soften the singularity at r→0 by clamping the effective r to the lethal
    // radius, so the acceleration stays finite right next to a body — the same
    // softening the original scalar black-hole pull applied.
    const effectiveR = Math.max(dist, SIM.blackHoleLethalRadius);
    const accelMag = body.gm / (effectiveR * effectiveR);
    ax += (dx / dist) * accelMag;
    ay += (dy / dist) * accelMag;
  }
  return { ax, ay };
}
