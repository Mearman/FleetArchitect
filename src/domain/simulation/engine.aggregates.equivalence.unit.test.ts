import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import { recomputeAggregates } from "@/domain/simulation/engine/physics";
import { recomputeAggregatesReference } from "@/domain/simulation/engine/physics.reference";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Equivalence between the reference (oracle) and optimised power-grid +
 * aggregate recomputation. Both share the supply / demand / aggregate-build
 * logic; the only difference is the brownout cut strategy. With the optimised
 * path (production) the cut candidates are pre-sorted once in descending
 * `powerDraw` order and walked; with the reference path the cut re-scans every
 * cell on each removal. `Array.sort` is stable, so equal draws keep their
 * array order — matching the strict-`>` "first wins" tie-break of the re-scan —
 * and the bounded walk stops at the same point the while-loop would. Both
 * strategies therefore cut the same victims in the same order, so every
 * downstream aggregate (powered flags, weapons, thrust, shield pool, CoM, MoI,
 * radius, aliveCount) is byte-identical.
 *
 * Each path runs against a fresh `structuredClone` of the same resolved
 * `SimShip`, because both functions mutate ship state in place. The ship has
 * already been through one `recomputeAggregates` inside `toSimShip`; we
 * re-invoke each impl on its clone to compare the post-recompute state they
 * produce from byte-identical input.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

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
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
    airtightCompartments: 0,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  mass = 5,
  command = false,
  powerDraw = 0,
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
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    surface: "bare",
    edges: OPEN_EDGES,
    mass,
    powerDraw,
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

function combatShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

function resolveToSim(ship: CombatShip): SimShip {
  const rng = mulberry32(7);
  return toSimShip(ship, rng);
}

/** Captured post-recompute state for one module: the only field the brownout
 *  cut mutates is `powered`, but capturing the slotId too makes the diff
 *  output name the offending cell when the assertion fires. */
interface ModuleSummary {
  slotId: string;
  powered: boolean;
  alive: boolean;
}

interface ShipSummary {
  // `aliveCount` is optional on SimShip (unset until the first recompute); both
  // impls set it unconditionally, so post-recompute it is always a number, but
  // the type is modelled honestly as `| undefined` rather than masked.
  aliveCount: number | undefined;
  thrust: number;
  mass: number;
  maxShield: number;
  shieldRechargeRate: number;
  shieldRechargeDelay: number;
  deflectorCapacity: 0,
  deflectorRechargeRate: 0,
  deflectorRechargeDelay: 0,
  shieldAdaptiveRamp: number;
  shield: number;
  armourReduction: number;
  comX: number;
  comY: number;
  momentOfInertia: number;
  radius: number;
  weaponCount: number;
  weaponCooldownJoined: string;
  modules: ModuleSummary[];
}

/** Snapshot every field `recomputeAggregates` writes. Weapons are serialised
 *  by joining each effect's kind+damage+cooldown so reference-equality of the
 *  array contents is reduced to a string compare (the array identity differs
 *  because each impl pushes its own). */
function summarise(ship: SimShip): ShipSummary {
  if (ship.modules === undefined) {
    throw new Error(`${ship.instanceId} has no modules`);
  }
  const modules: ModuleSummary[] = ship.modules.map((m) => ({
    slotId: m.slotId,
    powered: m.powered,
    alive: m.alive,
  }));
  return {
    aliveCount: ship.aliveCount,
    thrust: ship.thrust,
    mass: ship.mass,
    maxShield: ship.maxShield,
    shieldRechargeRate: ship.shieldRechargeRate,
    shieldRechargeDelay: ship.shieldRechargeDelay,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    shieldAdaptiveRamp: ship.shieldAdaptiveRamp,
    shield: ship.shield,
    armourReduction: ship.armourReduction,
    comX: ship.comX,
    comY: ship.comY,
    momentOfInertia: ship.momentOfInertia,
    radius: ship.radius,
    weaponCount: ship.weapons.length,
    weaponCooldownJoined: ship.weaponCooldowns.join(","),
    modules,
  };
}

