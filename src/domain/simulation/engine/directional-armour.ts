/**
 * Directional armour: line-of-sight thickness scaling by incidence angle.
 *
 * Effective armour thickness scales as `t_eff = t / cos(θ)` where θ is the angle
 * between the incoming projectile path and the outward normal of the hull face it
 * strikes — a round crossing a cell face at a shallow angle must punch through
 * more material. The passive `surfaceReduction` and reactive `reactiveReduction`
 * are multiplied by `1 / cos(θ)` (clamped), so an oblique strike is more absorbed.
 * At face-on incidence (cos θ = 1) the reduction is exactly the catalogue value,
 * so a perpendicular hit is byte-identical to the pre-directional model.
 *
 * Extracted from `damage.ts` to keep that module under the 800-line lint cap.
 * Cycle-free: this leaf imports nothing from `damage.ts` / `damage-impact.ts`.
 */

/**
 * Floor on cos(θ), clamping the grazing singularity. At grazing cos(θ) → 0 the
 * thickness would diverge, so it is floored at cos(80°) ≈ 0.1736 — capping the
 * multiplier at ~5.76×, the real line-of-sight thickness at 80° obliquity. The
 * 80° anchor is the authored maximum obliquity (a strike more oblique is treated
 * as the cap rather than ricochet-modelled).
 *
 * Classification: derived-by-formula (`cos(maxObliquityDeg · π/180)`); the
 * anchor (80° max obliquity) is authored catalogue content.
 */
export const ARMOUR_MIN_COS_THETA = Math.cos((80 * Math.PI) / 180);

/**
 * Per-hit directional-armour context: the ship-local shot direction and the
 * best-facing (most head-on) cos(θ). Built once per hit from the world shot
 * direction; `hasDir` is false for radial/internal blasts (chain reactions,
 * mines, phantoms, debris), which carry no travel direction and so keep face-on
 * armour (multiplier 1) — byte-identical to the pre-directional path.
 */
export interface ArmourContext {
  hasDir: boolean;
  /** Shot direction rotated into the ship's local frame (unit, when hasDir). */
  ldx: number;
  ldy: number;
  /** cos(θ) for the best-facing hull face: the larger absolute component. */
  bestCos: number;
}

/**
 * Build the armour context from the world-space unit shot direction rotated into
 * the ship's local frame by `-facing`. The four rectilinear face normals give cos
 * values `|ldx|` (east/west faces) and `|ldy|` (north/south faces); the most
 * head-on (entry) face is the larger absolute component, so `bestCos`. Returns
 * `hasDir: false` (with inert `ldx=1, ldy=0, bestCos=1`) when no direction is
 * supplied — the context is then never consumed (the multiplier is forced to 1).
 */
export function armourContext(
  facing: number,
  shotDirX?: number,
  shotDirY?: number,
): ArmourContext {
  const hasDir = shotDirX !== undefined && shotDirY !== undefined;
  const cf = Math.cos(facing);
  const sf = Math.sin(facing);
  const ldx = hasDir ? shotDirX * cf + shotDirY * sf : 1;
  const ldy = hasDir ? -shotDirX * sf + shotDirY * cf : 0;
  return { hasDir, ldx, ldy, bestCos: Math.max(Math.abs(ldx), Math.abs(ldy)) };
}

/**
 * cos(θ) for the shared entry face of a grid-adjacent step `(dCol, dRow)` (one
 * of them ±1, the other 0): the outward normal of the crossed face dotted with
 * the local shot direction. This can be small (grazing) when a round moving
 * mostly along one axis clips a cell reached by a perpendicular step — the
 * shallow-incidence case the line-of-sight model is meant to capture. The caller
 * passes `ctx.bestCos` for the impact cell (i === 0) and diagonal gaps, where no
 * shared face is known.
 */
export function adjacentFaceCos(
  ctx: ArmourContext,
  dCol: number,
  dRow: number,
): number {
  return dCol !== 0 ? ctx.ldx * dCol : ctx.ldy * dRow;
}

/**
 * The thickness multiplier for a given cos(θ), clamped to the floor. Returns 1
 * (face-on) when the context carries no shot direction, so radial/internal blasts
 * are byte-identical to the pre-directional armour model.
 */
export function armourThicknessMult(
  ctx: ArmourContext,
  cosTheta: number,
): number {
  return ctx.hasDir ? 1 / Math.max(cosTheta, ARMOUR_MIN_COS_THETA) : 1;
}
