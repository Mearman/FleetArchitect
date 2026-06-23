/**
 * The battle loop's live mutable state, lifted out of `simulateBattle`'s
 * generator locals into one explicit object the loop reads and writes.
 *
 * This is purely a structural lift — the loop reads and writes exactly the same
 * values in exactly the same order as before — but having all authoritative live
 * state in one place is the foundation a checkpoint capture (later phases)
 * snapshots from and a resume restores into. Derived caches (path caches,
 * awareness, fingerprints) live on the ships and re-warm byte-identically on
 * first touch, so they are deliberately NOT part of this object.
 */

import type { BattleSide } from "@/schema/battle";
import type { Debris } from "./debris";
import type { Emission } from "./emissions";
import type { DeploymentReference } from "./movement";
import type { SimPulse } from "./pulses";
import type { SimMine, SimPod, SimProjectile, SimShip } from "./types";

/**
 * Every mutable quantity the battle loop reads and writes. Field meanings carry
 * over verbatim from the former generator locals:
 * - `ships` — every live SimShip, including phantoms (drones/decoys) and
 *   break-away chunks pushed in mid-run.
 * - `attackers` / `defenders` / `byId` — per-side views and the id index,
 *   rebuilt only when the `ships` array grows (see ./roster.ts).
 * - `deployment` — each side's centroid at the moment of deployment, captured
 *   once before any ship moves; blind fleets steer toward the opposing one.
 * - `projectiles` / `mines` / `pods` / `pulses` / `emissions` / `debris` —
 *   the in-flight entity fields, advanced each tick.
 * - the `*Seq` counters — monotonic per-battle id counters; a same-seed run
 *   produces the same ids because they advance in the same spawn order.
 * - `emissionSeq` — the monotonic EM-emission counter, threaded across ticks.
 * - `ticks` — count of post-initial frames yielded (excludes the tick-0 frame).
 * - `winner` / `resolved` — the outcome and whether it was decided in-loop.
 */
export interface EngineState {
  ships: SimShip[];
  attackers: SimShip[];
  defenders: SimShip[];
  byId: Map<string, SimShip>;
  deployment: DeploymentReference;
  projectiles: SimProjectile[];
  mines: SimMine[];
  pods: SimPod[];
  pulses: SimPulse[];
  emissions: Emission[];
  debris: Debris[];
  chunkSeq: number;
  mineSeq: number;
  podSeq: number;
  phantomSeq: number;
  pulseSeq: number;
  emissionSeq: number;
  debrisSeq: number;
  ticks: number;
  winner: BattleSide;
  resolved: boolean;
}
