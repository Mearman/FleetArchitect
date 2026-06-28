import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "@/domain/simulation/engine/setup";
import {
  aggregatesChanged,
  aggregatesFingerprint,
} from "@/domain/simulation/engine/aggregates-fingerprint";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Contract for the aggregates-change fingerprint: it must move on any change to
 * a per-module flag `recomputeAggregates` reads (alive/manned/powerCut/
 * fuelStarved/charge-sign/techActive-sign) and stay still on everything else.
 * A regression here would either skip a needed recompute (stale aggregates →
 * frame drift, caught downstream by engine.preset-determinism) or recompute
 * every tick (no harm, just no speedup). Either way this test names the field
 * that broke the contract.
 *
 * The fingerprint is a pure function of the module flags; `aggregatesChanged`
 * layers a per-ship WeakMap cache on top, so both layers are exercised: the
 * pure hash for determinism + collision behaviour, the cache for the
 * changed/unchanged signal and the fresh-object miss.
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
  maxHp = 5_000,
  mass = 5,
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
    surface: "bare",
    edges: OPEN_EDGES,
    mass,
    powerDraw: effect.kind === "weapon" ? 40 : 0,
    crewRequired: 0,
    effect,
    command: effect.kind === "power",
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

function buildShip(): SimShip {
  const combat: CombatShip = {
    instanceId: "ship",
    designId: "d-ship",
    faction: "Terran",
    side: "attacker",
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules: [
      moduleOf("r1", { kind: "power", output: 1_000 }, 0, 0),
      moduleOf("w1", WEAPON, 1, 0),
    ],
  };
  return toSimShip(combat, mulberry32(7));
}

function weaponModule(ship: SimShip): SimModule {
  if (ship.modules === undefined) throw new Error("no modules");
  const m = ship.modules.find((mod) => mod.slotId === "w1");
  if (m === undefined) throw new Error("slot w1 not found");
  return m;
}

describe("aggregatesFingerprint — pure hash", () => {
  it("is a pure function of the module flags (same input ⇒ same hash)", () => {
    const ship = buildShip();
    expect(aggregatesFingerprint(ship)).toBe(aggregatesFingerprint(ship));
  });

  it("returns 0 for a non-modular ship", () => {
    const ship = buildShip();
    ship.modules = undefined;
    expect(aggregatesFingerprint(ship)).toBe(0);
  });
});

describe("aggregatesChanged — cache + contract", () => {
  it("returns true on the first call (WeakMap miss) then false while idle", () => {
    const ship = buildShip();
    expect(aggregatesChanged(ship)).toBe(true); // first call seeds the cache
    expect(aggregatesChanged(ship)).toBe(false); // no change since
  });

  it("a fresh ship object always misses (resume / break-apart semantics)", () => {
    const a = buildShip();
    const b = buildShip(); // byte-identical contents, distinct object
    aggregatesChanged(a); // seed a's cache
    expect(aggregatesChanged(b)).toBe(true); // b is a new object → miss
  });

  type Flip = (m: SimModule) => void;
  const trackedFlips: Array<{ name: string; flip: Flip }> = [
    { name: "alive", flip: (m) => { m.alive = !m.alive; } },
    { name: "manned", flip: (m) => { m.manned = !m.manned; } },
    { name: "powerCut", flip: (m) => { m.powerCut = !m.powerCut; } },
    { name: "fuelStarved", flip: (m) => { m.fuelStarved = !m.fuelStarved; } },
    { name: "charge sign", flip: (m) => { m.charge = m.charge > 0 ? 0 : 1; } },
    { name: "techActive sign", flip: (m) => { m.techActive = m.techActive > 0 ? 0 : 1; } },
  ];

  it.each(trackedFlips)("moves when $name flips (and settles after)", ({ flip }: { flip: Flip }) => {
    const ship = buildShip();
    aggregatesChanged(ship); // seed
    expect(aggregatesChanged(ship)).toBe(false);
    const m = weaponModule(ship);
    flip(m);
    expect(aggregatesChanged(ship)).toBe(true); // detected
    expect(aggregatesChanged(ship)).toBe(false); // settled at the new state
    flip(m); // restore
    expect(aggregatesChanged(ship)).toBe(true); // back to original state detected
    expect(aggregatesChanged(ship)).toBe(false);
  });

  it("charge magnitude below the sign threshold does not move the fingerprint", () => {
    const ship = buildShip();
    aggregatesChanged(ship); // seed
    const m = weaponModule(ship);
    m.charge = 5;
    aggregatesChanged(ship); // settle at charge>0
    m.charge = 3; // still >0 — isCharged unchanged
    expect(aggregatesChanged(ship)).toBe(false);
  });

  it("does NOT move on the excluded output/stable fields (powered, mass)", () => {
    const ship = buildShip();
    aggregatesChanged(ship); // seed
    const m = weaponModule(ship);
    m.powered = !m.powered; // output of recompute, not an input
    expect(aggregatesChanged(ship)).toBe(false);
    m.mass = 999; // lifetime-stable
    expect(aggregatesChanged(ship)).toBe(false);
  });
});
