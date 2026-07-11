/**
 * Assemble the battle loop's initial {@link EngineState} — the seam between
 * "set up the engine" and "run the loop". A cold start builds the state from the
 * resolved {@link BattleInputs} ships; a resume rebuilds it from a captured
 * {@link EngineCheckpoint}. Either way the result is the single mutable object
 * `simulateBattle`'s loop reads and writes.
 *
 * This also performs the one global side effect the setup phase owns: restoring
 * (resume) or resetting (cold start) the per-battle projectile-id counter, so the
 * first projectile minted matches a fresh run that reached the same tick. The RNG
 * is created and owned by the generator (the loop draws from it), so it is passed
 * in rather than created here.
 */

import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { BattleInputs } from "../types";
import { computeOccluders } from "@/domain/occluders";
import { hasAnomaly } from "@/domain/anomaly";
import { restoreCheckpoint } from "./checkpoint";
import { resetProjectileCounter, setProjectileCounter } from "./config";
import { buildArenaMedium, computeAsteroidSourceCells, restoreArenaMedium } from "./medium-setup";
import { fleetCentroid } from "./movement";
import { toSimShip } from "./setup";
import { createParticleStore } from "./exhaust-particles";
import type { Rng } from "@/domain/simulation/rng";
import { freshAwarenessScratch } from "./awareness";
import { newCollisionScratch } from "./collision";
import type { ShipCell } from "./collision";
import { freshPenetrationPathScratch } from "./penetration-path";
import { SpatialHash } from "../spatial-hash";
import type { SepBody } from "./separation";
import type { EngineState } from "./state";

/**
 * The initial engine state plus the loop's entry tick. On a cold start
 * `startTick` is 1 (the tick after frame 0); on resume `startTick` is
 * `checkpoint.tick + 1`.
 */
export interface EngineBootstrap {
  state: EngineState;
  startTick: number;
}

/**
 * Build the initial {@link EngineState}. A cold start (`resumeFrom` undefined)
 * resets the projectile counter and constructs the state from the resolved ships,
 * byte-identically to the original inline prologue. A resume restores the
 * projectile counter and rebuilds every authoritative field from the checkpoint;
 * the per-side ship lists and id index are rebuilt at the top of the resumed tick
 * (like every tick), so they are seeded here from the restored ships purely to
 * satisfy the EngineState shape.
 */
