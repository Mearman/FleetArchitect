/**
 * N13 determinism gate (Gap C4 + C5): N-body gravity must be byte-identical
 * across two same-seed runs.
 *
 * The N-body gravity step (movement.ts) builds a per-tick field of the black
 * hole plus every alive ship and sums each ship's pull over every OTHER body in
 * a FIXED lexicographic id order. Floating-point addition is not associative,
 * so a stable summation order is the determinism contract: change the order and
 * the low-order bits drift, and two runs of the same battle diverge. This test
 * proves the contract holds by running a multi-ship black-hole battle twice with
 * the same seed and asserting every emitted frame is byte-identical.
 *
 * The fixture deliberately places three ships at distinct ids and distinct
 * positions near (but outside the lethal radius of) the well, so the inter-ship
 * gravity terms AND the black-hole pull both contribute and the summation order
 * actually matters — a ship is pulled by the hole and by its two neighbours
 * every tick.
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
import { defaultOrders } from "@/schema/fleet";

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

/** A modular ship with a command, an engine, and an RCS so it has real
 *  movement and attitude authority — it actually falls and steers under the
 *  N-body field, so the gravity step is exercised, not bypassed. */
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
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: 0.5, facing: Math.PI }, -1, 0),
    // SI torque (see ACCEL_PER_TICK_FROM_SI): the integrator rescales torque/I
    // into the per-tick clock, so this is authored 1/that-factor larger than the
    // bare per-tick authority — the angular twin of the linear thrust scale.
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 / ACCEL_PER_TICK_FROM_SI }, 0, 0),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: 0,
    orders: { ...defaultOrders },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

/** A black-hole battle with the given ships, fixed seed. A shorter cap than the
 *  full light-lag default is plenty: a few hundred ticks of falling under the
 *  N-body field exercises the gravity summation every tick, which is all the
 *  determinism gate needs to prove. */
function blackHoleBattle(ships: CombatShip[], seed: number, maxTicks: number): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "blackHole",
    seed,
    maxTicks,
  };
}

describe("engine N-body gravity determinism (N13)", () => {
  it("is byte-identical across two same-seed runs with 3 ships near the black hole", () => {
    // Distinct ids ("g-alpha" < "g-beta" < "g-gamma") and distinct positions
    // near the well (well outside the lethal radius of 24 m). All three pull on
    // each other AND fall toward the hole, so the fixed-order summation is
    // genuinely exercised. Two attackers and a defender so the battle does not
    // end instantly on an empty side.
    const ships = [
      ship({ id: "g-alpha", side: "attacker", x: 200, y: 0 }),
      ship({ id: "g-gamma", side: "attacker", x: 0, y: 200 }),
      ship({ id: "g-beta", side: "defender", x: -200, y: 80 }),
    ];

    // A few hundred ticks: enough falling under gravity to accumulate any
    // ordering drift into a visible frame divergence, without running the full
    // light-lag cap twice.
    const DETERMINISM_TICKS = 400;
    const a = runBattle(blackHoleBattle(ships, 7, DETERMINISM_TICKS));
    const b = runBattle(blackHoleBattle(ships, 7, DETERMINISM_TICKS));

    // The gate: every frame byte-identical (deep structural equality over the
    // whole frame stream), plus the run-level summary fields.
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);

    // Sanity: the ships actually moved under gravity (the field is live, not a
    // no-op), so the determinism above is over a real N-body trajectory and not
    // a trivially-static scene. At least one ship's position changed from its
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

  it("is byte-identical for a dense cluster where the inter-ship gravity term governs the field order", () => {
    // A tight cluster of five ships far from the well: the hole pulls them all
    // near-uniformly, so the term that actually differs ship-to-ship — and that
    // the summation ORDER governs — is the inter-ship gravity between close
    // neighbours, the part new in N13. Ids span the sort order. Proves the
    // fixed-order accumulation of the inter-ship term is byte-reproducible.
    const ships = [
      ship({ id: "c-echo", side: "attacker", x: 1000, y: 0 }),
      ship({ id: "c-alpha", side: "attacker", x: 1020, y: 15 }),
      ship({ id: "c-delta", side: "attacker", x: 1010, y: -18 }),
      ship({ id: "c-bravo", side: "defender", x: 990, y: 12 }),
      ship({ id: "c-charlie", side: "defender", x: 1005, y: 25 }),
    ];
    const a = runBattle(blackHoleBattle(ships, 11, 400));
    const b = runBattle(blackHoleBattle(ships, 11, 400));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });

  it("stays deterministic over a longer run as ordering drift accumulates", () => {
    // A longer run to catch any drift that only surfaces over many ticks of
    // accumulation (the full light-lag default cap is not run twice here — it
    // would time out for no extra coverage; the determinism property holds at
    // any tick count). Same fixture, same seed.
    const LONG_TICKS = 1200;
    const ships = [
      ship({ id: "k-1", side: "attacker", x: 150, y: 40 }),
      ship({ id: "k-3", side: "attacker", x: 40, y: 150 }),
      ship({ id: "k-2", side: "defender", x: -150, y: -40 }),
    ];
    const a = runBattle(blackHoleBattle(ships, 99, LONG_TICKS));
    const b = runBattle(blackHoleBattle(ships, 99, LONG_TICKS));
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });
});