function expectEquivalent(ref: ShipSummary, opt: ShipSummary): void {
  expect(opt.modules.length, "module count must match").toBe(ref.modules.length);
  for (let i = 0; i < ref.modules.length; i += 1) {
    const rm = ref.modules[i];
    const om = opt.modules[i];
    if (rm === undefined || om === undefined) throw new Error("module summary missing");
    expect(om.slotId, "module order must match").toBe(rm.slotId);
    expect(om.alive, `alive flag for ${rm.slotId}`).toBe(rm.alive);
    expect(om.powered, `powered flag for ${rm.slotId}`).toBe(rm.powered);
  }
  expect(opt.aliveCount, "aliveCount").toBe(ref.aliveCount);
  expect(opt.thrust, "thrust").toBe(ref.thrust);
  expect(opt.mass, "mass").toBe(ref.mass);
  expect(opt.maxShield, "maxShield").toBe(ref.maxShield);
  expect(opt.shieldRechargeRate, "shieldRechargeRate").toBe(ref.shieldRechargeRate);
  expect(opt.shieldRechargeDelay, "shieldRechargeDelay").toBe(ref.shieldRechargeDelay);
  expect(opt.shieldAdaptiveRamp, "shieldAdaptiveRamp").toBe(ref.shieldAdaptiveRamp);
  expect(opt.shield, "shield").toBe(ref.shield);
  expect(opt.armourReduction, "armourReduction").toBe(ref.armourReduction);
  expect(opt.comX, "comX").toBe(ref.comX);
  expect(opt.comY, "comY").toBe(ref.comY);
  expect(opt.momentOfInertia, "momentOfInertia").toBe(ref.momentOfInertia);
  expect(opt.radius, "radius").toBe(ref.radius);
  expect(opt.weaponCount, "weaponCount").toBe(ref.weaponCount);
  expect(opt.weaponCooldownJoined, "weaponCooldownJoined").toBe(ref.weaponCooldownJoined);
}

/** Run both implementations on independent deep clones of the same resolved
 *  ship and assert identical post-recompute state. Returns the optimised
 *  summary so the caller can sanity-check that the brownout actually cut
 *  something (otherwise the equivalence holds trivially). */
function assertAggregatesEquivalent(resolved: SimShip): ShipSummary {
  const ref = structuredClone(resolved);
  const opt = structuredClone(resolved);
  recomputeAggregatesReference(ref);
  recomputeAggregates(opt);
  expectEquivalent(summarise(ref), summarise(opt));
  return summarise(opt);
}

/** Look up a module on a SimShip by slotId, throwing on a missing modules
 *  array or unknown slot so a fixture typo surfaces immediately. */
function getModule(ship: SimShip, slotId: string): SimModule {
  if (ship.modules === undefined) throw new Error(`${ship.instanceId} has no modules`);
  const m = ship.modules.find((mod) => mod.slotId === slotId);
  if (m === undefined) throw new Error(`slot ${slotId} not found on ${ship.instanceId}`);
  return m;
}

const WEAPON: WeaponEffect = {
  kind: "weapon",
  weaponType: "beam",
  damage: 1,
  range: 320,
  cooldown: 5,
  projectileSpeed: 0,
  projectileMass: 0.5,
  tracking: 0,
  shieldPiercing: 1,
  armourPiercing: 1,
  spread: 0,
  facing: 0,
};

