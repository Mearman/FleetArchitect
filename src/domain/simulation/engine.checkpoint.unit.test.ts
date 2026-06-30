import { describe, expect, it } from "vitest";

import { mulberry32 } from "@/domain/simulation/rng";
import {
  getProjectileCounter,
  resetProjectileCounter,
  setProjectileCounter,
} from "@/domain/simulation/engine/projectile-id";
import {
  captureCheckpoint,
  restoreCheckpoint,
} from "@/domain/simulation/engine/checkpoint";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { freshAwarenessScratch } from "@/domain/simulation/engine/awareness";
import { SpatialHash } from "@/domain/simulation/spatial-hash";
import type { ShipCell } from "@/domain/simulation/engine/collision";
import {
  buildArenaMedium,
  restoreArenaMedium,
} from "@/domain/simulation/engine/medium-setup";
import { fleetCentroid } from "@/domain/simulation/engine/movement";
import type { EngineState } from "@/domain/simulation/engine/state";
import type {
  SimMine,
  SimPod,
  SimProjectile,
} from "@/domain/simulation/engine/types";
import type { Debris } from "@/domain/simulation/engine/debris";
import type { Emission } from "@/domain/simulation/engine/emissions";
import type { SimPulse } from "@/domain/simulation/engine/pulses";
import { EngineCheckpoint } from "@/schema/checkpoint";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";

/** Narrow an arbitrary value to `unknown[]`. `Array.isArray` alone narrows
 *  `unknown` to `any[]`, which the type-checked lint rules reject; this guard
 *  keeps the element type as `unknown` so callers must narrow it themselves. */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * EngineCheckpoint capture/restore is the serialisation core of resumable
 * battles, so it must:
 *  - preserve the AUTHORITATIVE state exactly (a captured-then-restored-then-
 *    recaptured checkpoint is deep-equal: capture and restore are inverse), and
 *  - preserve `-Infinity` / `-0` that JSON would silently discard
 *    (`lastFiredTick = -Infinity`), which is why capture uses
 *    `structuredClone`, not `JSON`, and
 *  - round-trip through the Zod schema, which parses a captured checkpoint.
 *
 * Derived caches (the crew path cache and its UNREACHABLE Symbol, the awareness
 * Map, wiring/alive-cell indices, transport graph, topology fingerprints) are
 * deliberately NOT captured — they re-warm byte-identically on first touch — so
 * a restored ship carries them undefined. That re-warming is proven end-to-end
 * by the resume determinism gate in a later phase; here we prove the capture
 * surface is a faithful, idempotent, schema-valid snapshot of authoritative
 * state.
 */

const OPEN_EDGES: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  maxHp = 50,
  mass = 5,
  powerDraw = 0,
  crewRequired = 0,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row: 0,
    x: col * 24,
    y: 0,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired,
    effect,
    command: effect.kind === "hull",
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function beam(): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 20,
    range: 5000,
    cooldown: 4,
    projectileSpeed: 0,
    projectileMass: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
  };
}

function baseStats(): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 1000,
    powerNet: 1000,
    crewRequired: 0,
    crewCapacity: 4,
    crewNet: 4,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [{ slotId: "w0", effect: beam() }],
    compartments: 0,
    airtightCompartments: 0,
  };
}

/** A small modular ship exercising modules, crew, resource and a weapon, so the
 *  checkpoint surface covers the deep nested authoritative state. */
function modularShip(id: string, side: "attacker" | "defender"): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("cmd", { kind: "hull" }, 0),
    moduleOf("p1", { kind: "power", output: 1000 }, 1, 50, 5, 0),
    moduleOf("q1", { kind: "crew", capacity: 4 }, 2, 50, 5, 0, 0),
    moduleOf("w0", beam(), 3, 50, 5, 10),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: baseStats(),
    position: { x: side === "attacker" ? -100 : 100, y: 0 },
    facing: side === "attacker" ? 0 : Math.PI,
    // Empty doctrine matches the legacy default-orders behaviour (stance
    // undefined -> balanced fallback, crew undefined -> combat, targeting
    // undefined -> nearest). The checkpoint surface round-trips it verbatim.
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

/** Assemble an EngineState a few ticks of real entities deep, plus the
 *  ±Infinity-bearing fields the JSON path would lose. */
