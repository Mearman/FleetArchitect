/**
 * Mutable world entities that are not ships or modules: deployed proximity
 * mines and in-flight boarding pods. Extracted from `types.ts` to keep that
 * module under the 800-line lint cap. `types.ts` re-exports them so existing
 * `import { SimMine, SimPod } from "./types"` callers are unchanged.
 */

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
