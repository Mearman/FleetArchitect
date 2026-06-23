/**
 * Checkpoint-resume determinism gate: a battle resumed from a captured
 * EngineCheckpoint must produce frames byte-identical to a fresh run's tail,
 * and the capture/restore round-trip must land the resumed engine in exactly
 * the state a fresh run would be in at that tick.
 *
 * Resume reconstructs the engine from a serialised checkpoint — restoring the
 * RNG position, the projectile id counter, every authoritative ship/projectile
 * field, and the deployment reference — while DROPPING every derived cache
 * (the crew path cache, the awareness map, wiring reach, fingerprints) on the
 * understanding they re-warm identically on first touch. This test is the
 * contract that proves it: if any restored field drifted, or any dropped cache
 * failed to re-warm to the same value, the resumed frames would diverge from
 * the fresh run's by the low-order bits and the deep equality fails.
 *
 * The fixture is a CREWED battle (quarters + a crewed cannon that spawns
 * projectiles) so the gate exercises the full restore surface: crew pathing
 * (the dropped path cache), weapon fire (RNG draws via cooldown gating), and
 * in-flight projectiles (the projectile id counter and array). Two tough ships
 * survive the whole cap, so the checkpoint at tick C carries a full live state.
 *
 * Self-contained (no shared helper) so the gate cannot silently change when an
 * unrelated helper does — the same discipline as the N-body gravity gate.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { simulateBattle } from "@/domain/simulation/engine";
import type {
  BattleInputs,
  CombatShip,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { BattleFrame } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";
import { defaultOrders } from "@/schema/fleet";
import type { ShipStats } from "@/domain/stats";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** A cannon that spawns projectile entities (projectileSpeed > 0), so the
 *  projectile id counter and the in-flight projectile array both advance and
 *  are exercised by the capture/restore round-trip. */
function cannon(): ModuleEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 120,
    range: 5000,
    cooldown: 2,
    projectileSpeed: 40,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  opts: { powerDraw?: number; command?: boolean; crewRequired?: number } = {},
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: 5,
    powerDraw: opts.powerDraw ?? 0,
    crewRequired: opts.crewRequired ?? 0,
    effect,
    command: opts.command ?? false,
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

function statsFor(structure: number): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
}

/** A crewed shooter: a command reactor, a crew quarters, and a crewed cannon.
 *  Crew spawn at the quarters and man the cannon, so the path cache warms and
 *  the gate proves it re-warms identically after a resume. */
function crewedShooter(
  id: string,
  side: "attacker" | "defender",
  x: number,
): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(`${id}-cmd`, { kind: "power", output: 1000 }, 0, 0, 50, {
      command: true,
    }),
    moduleOf(`${id}-q`, { kind: "crew", capacity: 3 }, 1, 0, 50),
    moduleOf(`${id}-gun`, cannon(), 2, 0, 50, { crewRequired: 1 }),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: statsFor(99999),
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

/** A non-modular, very tough target placed close so the shooter's cannon is in
 *  range from tick one. */
function toughTarget(
  id: string,
  side: "attacker" | "defender",
  x: number,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: statsFor(1_000_000),
    position: { x, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

function battle(ships: CombatShip[], seed: number, maxTicks: number): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed,
    maxTicks,
  };
}

/** Drive a simulateBattle generator to exhaustion, collecting every frame. */
function drain(inputs: BattleInputs, options?: {
  resumeFrom?: EngineCheckpoint;
  checkpointEvery?: number;
  onCheckpoint?: (cp: EngineCheckpoint) => void;
}): BattleFrame[] {
  const frames: BattleFrame[] = [];
  const gen = simulateBattle(inputs, options);
  for (let r = gen.next(); !r.done; r = gen.next()) frames.push(r.value);
  return frames;
}

/** SHA-256 of a frame stream, matching the idiom of the other determinism
 *  gates — an independent byte-identity check alongside the deep equality. */