function makeState(): { state: EngineState; rng: ReturnType<typeof mulberry32> } {
  const rng = mulberry32(12345);
  resetProjectileCounter();
  const ships = [modularShip("a1", "attacker"), modularShip("d1", "defender")].map(
    (s) => toSimShip(s, rng),
  );
  // A persisted ghost memory on the attacker, so the ghost array round-trips.
  const attacker = ships[0];
  if (attacker === undefined) throw new Error("no attacker");
  attacker.ghosts = [
    { enemyId: "d1", x: 100, y: 0, facing: Math.PI, threat: 5, ticksLeft: 12 },
  ];
  // A fired shot in the past, so the cloak window field is a finite value on one
  // ship while the other keeps the -Infinity default — both must survive.
  attacker.lastFiredTick = 7;

  const projectile: SimProjectile = {
    id: "proj-0",
    x: 10,
    y: 0,
    vx: 3,
    vy: 0,
    kind: "cannon",
    mass: 2,
    muzzleLocalX: 1,
    muzzleLocalY: 0,
    damage: 30,
    tracking: 0,
    shieldPiercing: 0,
    deflectorPiercing: 0,
    armourPiercing: 0,
    range: 5000,
    travelled: 12,
    ttl: 100,
    ownerId: "a1",
    ownerSide: "attacker",
    targetId: "d1",
    powered: false,
    guided: false,
    thrust: 0,
    burnTicks: 0,
  };
  const mine: SimMine = {
    id: "a1#mine#3#1",
    side: "attacker",
    x: 0,
    y: 50,
    ownerInstanceId: "a1",
    ownerSlotId: "w0",
    armingLeft: 2,
    damage: 40,
    radius: 30,
  };
  const pod: SimPod = {
    id: "a1#pod#3#1",
    side: "attacker",
    x: 5,
    y: 5,
    targetInstanceId: "d1",
    troops: 3,
  };
  const pulse: SimPulse = {
    id: 1,
    emitterId: "a1",
    originX: -100,
    originY: 0,
    radius: 200,
    bearing: 0,
    arc: Math.PI,
    sweepRate: 0,
    sweepAngle: 0,
    strength: 1000,
    birthTick: 1,
    maxRange: 10000,
  };
  const emission: Emission = { sourceId: "a1", x: -100, y: 0, strength: 500, t0: 2 };
  const debris: Debris = {
    id: "d1#debris#3#1",
    x: 80,
    y: 10,
    velX: -1,
    velY: 0,
    mass: 100,
    radius: 2,
    salvageable: true,
  };

  const state: EngineState = {
    ships,
    attackers: ships.filter((s) => s.side === "attacker"),
    defenders: ships.filter((s) => s.side === "defender"),
    byId: new Map(ships.map((s) => [s.instanceId, s])),
    deployment: {
      attacker: fleetCentroid(ships, "attacker"),
      defender: fleetCentroid(ships, "defender"),
    },
    points: new Map(),
    projectiles: [projectile],
    mines: [mine],
    pods: [pod],
    pulses: [pulse],
    emissions: [emission],
    debris: [debris],
    beams: [],
    particles: [],
    medium: buildArenaMedium(ships),
    chunkSeq: 1,
    mineSeq: 1,
    podSeq: 1,
    phantomSeq: 0,
    pulseSeq: 1,
    emissionSeq: 4,
    debrisSeq: 1,
    ticks: 3,
    winner: "draw",
    resolved: false,
    asteroidDiscs: [],
    dynamicOccluderScratch: [],
    aliveAtTickStartScratch: new Set(),
    aliveRealSortedScratch: [],
    projectileMediumScratch: [],
    awarenessScratch: freshAwarenessScratch(),
    shipCellHashScratch: new SpatialHash<ShipCell>(),
  };
  // Advance the projectile counter so capture records a non-zero value.
  setProjectileCounter(1);
  return { state, rng };
}

