/**
 * Point-defence lead-aim: the deterministic angular-rate gate that decides
 * whether a PD mount can track a projectile. Calling `tryPointDefenseIntercept`
 * directly with a hand-built projectile and a patched-open PD candidate isolates
 * the geometric filter from the rng and the rest of the battle loop.
 *
 * The gate computes the projectile's angular rate across the mount
 * `omega = |cross| / r²` where `cross = dx·p.vy − dy·p.vx` (the 2-D analogue of
 * r×v) and `dx,dy` is the mount→projectile vector. A candidate fires only when
 * `omega <= tracking + SIM.pdTrackingEpsilon`. The epsilon (0.01) lets a
 * `tracking: 0` mount still engage a near-radial infleeder (omega ≈ 0).
 *
 * The filter runs BEFORE the hitChance stack, so it composes with the per-module
 * hitChance already wired; it draws no rng, so the stream length is unaffected.
 */
import { describe, expect, it } from "vitest";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mulberry32 } from "@/domain/simulation/rng";
import { tryPointDefenseIntercept, type PdCandidate } from "@/domain/simulation/engine/point-defence";
import { CELL_SIZE } from "@/domain/grid";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { CellEdges } from "@/schema/grid";
import type { Doctrine } from "@/schema/ai";
import type { PointDefenseEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimProjectile, SimShip } from "@/domain/simulation/engine/types";

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

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

function moduleOf(
  slotId: string,
  effect: PointDefenseEffect | { kind: "power"; output: number },
  col: number,
  row: number,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    repairRate: 0,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: 30,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    mass: 5,
    powerDraw: 5,
    crewRequired: 0,
    effect,
    command: effect.kind === "power",
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

function statsBlank(): ShipStats {
  return {
    mass: 10, cost: 100, powerDraw: 0, powerOutput: 0, powerNet: 0,
    crewRequired: 0, crewCapacity: 0, crewNet: 0, structure: 9999,
    damageReduction: 0, shieldCapacity: 0, shieldRechargeRate: 0,
    shieldRechargeDelay: 30, deflectorCapacity: 0, deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0, thrust: 0.9, turnRate: 0.15, weapons: [],
    compartments: 0, airtightCompartments: 0,
  };
}

/** A PD host ship at the origin with one patched-open PD module carrying the
 *  given effect. Gates forced open so the intercept decision reduces to the
 *  angular-rate gate under test. */
function pdShipWith(pdEffect: PointDefenseEffect): PdCandidate {
  const modules: ResolvedModule[] = [
    moduleOf("p1", { kind: "power", output: 40 }, 0, -1),
    moduleOf("pd1", pdEffect, 1, 0),
  ];
  const combatShip: CombatShip = {
    instanceId: "pd-ship",
    designId: "d-pd",
    faction: "Terran",
    side: "defender",
    stats: statsBlank(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: HOLD_DOCTRINE,
    classification: "frigate",
    modules,
  };
  const ship: SimShip = toSimShip(combatShip, mulberry32(1));
  ship.x = 0;
  ship.y = 0;
  ship.alive = true;
  const pdModule = ship.modules?.find((m) => m.effect.kind === "pointDefense");
  if (pdModule === undefined) throw new Error("no PD module on pdShipWith fixture");
  pdModule.alive = true;
  pdModule.hp = 999;
  pdModule.powered = true;
  pdModule.powerCut = false;
  pdModule.manned = true;
  pdModule.charge = 999;
  pdModule.cooldown = 0;
  if (pdModule.effect.kind !== "pointDefense") throw new Error("not a PD effect");
  return { ship, module: pdModule, effect: pdModule.effect };
}

/** Build a torpedo projectile at a given position/velocity. */
function projectile(x: number, y: number, vx: number, vy: number): SimProjectile {
  return {
    id: "proj-test",
    x,
    y,
    vx,
    vy,
    kind: "torpedo",
    mass: 1,
    muzzleLocalX: 0,
    muzzleLocalY: 0,
    damage: 100,
    tracking: 0,
    shieldPiercing: 0,
    deflectorPiercing: 0,
    armourPiercing: 0,
    range: 5000,
    travelled: 0,
    ttl: 1000,
    ownerId: "attacker",
    ownerSide: "attacker",
    targetId: "pd-ship",
    powered: false,
    guided: false,
    thrust: 0,
    burnTicks: 0,
    hp: 120,
    maxHp: 120,
  };
}

/** rng that always returns 0 — below any non-zero `capped`, forcing a hit so a
 *  candidate that passes the lead-aim gate is observed to fire deterministically. */
const alwaysHit = () => 0;

describe("engine.point-defense lead-aim (tracking angular-rate gate)", () => {
  it("a high-crossing projectile is NOT engaged by a low-tracking PD", () => {
    // PD ship at origin; projectile at (100, 0) flying in +y (tangential fly-by).
    // cross = dx·vy − dy·vx = (−100)(10) − 0 = −1000; r² = 10 000; omega = 0.1.
    // tracking 0 + epsilon 0.01 = 0.01 < 0.1 → the mount cannot follow it, so
    // the candidate is dropped from `firing`: no cooldown paid, no damage, miss.
    const candidate = pdShipWith({ kind: "pointDefense", damage: 999, range: 200, cooldown: 5, hitChance: 1, tracking: 0 });
    const p = projectile(100, 0, 0, 10);
    expect(tryPointDefenseIntercept(p, [candidate], alwaysHit)).toBe(false);
    expect(p.hp).toBe(120); // untouched
    expect(candidate.module.cooldown).toBe(0); // never fired
  });

  it("the same high-crossing projectile IS engaged by a high-tracking PD", () => {
    // tracking 0.2 + epsilon 0.01 = 0.21 >= omega 0.1 → the mount tracks it,
    // the candidate fires, and (damage 999, forced hit) the torpedo dies.
    const candidate = pdShipWith({ kind: "pointDefense", damage: 999, range: 200, cooldown: 5, hitChance: 1, tracking: 0.2 });
    const p = projectile(100, 0, 0, 10);
    expect(tryPointDefenseIntercept(p, [candidate], alwaysHit)).toBe(true);
    expect(p.hp).toBeLessThanOrEqual(0);
    expect(candidate.module.cooldown).toBe(5); // paid its cycle
  });

  it("a tracking-0 PD still engages a near-radial infleeder (epsilon slack)", () => {
    // Projectile at (100, 0) flying straight at the mount in −x: cross = 0,
    // omega = 0. tracking 0 + epsilon 0.01 >= 0 → engages. This is what keeps
    // existing low-tracking PD modules useful against incoming that fly straight
    // at the ship, and why the existing head-on fixtures still intercept.
    const candidate = pdShipWith({ kind: "pointDefense", damage: 999, range: 200, cooldown: 0, hitChance: 1, tracking: 0 });
    const p = projectile(100, 0, -10, 0);
    expect(tryPointDefenseIntercept(p, [candidate], alwaysHit)).toBe(true);
  });

  it("the lead-aim gate consumes no rng (stream length is independent of it)", () => {
    // A blocked candidate draws nothing: the rng is never called. Verify by
    // counting draws — the gate is a pure geometric filter, so a projectile the
    // mount cannot track leaves the rng stream untouched (composing cleanly with
    // the single-draw hitChance contract).
    const candidate = pdShipWith({ kind: "pointDefense", damage: 999, range: 200, cooldown: 5, hitChance: 1, tracking: 0 });
    let draws = 0;
    const rng = () => { draws += 1; return 0; };
    tryPointDefenseIntercept(projectile(100, 0, 0, 10), [candidate], rng);
    expect(draws).toBe(0);
  });
});
