/**
 * Mutable world entities that are not ships or modules: deployed proximity
 * mines, in-flight boarding pods, and in-flight projectiles. Extracted from
 * `types.ts` to keep that module under the 800-line lint cap. `types.ts`
 * re-exports them so existing `import { SimMine, SimPod, SimProjectile } from
 * "./types"` callers are unchanged.
 */

import type { WeaponType } from "@/schema/module";

/**
 * A deployed proximity mine (factions update — mine-layer module). A static
 * world entity laid by a ship's mine-layer: it sits where it was dropped, arms
 * after `armingLeft` reaches 0, then detonates on the first enemy ship inside
 * `radius`, dealing `damage` through the normal damage path. Mines never move
 * and never damage their own side. Detonated mines are filtered out of the
 * world array the tick they fire, so the array only ever holds live mines.
 *
 * `ownerInstanceId` / `ownerSlotId` identify the laying ship and module so a
 * layer can be capped to one live batch at a time (it does not re-lay while any
 * mine it laid is still alive). They never feed back into damage — a mine harms
 * by `side`, not by owner — and are not snapshotted.
 */
export interface SimMine {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  ownerInstanceId: string;
  ownerSlotId: string;
  /** Ticks remaining before the mine is armed; <= 0 means armed (can detonate). */
  armingLeft: number;
  damage: number;
  radius: number;
}

/**
 * A boarding pod in flight (factions update — boarding module). Launched toward
 * a chosen enemy within range, it homes on its `targetInstanceId` each tick at
 * `SIM.boardingPodSpeed`. On contact (within the target's collision radius) it
 * boards: `troops` of the target's nearest alive functional modules are
 * disabled, degrading the ship, then the pod is consumed. A pod whose target
 * dies or vanishes before contact expires and is filtered out. `troops` is the
 * module-disable budget carried from the launcher effect; it is not snapshotted.
 */
export interface SimPod {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  targetInstanceId: string;
  troops: number;
}

/**
 * A mutable in-flight projectile. Carried in the world array, advanced each
 * tick (travel, homing, deflection), and routed into `applyDamage` on a hit.
 * Fields are plain serialisable data so a checkpoint captures the array whole.
 */
export interface SimProjectile {
  /** Stable id for interpolation matching across frames. Assigned from a
   *  deterministic per-battle counter at spawn time so two same-seed runs
   *  produce byte-identical ids (the counter increments in spawn order, which
   *  is fixed by the seeded RNG and tick update order). */
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: WeaponType;
  /** Projectile mass — carried so the hit-impulse step knows the momentum
   *  to transfer without re-deriving it from the owning weapon. */
  mass: number;
  /** Ship-local position of the muzzle that fired this projectile, relative
   *  to the firing ship's centre. Used by the firing-recoil step to compute
   *  the lever arm against the firing ship's CoM. */
  muzzleLocalX: number;
  muzzleLocalY: number;
  damage: number;
  tracking: number;
  shieldPiercing: number;
  /** Fraction (0..1) of this projectile's momentum bypassing the deflector. */
  deflectorPiercing: number;
  armourPiercing: number;
  range: number;
  travelled: number;
  ttl: number;
  ownerId: string;
  ownerSide: "attacker" | "defender";
  targetId: string;
  // Powered×guided taxonomy (finite-burn motors), resolved from the optional
  // WeaponEffect fields at spawn. powered/guided fixed for life; thrust is the
  // SI m·s⁻² applied while burnTicks > 0. burnTicks is MUTABLE (decremented
  // each burning tick). Unpowered rounds (cannon/plasma) carry false/0. The
  // medium exhaust source reads burnTicks > 0 to inject the plume.
  powered: boolean;
  guided: boolean;
  thrust: number;
  burnTicks: number;
}