function frameHash(frames: readonly BattleFrame[]): string {
  return createHash("sha256").update(JSON.stringify(frames)).digest("hex");
}

// Two crewed shooters close together so both fire and crew move every run; the
// pair survives the whole cap, so a checkpoint at tick C carries full live
// state (crewed ships, in-flight projectiles, advanced counters).
const SHIPS = [
  crewedShooter("shooter-a", "attacker", 0),
  crewedShooter("shooter-b", "defender", 24),
  toughTarget("target-a", "attacker", 12),
  toughTarget("target-b", "defender", 36),
];

const TOTAL_TICKS = 80;

describe("engine checkpoint-resume determinism", () => {
  it("resumed frames are byte-identical to a fresh run's tail", () => {
    const inputs = battle(SHIPS, 7, TOTAL_TICKS);

    // Fresh run, capturing a checkpoint at every tick so we can resume from an
    // arbitrary one. Pick C well past the first volleys and the crew manning
    // their weapons, so projectiles are in flight and the path cache has warmed.
    const C = 30;
    const freshCheckpoints = new Map<number, EngineCheckpoint>();
    const freshFrames = drain(inputs, {
      checkpointEvery: 1,
      onCheckpoint: (cp) => freshCheckpoints.set(cp.tick, cp),
    });
    const checkpoint = freshCheckpoints.get(C);
    expect(checkpoint, `a checkpoint must be captured at tick ${C}`).toBeDefined();

    // Resume from C; collect the resumed tail (frames C+1..end).
    const resumed = drain(inputs, { resumeFrom: checkpoint });

    // The frames the fresh run emitted AFTER C — the resumed run reproduces
    // these exactly, never re-yielding tick C itself.
    const freshTail = freshFrames.filter((f) => f.tick > C);

    expect(resumed.length, "resume yields one frame per fresh tick > C").toBe(
      freshTail.length,
    );
    expect(resumed, "every resumed frame is byte-identical to the fresh tail").toEqual(
      freshTail,
    );
    expect(frameHash(resumed)).toBe(frameHash(freshTail));
  });

  it("capture/restore is idempotent — resume lands in the exact fresh state", () => {
    const inputs = battle(SHIPS, 7, TOTAL_TICKS);

    // Fresh run captures checkpoints at two ticks (C1 < C2).
    const C1 = 10;
    const C2 = 50;
    const freshCheckpoints = new Map<number, EngineCheckpoint>();
    drain(inputs, {
      checkpointEvery: 1,
      onCheckpoint: (cp) => freshCheckpoints.set(cp.tick, cp),
    });
    const atC1 = freshCheckpoints.get(C1);
    const freshAtC2 = freshCheckpoints.get(C2);
    expect(atC1).toBeDefined();
    expect(freshAtC2).toBeDefined();

    // Resume from C1 and re-capture a checkpoint at C2. If restore dropped or
    // drifted any field, the state at C2 would differ from the fresh run's.
    const resumedCheckpoints = new Map<number, EngineCheckpoint>();
    drain(inputs, {
      resumeFrom: atC1,
      checkpointEvery: 1,
      onCheckpoint: (cp) => resumedCheckpoints.set(cp.tick, cp),
    });
    const resumedAtC2 = resumedCheckpoints.get(C2);
    expect(resumedAtC2, "the resumed run must reach C2").toBeDefined();

    expect(resumedAtC2).toEqual(freshAtC2);
  });

  it("checkpointing does not perturb a fresh run", () => {
    const inputs = battle(SHIPS, 7, TOTAL_TICKS);

    // A run with checkpointing on (every tick) must produce the same frames as
    // a plain run with no options — the capture machinery is pure overhead and
    // never touches the loop's outputs.
    const withCheckpointing = drain(inputs, {
      checkpointEvery: 1,
      onCheckpoint: () => {
        /* discard */
      },
    });
    const plain = drain(inputs);

    expect(withCheckpointing).toEqual(plain);
    expect(frameHash(withCheckpointing)).toBe(frameHash(plain));
  });
});
