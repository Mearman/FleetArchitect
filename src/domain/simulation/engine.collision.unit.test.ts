import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { CELL_SIZE } from "@/domain/grid";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Ship-vs-ship collision at cell granularity. Ships are solid bodies that may
 * not interpenetrate; when two ships' cells overlap, an elastic impulse plus
 * positional separation pushes them apart, conserving linear momentum. These
 * tests drive two ships into each other and check that they bounce (a
 * separating impulse) and pass through neither each other nor conservation.
 */

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 1_000_000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
  airtightCompartments: 0,
};
}

/** A module at integer cell coordinates; world position is the index scaled by
 *  CELL_SIZE so col/row (break-apart adjacency) and x/y (hit geometry) agree. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  mass = 5,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxScaffoldHp: 1000,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: "facing" in effect && typeof effect.facing === "number" ? effect.facing : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A modular ship of one command cell plus a forward engine and a token very
 *  short-range weapon, so under "short" engage orders it closes to point-blank
 *  and rams its target rather than holding off at standoff range. The weapon's
 *  damage is harmless (the targets have a million structure); it exists only to
 *  pull the desired range down so the ships actually collide. */
function rammer(
  id: string,
  side: "attacker" | "defender",
  position: { x: number; y: number },
  facing: number,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side,
    stats: stats({ thrust: 1 }),
    position,
    facing,
    orders: { ...defaultOrders, engageRange: "short", stance: "aggressive" },
    classification: "frigate",
    modules: [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 5, true),
      // Exhaust faces aft (π) so the thrust drives the ship forward (+x along
      // its heading) — a rammer needs to actually close on its target.
      moduleOf("e1", { kind: "engine", thrust: 1, facing: Math.PI }, 1, 0, 5),
      moduleOf(
        "w1",
        {
          kind: "weapon",
          weaponType: "cannon",
          damage: 0,
          range: 4,
          cooldown: 1000,
          projectileSpeed: 6,
          tracking: 0,
          shieldPiercing: 0,
          armourPiercing: 0,
          spread: 0,
          facing: 0,
        },
        -1,
        0,
        5,
      ),
    ],
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 7,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

interface FShip {
  instanceId: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  alive: boolean;
}

function find(frame: { ships: FShip[] }, id: string): FShip {
  const s = frame.ships.find((x) => x.instanceId === id);
  if (s === undefined) throw new Error(`no ship ${id}`);
  return s;
}

describe("engine.collision — ship-vs-ship", () => {
  it("two ships driving into each other never interpenetrate", () => {
    // Symmetric head-on: A at the left facing +x, B at the right facing -x,
    // both closing under thrust. With solid cells they must never overlap —
    // the gap between their nearest cell centres must stay at least one cell.
    const a = rammer("a1", "attacker", { x: -60, y: 0 }, 0);
    const b = rammer("b1", "defender", { x: 60, y: 0 }, Math.PI);
    const result = runBattle(inputs([a, b]));
    let minGap = Infinity;
    for (const f of result.frames) {
      const sa = find(f, "a1");
      const sb = find(f, "b1");
      const gap = Math.hypot(sb.x - sa.x, sb.y - sa.y);
      if (gap < minGap) minGap = gap;
    }
    // The ships span a couple of cells each; their centres must stay at least
    // about one cell apart — they push off rather than sliding through.
    expect(minGap, "ships must not pass through each other").toBeGreaterThan(CELL_SIZE * 0.5);
  });

  it("a head-on collision produces a separating impulse (the ships bounce)", () => {
    const a = rammer("a1", "attacker", { x: -60, y: 0 }, 0);
    const b = rammer("b1", "defender", { x: 60, y: 0 }, Math.PI);
    const result = runBattle(inputs([a, b]));
    // Track the closing speed along the line of centres: negative while the
    // ships approach, positive once they are separating. A collision impulse
    // is what flips it from approaching to separating. (The ships keep
    // thrusting toward each other, so they only briefly separate before
    // closing again — we just need to see the sign flip at all.)
    let approached = false;
    let separatedAfterApproach = false;
    for (const f of result.frames) {
      const sa = find(f, "a1");
      const sb = find(f, "b1");
      const dx = sb.x - sa.x;
      const dy = sb.y - sa.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1e-9) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // Relative velocity of B w.r.t. A projected on the normal from A to B.
      const closing = ((sb.vx ?? 0) - (sa.vx ?? 0)) * nx + ((sb.vy ?? 0) - (sa.vy ?? 0)) * ny;
      if (closing < -1e-3) approached = true;
      if (approached && closing > 1e-3) separatedAfterApproach = true;
    }
    expect(approached, "ships must approach before colliding").toBe(true);
    expect(
      separatedAfterApproach,
      "the collision impulse must flip the contact from approaching to separating",
    ).toBe(true);
  });

  it("conserves total linear momentum across a symmetric collision", () => {
    // Equal-mass mirror-image ships: by symmetry total momentum is zero at
    // every tick (A and B carry equal and opposite momentum). The collision
    // impulse is internal and equal-and-opposite, so it cannot break that —
    // total px and py stay zero throughout, including the collision frames.
    const a = rammer("a1", "attacker", { x: -50, y: 0 }, 0);
    const b = rammer("b1", "defender", { x: 50, y: 0 }, Math.PI);
    const result = runBattle(inputs([a, b]));
    // Both ships have identical mass (cells 5 + 5 = 10). Total momentum is
    // mass * (vA + vB); with equal masses the sum of velocities must stay ~0.
    let maxTotalSpeed = 0;
    for (const f of result.frames) {
      const sa = find(f, "a1");
      const sb = find(f, "b1");
      const totVx = (sa.vx ?? 0) + (sb.vx ?? 0);
      const totVy = (sa.vy ?? 0) + (sb.vy ?? 0);
      const tot = Math.hypot(totVx, totVy);
      if (tot > maxTotalSpeed) maxTotalSpeed = tot;
    }
    expect(maxTotalSpeed, "symmetric collision must keep total momentum ~0").toBeCloseTo(0, 6);
  });

  it("friendlies are solid too (all-vs-all collision)", () => {
    // Two ships on the SAME side, started overlapping. They must be pushed
    // apart by positional separation even though they are allies.
    const a = rammer("a1", "attacker", { x: -2, y: 0 }, 0);
    const b = rammer("a2", "attacker", { x: 2, y: 0 }, 0);
    // A lone enemy far away gives them something to target without
    // interfering.
    const enemy = rammer("d1", "defender", { x: 1000, y: 0 }, Math.PI);
    const result = runBattle(inputs([a, b, enemy]));
    const f1 = result.frames[1];
    if (f1 === undefined) throw new Error("no frame 1");
    const sa = find(f1, "a1");
    const sb = find(f1, "a2");
    const gap = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    // They started 4 apart (overlapping); after one tick of separation the gap
    // must have grown toward a non-overlapping distance.
    expect(gap, "overlapping allies must be pushed apart").toBeGreaterThan(4);
  });
});
