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
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** Hold-station doctrine: the legacy `defaultOrders` with `engageRange: "hold"`
 *  re-expressed on the spatial axis — station-keep within band of the target.
 *  Every other axis is left at the doctrine default (balanced stance fallback,
 *  combat crew, nearest targeting), matching the legacy `defaultOrders` baseline. */
const HOLD_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
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
    maxReactiveHp: 0,
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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
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
    doctrine: HOLD_DOCTRINE,
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
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
  };
}

/** A reactor-bearing survivor: command + power reactor, unarmed and stationary,
 *  so it stays alive (the reactor-loss rule never targets it) and never kills. */
function reactorSurvivor(
  id: string,
  side: "attacker" | "defender",
  x: number,
): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(`${id}-cmd`, { kind: "power", output: 1000 }, 0, 0, 99999, {
      command: true,
    }),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: statsFor(99999),
    position: { x, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A reactor-less derelict: a command module (so it survives the command-death
 *  rule) but NO power reactor, so the reactor-loss stalemate breaker kills it
 *  after 1200 idle ticks. Unarmed and stationary, so it never causes a death. */
function reactorlessDerelict(
  id: string,
  side: "attacker" | "defender",
  x: number,
): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf(`${id}-cmd`, { kind: "hull" }, 0, 0, 99999, { command: true }),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: statsFor(99999),
    position: { x, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
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

  it("resume is byte-identical across the reactor-loss stalemate window", () => {
    // A reactor-less derelict alongside a reactor-bearing survivor, both unarmed:
    // no death ever occurs, so the reactor-loss stalemate breaker fires at the
    // 1200-idle-tick threshold and kills the derelict. The checkpoint at C=600
    // carries ticksSinceLastDeath=600; a resumed run must fire the rule at the
    // SAME absolute tick (1200), which only holds if the counter is captured —
    // otherwise resume resets it and the derelict survives to the tick cap,
    // byte-diverging from the cold run (the existing crewed fixture never enters
    // a 1200-idle-tick window, so it cannot catch this).
    const ships = [
      reactorSurvivor("alive", "attacker", 0),
      reactorlessDerelict("derelict", "defender", 200),
    ];
    const inputs = battle(ships, 7, 1300);
    const C = 600;
    let checkpoint: EngineCheckpoint | undefined;
    const freshFrames = drain(inputs, {
      checkpointEvery: 600,
      onCheckpoint: (cp) => {
        if (cp.tick === C) checkpoint = cp;
      },
    });
    expect(checkpoint, `a checkpoint must be captured at tick ${C}`).toBeDefined();
    const resumed = drain(inputs, { resumeFrom: checkpoint });
    const freshTail = freshFrames.filter((f) => f.tick > C);
    expect(resumed.length, "resume yields one frame per fresh tick > C").toBe(
      freshTail.length,
    );
    expect(resumed, "every resumed frame is byte-identical to the fresh tail").toEqual(
      freshTail,
    );
    expect(frameHash(resumed)).toBe(frameHash(freshTail));
  }, 60000);

  it("a chipped torpedo's hp round-trips through a checkpoint (PD + torpedo)", () => {
    // A torpedo launcher vs a PD screen that CHIPS but does not one-shot (PD
    // damage 30 < torpedo hp 120): by the mid-battle checkpoint several
    // in-flight torpedoes carry a live `hp` below their `maxHp`. If `hp`/`maxHp`
    // failed to round-trip, the resumed PD path would read a different hull and
    // the frames would byte-diverge from the fresh tail — so the byte-identity
    // assertion is the contract that the new projectile fields survive capture
    // and restore.
    const torpedoLauncher: ModuleEffect = {
      kind: "weapon",
      weaponType: "torpedo",
      damage: 200,
      range: 5000,
      cooldown: 6,
      projectileSpeed: 10,
      projectileMass: 1,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0,
      spread: 0,
      facing: 0,
    };
    const pdEffect: ModuleEffect = {
      kind: "pointDefense",
      damage: 10,
      range: 200,
      cooldown: 0,
      hitChance: 1,
      tracking: 0,
    };
    const torpedoAttacker = (id: string, side: "attacker" | "defender", x: number): CombatShip => ({
      instanceId: id,
      designId: `d-${id}`,
      faction: "Terran",
      side,
      stats: statsFor(99999),
      position: { x, y: 0 },
      facing: 0,
      doctrine: HOLD_DOCTRINE,
      classification: "frigate",
      modules: [
        moduleOf(`${id}-cmd`, { kind: "power", output: 1000 }, 0, 0, 50, { command: true }),
        moduleOf(`${id}-q`, { kind: "crew", capacity: 3 }, 1, 0, 50),
        moduleOf(`${id}-gun`, torpedoLauncher, 2, 0, 50, { crewRequired: 1 }),
      ],
    });
    const pdDefender = (id: string, side: "attacker" | "defender", x: number): CombatShip => ({
      instanceId: id,
      designId: `d-${id}`,
      faction: "Terran",
      side,
      stats: statsFor(99999),
      position: { x, y: 0 },
      facing: Math.PI,
      doctrine: HOLD_DOCTRINE,
      classification: "frigate",
      modules: [
        moduleOf(`${id}-cmd`, { kind: "power", output: 1000 }, 0, 0, 50, { command: true }),
        moduleOf(`${id}-pd`, pdEffect, 1, 0, 50),
      ],
    });
    const ships = [
      torpedoAttacker("att", "attacker", 0),
      pdDefender("def", "defender", 80),
    ];
    const inputs = battle(ships, 7, 80);
    const freshCheckpoints = new Map<number, EngineCheckpoint>();
    const freshFrames = drain(inputs, {
      checkpointEvery: 1,
      onCheckpoint: (cp) => freshCheckpoints.set(cp.tick, cp),
    });
    // Pick a checkpoint tick at which a torpedo is genuinely chipped (0 < hp <
    // maxHp), so the resumed run carries a non-default `hp` and the byte-identity
    // assertion really exercises the new field's round-trip.
    const cpTick = [...freshCheckpoints.keys()]
      .sort((a, b) => a - b)
      .find((t) => {
        const cp = freshCheckpoints.get(t);
        return cp?.projectiles.some((p) => p.hp > 0 && p.hp < p.maxHp) ?? false;
      });
    expect(cpTick, "some checkpoint must carry an in-flight chipped torpedo").toBeDefined();
    const checkpoint = freshCheckpoints.get(cpTick ?? -1);
    const resumed = drain(inputs, { resumeFrom: checkpoint });
    const freshTail = freshFrames.filter((f) => (f.tick ?? 0) > (cpTick ?? 0));
    expect(resumed.length, "resume yields one frame per fresh tick after the checkpoint").toBe(
      freshTail.length,
    );
    expect(resumed, "resumed frames stay byte-identical once hp round-trips").toEqual(freshTail);
    expect(frameHash(resumed)).toBe(frameHash(freshTail));
  }, 60000);
});