describe("captureCheckpoint / restoreCheckpoint", () => {
  it("parses against the EngineCheckpoint schema", () => {
    const { state, rng } = makeState();
    const cp = captureCheckpoint(state, rng, 3);
    // Zod accepts the captured checkpoint as-is (the schema is the storage
    // boundary contract). A throw here means the schema and the capture drifted.
    expect(() => EngineCheckpoint.parse(cp)).not.toThrow();
    // The no-progress stalemate watch is gone (the termination guarantee is now
    // the reactor-loss death rule, which carries no per-battle state).
    expect("stalemate" in cp).toBe(false);
  });

  it("preserves -Infinity the JSON path would lose", () => {
    const { state, rng } = makeState();
    const cp = captureCheckpoint(state, rng, 3);

    // The defender never fired: -Infinity must survive verbatim.
    const defender = cp.ships.find((s) => s.instanceId === "d1");
    expect(defender?.lastFiredTick).toBe(Number.NEGATIVE_INFINITY);
    // The attacker fired on tick 7: the finite value survives too.
    const attacker = cp.ships.find((s) => s.instanceId === "a1");
    expect(attacker?.lastFiredTick).toBe(7);

    // JSON would have turned -Infinity into `null` — prove the hazard is real.
    const viaJson: unknown = JSON.parse(JSON.stringify(cp));
    if (
      typeof viaJson !== "object" ||
      viaJson === null ||
      !("ships" in viaJson)
    ) {
      throw new Error("unexpected JSON shape");
    }
    const jsonShips = viaJson.ships;
    if (!isUnknownArray(jsonShips)) throw new Error("ships not an array");
    const jsonDefender = jsonShips.find(
      (s): s is { instanceId: string; lastFiredTick: unknown } =>
        typeof s === "object" &&
        s !== null &&
        "instanceId" in s &&
        s.instanceId === "d1",
    );
    expect(jsonDefender?.lastFiredTick).toBeNull();
  });

  it("round-trips: capture ∘ restore ∘ capture is idempotent", () => {
    const { state, rng } = makeState();
    const first = captureCheckpoint(state, rng, 3);

    // Restore into a fresh engine, rebuild a matching EngineState, and re-capture.
    const restored = restoreCheckpoint(first);
    // Seed a generator at the restored RNG position and the counters, exactly as
    // the resume entry (a later phase) will, so the re-capture reads the same
    // RNG state and projectile counter.
    const resumedRng = mulberry32(12345, restored.rngState);
    setProjectileCounter(restored.projectileCounter);

    const reState: EngineState = {
      ships: restored.ships,
      attackers: restored.ships.filter((s) => s.side === "attacker"),
      defenders: restored.ships.filter((s) => s.side === "defender"),
      byId: new Map(restored.ships.map((s) => [s.instanceId, s])),
      deployment: restored.deployment,
      points: new Map(),
      projectiles: restored.projectiles,
      mines: restored.mines,
      pods: restored.pods,
      pulses: restored.pulses,
      emissions: restored.emissions,
      debris: restored.debris,
      beams: restored.beams,
      particles: restored.particles,
      medium: restoreArenaMedium(restored.medium, restored.ships),
      chunkSeq: restored.chunkSeq,
      mineSeq: restored.mineSeq,
      podSeq: restored.podSeq,
      phantomSeq: restored.phantomSeq,
      pulseSeq: restored.pulseSeq,
      emissionSeq: restored.emissionSeq,
      debrisSeq: restored.debrisSeq,
      ticks: restored.ticks,
      winner: "draw",
      resolved: false,
      asteroidDiscs: [],
      dynamicOccluderScratch: [],
      aliveAtTickStartScratch: new Set(),
      aliveRealSortedScratch: [],
      projectileMediumScratch: [],
      awarenessScratch: freshAwarenessScratch(),
      shipCellHashScratch: new SpatialHash<ShipCell>(),
    };
    const second = captureCheckpoint(reState, resumedRng, restored.tick);

    // The two checkpoints must be deep-equal: capture and restore are inverse,
    // and no authoritative field was lost, mangled, or re-derived differently.
    expect(second).toEqual(first);
    // The projectile counter the re-capture read matches the original.
    expect(getProjectileCounter()).toBe(first.counters.projectile);
  });

  it("leaves derived caches undefined and awareness empty on a restored ship", () => {
    const { state, rng } = makeState();
    const cp = captureCheckpoint(state, rng, 3);
    const restored = restoreCheckpoint(cp);
    const ship = restored.ships[0];
    if (ship === undefined) throw new Error("no ship");
    // The crew path cache (and its UNREACHABLE Symbol), the topology/break-apart
    // fingerprints, the wiring-reach Set, the alive-cell index and the transport
    // graph all re-warm on first touch, so they start undefined.
    expect(ship.pathCache).toBeUndefined();
    expect(ship.topologyFingerprint).toBeUndefined();
    expect(ship.wiringReach).toBeUndefined();
    expect(ship.aliveCells).toBeUndefined();
    expect(ship.resourceGraph).toBeUndefined();
    expect(ship.breakApartLastAliveCount).toBeUndefined();
    expect(ship.aliveCount).toBeUndefined();
    // The per-tick awareness Map is rebuilt at the top of the resumed tick.
    expect(ship.awareness.size).toBe(0);
  });
});
