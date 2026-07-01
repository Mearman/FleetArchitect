import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { countAlive, hasDeadCell } from "@/domain/simulation/test-cell-helpers";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Opus-tier keystone test: the per-module damage model. Each module on a ship
 * is an independently-destroyable part; the ship survives while its modules
 * die one by one, the snapshot carries per-module state, and the model stays
 * deterministic.
 */

function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 30,
    range: 500,
    cooldown: 5,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    ...over,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  x: number,
  y: number,
  maxHp: number,
  mass = 5,
  powerDraw = 0,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col: Math.round(x),
    row: Math.round(y),
    x,
    y,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
    crewRequired: 0,
    effect,
    command,
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

/** A legacy (non-modular) ship, used as the hammer that degrades a modular
 *  target without itself taking per-module damage. */
function hammerShip(id: string, x: number): CombatShip {
  const weapon = beam();
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 99999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [{ slotId: "s", effect: weapon }],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats,
    position: { x, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
  };
}

/** A modular defender: a few low-HP modules on a tough hull. */
function modularDefender(id: string, x: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", beam({ damage: 1, range: 50 }), 12, 0, 20),
    moduleOf("s1", { kind: "shield", capacity: 0, rechargeRate: 0, rechargeDelay: 60 }, -12, 0, 20),
    moduleOf("e1", { kind: "engine", thrust: 0.4 }, 0, 12, 20),
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20, 5, 0, true),
  ];
  // stats.thrust includes the engine module's thrust; hullBaseThrust is
  // recovered as stats.thrust - sum(engine thrust).
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 2000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.9, // 0.5 hull base + 0.4 engine
    turnRate: 0.15,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats,
    position: { x, y: 0 },
    facing: Math.PI,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/**
 * Doctrine equivalent of the legacy `{ ...defaultOrders, engageRange: "hold" }`
 * both fixtures used: hold station at range (band 0.3, the legacy default), all
 * other axes left empty so the engine's legacy-equivalent fallbacks apply
 * (stance -> balanced, crew -> combat, targeting -> nearest).
 */
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

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.per-module-damage", () => {
  it("modules are destroyed independently while the ship survives", () => {
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    // Find a frame where the defender has a destroyed module but is still alive.
    const degrading = result.frames.find(
      (f) =>
        f.ships.find((s) => s.instanceId === "d1")?.alive === true &&
        hasDeadCell(f.ships.find((s) => s.instanceId === "d1")?.cells),
    );
    expect(degrading, "a module should be destroyed before the ship dies").toBeDefined();
    if (degrading === undefined) return;
    const defender = degrading.ships.find((s) => s.instanceId === "d1");
    expect(defender?.alive).toBe(true);
    expect(hasDeadCell(defender?.cells)).toBe(true);
  });

  it("the snapshot carries per-module hp and alive state", () => {
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const first = result.frames[0];
    if (first === undefined) throw new Error("no frames");
    const defender = first.ships.find((s) => s.instanceId === "d1");
    expect(defender?.cells).toBeDefined();
    expect(defender?.cells?.cellHp.length).toBe(4);
    // At deployment every module is intact and full HP.
    expect(countAlive(defender?.cells)).toBe(4);
    for (let i = 0; i < (defender?.cells?.cellHp.length ?? 0); i += 1) {
      expect(defender?.cells?.cellHp[i]).toBeGreaterThan(0);
    }
  });

  it("is deterministic for modular ships", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });

  it("slim snapshot: per-tick cells carry only dynamic state, static layout lives once in descriptors", () => {
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const first = result.frames[0];
    if (first === undefined) throw new Error("no frames");
    const defenderCells = first.ships.find((s) => s.instanceId === "d1")?.cells;
    expect(defenderCells).toBeDefined();
    if (defenderCells === undefined) return;

    // The per-tick cell state is flat typed arrays carrying dynamic state only
    // — never the static layout (kind, offset, max HP, surface) that the
    // descriptor now owns.
    expect(defenderCells.cellHp).toBeInstanceOf(Float64Array);
    expect(defenderCells.cellAlive).toBeInstanceOf(Uint8Array);
    expect(defenderCells).not.toHaveProperty("kind");
    expect(defenderCells).not.toHaveProperty("x");
    expect(defenderCells).not.toHaveProperty("maxHp");
    // The per-frame ship snapshot no longer carries the outline either.
    expect(first.ships.find((s) => s.instanceId === "d1")).not.toHaveProperty("outline");

    // The static layout for every cell is present once in the descriptor. The
    // per-tick cells are INDEX-MATCHED to it (both s.modules order), so the
    // arrays are the same length and the dynamic state carries no slotId.
    const descriptor = result.descriptors?.find((d) => d.instanceId === "d1");
    expect(descriptor).toBeDefined();
    expect(descriptor?.cells?.length).toBe(defenderCells.cellHp.length);
    for (const layout of descriptor?.cells ?? []) {
      expect(typeof layout.kind).toBe("string");
      expect(typeof layout.ox).toBe("number");
      expect(typeof layout.oy).toBe("number");
      expect(layout.maxHp).toBeGreaterThan(0);
    }
  });

  it("descriptors are byte-identical across two same-seed runs", () => {
    const mk = () => runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    const a = mk();
    const b = mk();
    expect(b.descriptors).toEqual(a.descriptors);
    // And the order is stable (lexicographic by instance id).
    const ids = (a.descriptors ?? []).map((d) => d.instanceId);
    const sorted = [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  it("eventually destroys the ship once modules and hull are depleted", () => {
    // A brutal hammer that chews through the modules then the hull.
    const result = runBattle(inputs([hammerShip("a1", 0), modularDefender("d1", 80)]));
    expect(result.winner).toBe("attacker");
    const last = result.frames.at(-1);
    const defender = last?.ships.find((s) => s.instanceId === "d1");
    expect(defender?.alive).toBe(false);
  });
});
