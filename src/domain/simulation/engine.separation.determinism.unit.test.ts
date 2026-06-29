/**
 * Separation steering determinism gate: the inter-ship separation blend must be
 * byte-identical across two same-seed runs.
 *
 * Separation (movement.ts) builds a per-tick snapshot of every ship's pose and
 * bounding radius, sorted by instanceId, and sums — for each ship — a proximity-
 * weighted away-vector over every neighbour inside the field, in that fixed id
 * order. Floating-point addition is not associative, so a stable summation order
 * is the determinism contract: change the order and the low-order bits drift,
 * and two runs of the same battle diverge. This test proves the contract holds
 * by running an open-space multi-ship battle twice with the same seed and
 * asserting every emitted frame is byte-identical.
 *
 * Open space (no anomaly) isolates separation from gravity, and the fixture
 * places a tight cluster of ships spanning the id sort order within the
 * separation field, so the multi-neighbour summation is genuinely exercised — a
 * ship inside the cluster is repelled by several others every tick.
 *
 * Self-contained (no shared helper) so the gate cannot silently change when an
 * unrelated helper does.
 */
import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import { ACCEL_PER_TICK_FROM_SI } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** Build a ResolvedModule with the per-instance fields the engine reads. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: slotId,
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    maxSurfaceHp: 0,
    maxSubstrateHp: 50,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: 5,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: effect.kind === "engine" ? effect.facing ?? 0 : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A modular ship with a command, an engine, an RCS, and a spread of hull cells
 *  so it has real movement and attitude authority AND a broad enough footprint
 *  (radius ≈ 5.5 m) that a cluster placed ~10 m apart falls inside the
 *  size-relative separation field (contact ≈ 11 m, outer ≈ 16.5 m). It actually
 *  steers under the separation blend, so the term is exercised, not bypassed. */
function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
}): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 60,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: 0.5, facing: Math.PI }, -5, 0),
    // SI torque (see ACCEL_PER_TICK_FROM_SI): the integrator rescales torque/I
    // into the per-tick clock, so this is authored 1/that-factor larger than the
    // bare per-tick authority — the angular twin of the linear thrust scale.
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 / ACCEL_PER_TICK_FROM_SI }, 0, 0),
    moduleOf(`${opts.id}-h1`, { kind: "hull" }, 5, 0),
    moduleOf(`${opts.id}-h2`, { kind: "hull" }, 0, 5),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

/** An open-space battle with the given ships, fixed seed. Open space (no
 *  anomaly) isolates separation from gravity; a few hundred ticks of clustered
 *  movement exercises the multi-neighbour summation every tick a ship is inside
 *  the field, which is all the determinism gate needs to prove. */
function openSpaceBattle(ships: CombatShip[], seed: number, maxTicks: number): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed,
    maxTicks,
  };
}

describe("engine separation determinism", () => {
  it("is byte-identical across two same-seed runs with a tight cluster in the field", () => {
    // Distinct ids spanning the sort order (alpha < bravo < charlie < delta),
    // mixed sides so neither side empties, placed in a tight cluster inside the
    // size-relative separation field (contact ≈ 11 m, outer ≈ 16.5 m) so every
    // ship is repelled by several neighbours and the fixed-order multi-neighbour
    // summation is exercised.
    const ships = [
      ship({ id: "s-delta", side: "attacker", x: 200, y: 0 }),
      ship({ id: "s-bravo", side: "attacker", x: 209, y: 2 }),
      ship({ id: "s-charlie", side: "defender", x: 204, y: 8 }),
      ship({ id: "s-alpha", side: "defender", x: 196, y: 4 }),
    ];

    // A few hundred ticks: enough clustered manoeuvring to accumulate any
    // ordering drift into a visible frame divergence, without running the full
    // light-lag cap twice.
    const DETERMINISM_TICKS = 400;
    const a = runBattle(openSpaceBattle(ships, 7, DETERMINISM_TICKS));
    const b = runBattle(openSpaceBattle(ships, 7, DETERMINISM_TICKS));

    // The gate: every frame byte-identical (deep structural equality over the
    // whole frame stream), plus the run-level summary fields.
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);

    // Sanity: the ships actually moved under the blended steering (the field is
    // live, not a no-op), so the determinism above is over a real trajectory and
    // not a trivially-static scene. At least one ship's position changed from its
    // deployment point by more than a tick of numerical noise.
    const first = a.frames[0];
    const last = a.frames.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) throw new Error("no frames");
    let maxDrift = 0;
    for (const s of last.ships) {
      const start = first.ships.find((f) => f.instanceId === s.instanceId);
      if (start === undefined) continue;
      const drift = Math.hypot(s.x - start.x, s.y - start.y);
      if (drift > maxDrift) maxDrift = drift;
    }
    expect(maxDrift).toBeGreaterThan(1);
  });

  it("is byte-identical over a longer run as the cluster disperses and re-encounters", () => {
    // A longer run to catch any drift that only surfaces over many ticks of
    // accumulation. Same fixture shape, same seed.
    const LONG_TICKS = 1200;
    const ships = [
      ship({ id: "k-2", side: "attacker", x: 100, y: 0 }),
      ship({ id: "k-1", side: "attacker", x: 109, y: 3 }),
      ship({ id: "k-3", side: "defender", x: 104, y: 8 }),
    ];
    const a = runBattle(openSpaceBattle(ships, 99, LONG_TICKS));
    const b = runBattle(openSpaceBattle(ships, 99, LONG_TICKS));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });
});