export function bootstrapEngine(
  inputs: BattleInputs,
  rng: Rng,
  resumeFrom: EngineCheckpoint | undefined,
): EngineBootstrap {
  if (resumeFrom === undefined) {
    // Reset the projectile counter so each cold run starts ids at 0 regardless
    // of prior runs.
    resetProjectileCounter();
    const ships = inputs.ships.map((s) => toSimShip(s, rng));
    const medium = buildArenaMedium(ships);
    const asteroidDiscs: ReadonlyArray<{ x: number; y: number; r: number }> =
      hasAnomaly(inputs.anomalies, "asteroidField")
        ? computeOccluders(inputs.anomalies, inputs.seed >>> 0)
        : [];
    const asteroidSourceCells = computeAsteroidSourceCells(medium.field, asteroidDiscs);
    const state: EngineState = {
      ships,
      // Per-side ship lists and the id index are rebuilt each tick (top of the
      // loop) so they pick up phantoms (drones/decoys) and break-away chunks added
      // during a tick. Phantoms are full SimShips so enemies can target them; the
      // victory check and focus election filter phantoms out explicitly.
      attackers: ships.filter((s) => s.side === "attacker"),
      defenders: ships.filter((s) => s.side === "defender"),
      byId: new Map(ships.map((s) => [s.instanceId, s])),
      // Initial deployment reference: each side's centroid at the moment of
      // deployment, captured once before any ship moves. A ship with zero
      // awareness (no live contact, no ghost) advances toward the OPPOSING side's
      // deployment centroid so blind fleets close until something enters sensor
      // range. This is legitimate "we know roughly where they deployed" intel, NOT
      // live tracking — the reference never updates as enemies move, so it is not
      // omniscience.
      deployment: {
        attacker: fleetCentroid(ships, "attacker"),
        defender: fleetCentroid(ships, "defender"),
      },
      // Named waypoints: a static map authored on the fleets (resolved to world
      // coordinates at battle-start). Empty for a battle with no authored points
      // (every preset fleet). Not captured on the checkpoint — re-derived from
      // `inputs.points` identically on both cold start and resume.
      points: inputs.points ?? new Map(),
      projectiles: [],
      // Deployed mines live here for the whole run, advanced each tick like
      // projectiles. Empty unless a mine-layer module lays into it, so a battle
      // with no mine-layers keeps it empty and emits no `mines` snapshots.
      mines: [],
      // In-flight boarding pods live here for the whole run, advanced each tick
      // like projectiles/mines. Empty unless a boarding module launches into it,
      // so a battle with no boarding modules keeps it empty and emits no `pods`
      // snapshots.
      pods: [],
      // Active-radar pulses (Phase 8) live here for the whole run, advanced each
      // tick like projectiles/mines. Empty unless an active-mode sensor emits into
      // it, so a battle with no active radar keeps it empty and emits no `pulses`
      // snapshots.
      pulses: [],
      // Continuous EM emission log (Phase 9). Rebuilt each tick from every ship's
      // baseline self-emission (plus active-sensor emissions), in (ship id, module
      // array) order behind a monotonic per-battle counter so two same-seed runs
      // produce byte-identical emission ids. The reception pass (the awareness
      // phase) consumes this; the snapshot records it (omitted when empty). No rng,
      // no clock — a pure function of ship state, mirroring pulseSeq.
      emissions: [],
      // Debris field (Phase 12). A destroyed ship leaves wreckage that keeps its
      // centre-of-mass momentum and drifts frictionlessly thereafter, advanced
      // each tick like projectiles/mines. Empty until the first ship dies, so a
      // battle with no destruction keeps it empty and emits no `debris` snapshots.
      debris: [],
      // Active energy-weapon beam emissions (hitscan visual events). A beam
      // weapon applies damage instantly at the strike point; this array carries
      // the just-fired beam lines so the renderer can draw them. Each beam
      // lingers a few ticks then expires. Empty until a beam weapon fires, so a
      // battle with no beam weapons keeps it empty and emits no `beams` snapshots.
      beams: [],
      // Retarded-time beams still in flight (delay > 0 at light-second range).
      // Empty at battlefield scale where range << c — beams resolve same-tick.
      pendingBeamImpacts: [],
      // Exhaust/plume particles. Empty until a weapon source emits; stepped in
      // place on the fixed-capacity store each tick. A battle with no firing
      // weapons keeps it empty.
      particles: createParticleStore(),
      // Arena medium field: built once from the deployment bounding box and
      // seeded at the ISM baseline. Stepped each tick with per-tick sources
      // (thruster exhaust, debris, projectile wakes, nebula + asteroid anomaly
      // fills) computed in index.ts:5c.
      medium,
      // Static asteroid-disc field: the same discs the awareness/occlusion phase
      // reads, cached once here so the medium's particulate source and the
      // occlusion query share an identical, deterministic disc set. Empty
      // outside an asteroid-field battle.
      asteroidDiscs,
      // Precomputed asteroid source-cell list: the grid-cell indices that lie
      // within any disc's uplift region, in row-major order. Built once so the
      // per-tick medium deposit loop is O(sourceCells) instead of O(cells x discs).
      asteroidSourceCells,
      // Deterministic per-battle id counters. Each advances in spawn order, with
      // no rng and no clock, so two same-seed runs produce byte-identical ids.
      chunkSeq: 0,
      mineSeq: 0,
      podSeq: 0,
      phantomSeq: 0,
      pulseSeq: 0,
      emissionSeq: 0,
      debrisSeq: 0,
      // Number of post-initial frames yielded, matching the previous
      // `frames.length - 1`: the tick-0 frame is excluded from the count.
      ticks: 0,
      ticksSinceLastDeath: 0,
      winner: "draw",
      resolved: false,
      // Per-tick scratch buffers — empty here, cleared and refilled each tick.
      // Not captured on the checkpoint; a resume re-derives them on first use.
      dynamicOccluderScratch: [],
      aliveAtTickStartScratch: new Set(),
      aliveRealSortedScratch: [],
      projectileMediumScratch: [],
      impactMediumScratch: [],
      awarenessScratch: freshAwarenessScratch(),
      shipCellHashScratch: new SpatialHash<ShipCell>(),
      separationHashScratch: new SpatialHash<SepBody>(),
      collisionScratch: newCollisionScratch(),
      pdFiringScratch: [],
      penetrationPathScratch: freshPenetrationPathScratch(),
    };
    return { state, startTick: 1 };
  }

  // Resume: restore the projectile counter, then rebuild the live entities,
  // counters and deployment from the checkpoint.
  setProjectileCounter(resumeFrom.counters.projectile);
  const restored = restoreCheckpoint(resumeFrom);
  // Rebuild the medium field from the captured scalars (the grid connectivity is
  // a pure function of `widthM`/`heightM`, so it re-derives byte-identically)
  // and reattach the restored state arrays. Absent on pre-medium checkpoints; in
  // that case rebuild from the restored ships at the ISM baseline — there is no
  // prior mid-battle state to reconstruct because the original run had no medium.
  const medium = restoreArenaMedium(restored.medium, restored.ships);
  const state: EngineState = {
    ships: restored.ships,
    attackers: restored.ships.filter((s) => s.side === "attacker"),
    defenders: restored.ships.filter((s) => s.side === "defender"),
    byId: new Map(restored.ships.map((s) => [s.instanceId, s])),
    deployment: restored.deployment,
    // Points are static authored data; re-derive from inputs identically on
    // resume (never captured on the checkpoint). Empty when no fleet authored
    // points.
    points: inputs.points ?? new Map(),
    projectiles: restored.projectiles,
    mines: restored.mines,
    pods: restored.pods,
    pulses: restored.pulses,
    emissions: restored.emissions,
    debris: restored.debris,
    beams: restored.beams,
    pendingBeamImpacts: restored.pendingBeamImpacts,
    particles: restored.particles,
    medium,
    // Asteroid discs are a pure function of (anomalies, seed); the seed is
    // captured on the checkpoint, so recompute them identically rather than
    // storing the array. Empty outside an asteroid-field battle.
    asteroidDiscs: hasAnomaly(inputs.anomalies, "asteroidField")
      ? computeOccluders(inputs.anomalies, inputs.seed >>> 0)
      : [],
    asteroidSourceCells: computeAsteroidSourceCells(
      medium.field,
      hasAnomaly(inputs.anomalies, "asteroidField")
        ? computeOccluders(inputs.anomalies, inputs.seed >>> 0)
        : [],
    ),
    chunkSeq: restored.chunkSeq,
    mineSeq: restored.mineSeq,
    podSeq: restored.podSeq,
    phantomSeq: restored.phantomSeq,
    pulseSeq: restored.pulseSeq,
    emissionSeq: restored.emissionSeq,
    debrisSeq: restored.debrisSeq,
    ticks: restored.ticks,
    ticksSinceLastDeath: restored.ticksSinceLastDeath,
    winner: "draw",
    resolved: false,
    // Per-tick scratch buffers — empty here, cleared and refilled each tick.
    // Not captured on the checkpoint; a resume re-derives them on first use.
    dynamicOccluderScratch: [],
    aliveAtTickStartScratch: new Set(),
    aliveRealSortedScratch: [],
    projectileMediumScratch: [],
    impactMediumScratch: [],
    awarenessScratch: freshAwarenessScratch(),
    shipCellHashScratch: new SpatialHash<ShipCell>(),
    separationHashScratch: new SpatialHash<SepBody>(),
    collisionScratch: newCollisionScratch(),
    pdFiringScratch: [],
    penetrationPathScratch: freshPenetrationPathScratch(),
  };
  return { state, startTick: restored.tick + 1 };
}
