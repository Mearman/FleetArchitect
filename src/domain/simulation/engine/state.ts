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

import type { Disc } from "@/domain/occluders";
import type { BattleSide } from "@/schema/battle";
import type { SimBeam } from "./beams";
import type { Debris } from "./debris";
import type { Emission } from "./emissions";
import type { ExhaustParticle } from "./exhaust-particles";
import type { ArenaMedium, ProjectileMediumEntry } from "./medium-setup";
import type { AwarenessScratch } from "./awareness";
import type { ShipCell } from "./collision";
import type { SpatialHash } from "../spatial-hash";
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
 * - `projectiles` / `mines` / `pods` / `pulses` / `emissions` / `debris` /
 *   `beams` — the in-flight entity fields, advanced each tick. `beams` holds
 *   the energy-weapon beam emissions (hitscan visual events) that linger for
 *   a few ticks so the renderer can draw them.
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
  /**
   * The merged named-waypoint map (pointId → world position), built once at
   * battle-start from both fleets' authored `points` (resolved through each
   * fleet's deployment centroid + facing). Static for the whole battle; a
   * doctrine `{kind: "point", pointId}` reference resolves against it every
   * tick. Empty for a battle with no authored points (every preset fleet), so
   * point references stay unresolvable and preset battles are byte-identical.
   * Not captured on the checkpoint: it is a pure function of `inputs.points`
   * (authored data, never mutated mid-battle), so the resume path re-derives it
   * from `inputs` identically.
   */
  points: ReadonlyMap<string, { x: number; y: number }>;
  projectiles: SimProjectile[];
  mines: SimMine[];
  pods: SimPod[];
  pulses: SimPulse[];
  emissions: Emission[];
  debris: Debris[];
  /** Active energy-weapon beam emissions (hitscan visual events). Each beam
   *  lingers for a few ticks so the renderer can draw it as a line. Damages at
   *  the moment of emission; the carried objects are pure render state. */
  beams: SimBeam[];
  /**
   * Live exhaust/plume particles — the actual transferred material radiating as
   * it moves and cools (engine exhaust, beam channels, projectile wakes, impact
   * ejecta). Gathered each tick from the four weapon sources (fixed order, no
   * RNG), then stepped + culled by lifetime. Carried across ticks so a plume
   * integrates from its own prior state; captured and restored on checkpoint.
   */
  particles: ExhaustParticle[];
  /**
   * Arena medium field (the density + excitation substrate). The `field` is the
   * resolved {@link MediumField} (built once from the arena bounds; grid
   * connectivity fixed for the battle); the `state` is the current ρ + ε
   * arrays, replaced with a fresh `MediumState` each tick by `stepMediumField`;
   * the `birthTicks` array tracks when each cell first crossed the sustained-
   * emission threshold this burn and is what the medium reception light-lag
   * gate reads. Carried across ticks so the field integrates from its own prior
   * state rather than re-seeding each tick; captured and restored on checkpoint
   * so resume reproduces the tail byte-identically. Sources (thruster exhaust,
   * ablating debris, projectile wakes, nebula + asteroid anomaly fills) are
   * computed each tick in `index.ts:5c` and injected before the field diffuses
   * and decays.
   */
  medium: ArenaMedium;
  /**
   * Static asteroid-disc field for the `asteroidField` anomaly, computed once at
   * bootstrap as a pure function of `(anomalies, seed)` and reused every tick.
   * Drives both the awareness/occlusion dynamic-occluder rebuild and the
   * medium's particulate source, so the two read the identical disc set. Empty
   * outside an asteroid-field battle.
   */
  asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }>;
  chunkSeq: number;
  mineSeq: number;
  podSeq: number;
  phantomSeq: number;
  pulseSeq: number;
  emissionSeq: number;
  debrisSeq: number;
  ticks: number;
  /** No-progress counter for the reactor-loss stalemate breaker: ticks since
   *  the last real-ship death (-1 the tick a death occurs, then +1 to 0, so a
   *  death resets it). Authoritative — captured by the checkpoint so a resumed
   *  run reaches the 1200-tick threshold at the same absolute tick as the cold
   *  run (otherwise resume byte-diverges for any battle the rule ends). */
  ticksSinceLastDeath: number;
  winner: BattleSide;
  resolved: boolean;
  /**
   * Per-tick scratch buffers — reusable allocations the tick loop clears and
   * refills each tick so the hot path does not allocate. Each is derived
   * purely from the authoritative state above (ships, debris, projectiles),
   * rebuilt at the tick position its first consumer reads it, and read only
   * within the same tick; they are deliberately NOT part of the checkpoint
   * (a resume re-derives them from the restored state on the first tick).
   * `aliveRealSortedScratch` is rebuilt twice in a tick that has both an
   * awareness-phase read (early) and a debris-hazard read (after collision
   * damage can kill ships): the debris pass needs the post-collision alive
   * set, so it refreshes the buffer in place before iterating.
   */
  dynamicOccluderScratch: Disc[];
  aliveAtTickStartScratch: Set<string>;
  aliveRealSortedScratch: SimShip[];
  projectileMediumScratch: ProjectileMediumEntry[];
  /** Reusable scratch for the awareness comms-flood (`propagateContacts`):
   *  per-ship pool/received/linkedSlots/adjacency Maps + the inner-loop buffers,
   *  cleared-and-reused across ticks. Not captured on the checkpoint. */
  awarenessScratch: AwarenessScratch;
  /** Reusable `SpatialHash<ShipCell>` for `buildShipCellHash` (built twice per
   *  tick: ship-ship collision + projectile-cell hits). Entry objects recycled
   *  via the free-list; cleared-and-reused across ticks. Not checkpointed. */
  shipCellHashScratch: SpatialHash<ShipCell>;
}