describe("engine.aggregates — reference vs optimised recomputeAggregates equivalence", () => {
  // -------------------------------------------------------------------------
  // Fixture 1: simple two-weapon brownout.
  //
  // Reactor output 50 W; two weapons draw 80+40 = 120 W → demand > supply from
  // tick one. Both weapons are cut candidates; the hungriest (w1, 80 W) is cut
  // first, leaving demand 40 ≤ supply 50 — so w2 STAYS powered. Both paths must
  // cut exactly w1 and leave w2 online, in identical fashion.
  // -------------------------------------------------------------------------
  it("simple brownout: hungriest weapon cut, identical state on both paths", () => {
    const ship = combatShip(
      "simple-brownout",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 50 }, 0, 0, 5_000, 5, true),
        moduleOf("w1", WEAPON, 1, 0, 5_000, 5, false, 80),
        moduleOf("w2", WEAPON, 0, 1, 5_000, 5, false, 40),
      ],
    );
    const resolved = resolveToSim(ship);
    assertAggregatesEquivalent(resolved);

    // Sanity: the brownout actually fired and cut the hungriest weapon only.
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "w1").powered, "hungriest weapon must be cut").toBe(false);
    expect(getModule(sanity, "w2").powered, "lighter weapon must stay online").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fixture 2: brownout that cuts MULTIPLE modules, including a tie.
  //
  // Reactor output 30 W; three weapons draw 50, 50, 40 W (total 140). The two
  // 50-draw weapons tie: the re-scan's strict `>` picks the FIRST in array
  // order (w1), and stable sort preserves array order among equal draws — so
  // the bounded path cuts w1 first too. Cutting all three brings demand to
  // 0 ≤ 30. The tie at the front of the sort exercises the equal-draw ordering
  // equivalence between stable-sort and strict-`>`.
  // -------------------------------------------------------------------------
  it("deep brownout with tie: all weapons cut in identical order on both paths", () => {
    const ship = combatShip(
      "deep-brownout",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 30 }, 0, 0, 5_000, 5, true),
        moduleOf("w1", WEAPON, 1, 0, 5_000, 5, false, 50),
        moduleOf("w2", WEAPON, 0, 1, 5_000, 5, false, 50),
        moduleOf("w3", WEAPON, 1, 1, 5_000, 5, false, 40),
      ],
    );
    const resolved = resolveToSim(ship);
    assertAggregatesEquivalent(resolved);

    // Sanity: all three weapons cut.
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "w1").powered).toBe(false);
    expect(getModule(sanity, "w2").powered).toBe(false);
    expect(getModule(sanity, "w3").powered).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Fixture 3: mixed candidate classes — weapon, PD, shield — all cut in
  // descending draw order regardless of class. The candidate filter treats
  // weapon, pointDefense and shield identically (no class priority; the only
  // sort key is `powerDraw`), so a PD with a higher draw than a weapon is cut
  // first. Both paths must agree. Demand 130, supply 20: cutting all three
  // consumers (60+40+30 = 130) brings demand to 0 ≤ 20.
  // -------------------------------------------------------------------------
  it("mixed-class brownout: weapon/PD/shield cut by draw, identical on both paths", () => {
    const ship = combatShip(
      "mixed-brownout",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 20 }, 0, 0, 5_000, 5, true),
        moduleOf("wp", WEAPON,                                    1, 0, 5_000, 5, false, 30),
        moduleOf("pd", { kind: "pointDefense", damage: 1, range: 50, cooldown: 1, hitChance: 1, tracking: 0 }, 0, 1, 5_000, 5, false, 60),
        moduleOf("sh", { kind: "shield", capacity: 500, rechargeRate: 5, rechargeDelay: 30 }, 1, 1, 5_000, 5, false, 40),
      ],
    );
    const resolved = resolveToSim(ship);
    assertAggregatesEquivalent(resolved);

    // Sanity: all three consumers cut (demand was 130, supply 20; cutting all
    // three brings demand to 0).
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "pd").powered, "PD (highest draw) must be cut").toBe(false);
    expect(getModule(sanity, "sh").powered, "shield (next) must be cut").toBe(false);
    expect(getModule(sanity, "wp").powered, "weapon (lowest) must be cut").toBe(false);
  });

  // -------------------------------------------------------------------------
  // Fixture 4: NO brownout — demand within supply. Both paths run the cut
  // guard once, skip the body, and produce identical aggregates. Guards
  // against a refactor that diverges the no-cut path.
  // -------------------------------------------------------------------------
  it("no brownout: demand within supply, identical aggregates on both paths", () => {
    const ship = combatShip(
      "no-brownout",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 1_000 }, 0, 0, 5_000, 5, true),
        moduleOf("w1", WEAPON, 1, 0, 5_000, 5, false, 10),
        moduleOf("w2", WEAPON, 0, 1, 5_000, 5, false, 20),
      ],
    );
    const resolved = resolveToSim(ship);
    const summary = assertAggregatesEquivalent(resolved);

    // Sanity: no consumer is cut and both weapons are folded into the aggregate.
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "w1").powered).toBe(true);
    expect(getModule(sanity, "w2").powered).toBe(true);
    expect(summary.weaponCount, "both weapons counted").toBe(2);
  });

  // -------------------------------------------------------------------------
  // Fixture 5: partial cut leaves some consumers online, exercising the
  // break-on-budget-met branch in the bounded walk and the matching while-loop
  // exit in the reference. Three weapons of draws 70, 50, 30 against supply 60:
  // cut 70 (demand 150 → 80 > 60, continue), cut 50 (demand 80 → 30 ≤ 60,
  // stop). So w1 AND w2 are cut; w3 stays online.
  // -------------------------------------------------------------------------
  it("partial cut: walk breaks at budget met, identical to while-loop exit", () => {
    const ship = combatShip(
      "partial-cut",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 60 }, 0, 0, 5_000, 5, true),
        moduleOf("w1", WEAPON, 1, 0, 5_000, 5, false, 70),
        moduleOf("w2", WEAPON, 0, 1, 5_000, 5, false, 50),
        moduleOf("w3", WEAPON, 1, 1, 5_000, 5, false, 30),
      ],
    );
    const resolved = resolveToSim(ship);
    assertAggregatesEquivalent(resolved);

    // Sanity: w1 and w2 cut, w3 stays online.
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "w1").powered, "hungriest must be cut").toBe(false);
    expect(getModule(sanity, "w2").powered, "second weapon must be cut").toBe(false);
    expect(getModule(sanity, "w3").powered, "lightest weapon stays online").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fixture 6: overcharge supply — two ACTIVE overcharge modules fold their
  // `powerSurge` into the reactor total. This is the config that exposed a
  // floating-point-association bug: summing the reactor total and the surges in
  // separate accumulators rejoined at the end re-associates the sum
  // ((S_r+o1)+o2 vs S_r+(o1+o2)) and can drift. The reference folds surges into
  // the same running `supply` after the reactor total (two scans), so this
  // guards any future re-split. The weapon's draw exceeds the reactor output
  // alone but sits well under the surged supply, so the overcharge path
  // determines whether it is cut.
  // -------------------------------------------------------------------------
  it("overcharge supply: two active surges fold into the reactor total identically", () => {
    const ship = combatShip("overcharge-supply", "attacker", [
      moduleOf("r1", { kind: "power", output: 10 }, 0, 0, 5_000, 5, true),
      moduleOf(
        "o1",
        { kind: "overcharge", powerSurge: 100, duration: 5, cooldown: 10 },
        1,
        0,
        5_000,
        5,
      ),
      moduleOf(
        "o2",
        { kind: "overcharge", powerSurge: 100, duration: 5, cooldown: 10 },
        2,
        0,
        5_000,
        5,
      ),
      moduleOf("w1", WEAPON, 0, 1, 5_000, 5, false, 150),
    ]);
    const resolved = resolveToSim(ship);
    // Activate both overcharge windows so their surges contribute to supply.
    getModule(resolved, "o1").techActive = 5;
    getModule(resolved, "o2").techActive = 5;
    assertAggregatesEquivalent(resolved);

    // Sanity: the surges (100+100) lift supply to 210, well above the weapon's
    // 150 draw, so the weapon stays powered — proving the overcharge path ran
    // and relieved what would otherwise be a brownout (reactor-only supply 10).
    const sanity = structuredClone(resolved);
    recomputeAggregates(sanity);
    expect(getModule(sanity, "w1").powered, "surged supply must keep the weapon online").toBe(true);
  });
});
