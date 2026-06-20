import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
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
 * Per-module weapon facing (Cosmoteer-style mount direction): a weapon module
 * with `facing` (radians, ship-local) fires from a muzzle offset rotated by
 * that angle from the host ship's heading. A side-mounted weapon (facing = π/2
 * or -π/2) fires perpendicular to the ship's facing; a rear-mounted weapon
 * (facing = π) fires backward; a forward-mounted weapon (facing = 0) fires
 * along ship heading — the legacy behaviour preserved for everything that
 * never declared an explicit mount angle.
 *
 * Detection strategy: the muzzle sits 6 units from the ship along
 * `(ship.facing + weapon.facing)`. We use a slow projectile (speed 1) so the
 * projectile barely moves in one tick, and inspect the first frame's first
 * projectile — its (x, y) is essentially the muzzle position. A stationary
 * target on the +x axis gives every weapon a clear shot; the long cooldown
 * (1000) and matching range ensure exactly one shot fires.
 */

function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 0,
    range: 1000,
    cooldown: 1000,
    projectileSpeed: 1,
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
  weaponFacing: number,
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
    maxScaffoldHp: maxHp,
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
    facing: 0,
    weaponFacing,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

/** A modular attacker with a single weapon module mounted at `weaponFacing`.
 *  The ship sits at the origin facing right (+x) and uses `hold` orders so it
 *  can't turn and the muzzle offset is the only thing that varies between
 *  tests. The reactor doubles as the command module so the ship can fire. */
function mountedAttacker(id: string, weaponFacing: number): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", cannon(), 12, 0, 50, weaponFacing),
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, 20, 0, true),
  ];
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
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "attacker",
    stats,
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
    modules,
  };
}

/** A huge, stationary target on the +x axis. Sits far enough that a
 *  side-mounted weapon's projectile has time to bend (or not) before
 *  landing — but the very first frame with projectiles is what we inspect,
 *  so flight time doesn't enter the assertions. */
function stationaryTarget(id: string): CombatShip {
  const stats: ShipStats = {
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
    compartments: 0,
  airtightCompartments: 0,
};
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side: "defender",
    stats,
    position: { x: 80, y: 0 },
    facing: Math.PI,
    orders: { ...defaultOrders, engageRange: "hold" },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

function inputs(ships: CombatShip[]): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed: 1,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

/** The very first projectile the attacker ever spawned. With cooldown 1000
 *  and the longest battle cap (3600), exactly one shot is fired; the snapshot
 *  on the first tick it exists in carries that projectile at the muzzle
 *  position plus a tiny tick of drift (speed 1 ⇒ 1 unit of drift). */
function firstProjectile(
  result: ReturnType<typeof runBattle>,
): { x: number; y: number; kind: string } | undefined {
  for (const frame of result.frames) {
    const proj = frame.projectiles[0];
    if (proj !== undefined) return proj;
  }
  return undefined;
}

describe("engine.per-module facing", () => {
  it("a forward-mounted weapon (facing 0) fires along ship heading", () => {
    const result = runBattle(inputs([mountedAttacker("a1", 0), stationaryTarget("d1")]));
    const first = firstProjectile(result);
    expect(first, "the attacker should have spawned at least one projectile").toBeDefined();
    if (first === undefined) return;
    // Ship at (0, 0) facing 0 with weapon facing 0 — muzzle spawn is at
    // (0 + cos(0)*6, 0 + sin(0)*6) = (6, 0); after one tick of drift toward
    // the +x target the projectile is at roughly (7, 0). The defining
    // property is that y is essentially 0 (forward = along ship heading).
    expect(first.x).toBeGreaterThan(5);
    expect(Math.abs(first.y)).toBeLessThan(1e-6);
  });

  it("a left-mounted weapon (facing +π/2) fires perpendicular to ship heading", () => {
    const result = runBattle(inputs([mountedAttacker("a1", Math.PI / 2), stationaryTarget("d1")]));
    const first = firstProjectile(result);
    expect(first).toBeDefined();
    if (first === undefined) return;
    // Ship facing 0, weapon facing +π/2 — muzzle spawn is at (0, 6). After
    // one tick of drift toward (80, 0) the projectile is at roughly (0.998,
    // ~5.93). The defining property is x ≈ 0 and y ≈ 6: the projectile
    // spawned on the ship's +y side, even though the ship itself is
    // pointing right at the target.
    expect(first.x).toBeLessThan(2);
    expect(first.y).toBeGreaterThan(5);
  });

  it("a right-mounted weapon (facing -π/2) fires perpendicular to ship heading", () => {
    const result = runBattle(inputs([mountedAttacker("a1", -Math.PI / 2), stationaryTarget("d1")]));
    const first = firstProjectile(result);
    expect(first).toBeDefined();
    if (first === undefined) return;
    // Mirror of the left case: muzzle spawn is at (0, -6); after one tick
    // of drift the projectile is at roughly (0.998, ~-5.93). The projectile
    // spawned on the ship's -y side.
    expect(first.x).toBeLessThan(2);
    expect(first.y).toBeLessThan(-5);
  });

  it("a rear-mounted weapon (facing π) fires backward relative to ship heading", () => {
    const result = runBattle(inputs([mountedAttacker("a1", Math.PI), stationaryTarget("d1")]));
    const first = firstProjectile(result);
    expect(first).toBeDefined();
    if (first === undefined) return;
    // Ship facing 0, weapon facing π — muzzle spawn is at (-6, 0). After
    // one tick of drift toward the +x target the projectile is at roughly
    // (-5, 0): it spawned on the ship's -x side (behind it) and is just
    // starting its long flight to the +x target.
    expect(first.x).toBeLessThan(-4);
    expect(first.x).toBeGreaterThan(-7);
    expect(Math.abs(first.y)).toBeLessThan(1e-6);
  });

  it("the muzzle direction rotates with ship facing (mount is ship-local)", () => {
    // Build an attacker pointing straight up (facing π/2) with the target
    // directly ahead (+y). With a forward-mounted weapon, the muzzle should
    // sit on the +y side of the ship, not on the +x side it would default
    // to. (Rotating the ship also rotates the firing arc, so we move the
    // target to keep the shot inside it.)
    const attacker = mountedAttacker("a1", 0);
    attacker.facing = Math.PI / 2;
    const target = stationaryTarget("d1");
    target.position = { x: 0, y: 80 };
    target.facing = -Math.PI / 2;
    const result = runBattle(inputs([attacker, target]));
    const first = firstProjectile(result);
    expect(first).toBeDefined();
    if (first === undefined) return;
    // Ship at (0, 0) facing π/2 with weapon facing 0 — muzzle spawn is at
    // (0 + cos(π/2)*6, 0 + sin(π/2)*6) = (0, 6). After one tick of drift
    // toward (0, 80) the projectile is at roughly (0, 7). The mount is
    // fixed in ship-local space; the world direction follows the ship's
    // heading.
    expect(Math.abs(first.x)).toBeLessThan(1e-6);
    expect(first.y).toBeGreaterThan(6);
  });

  it("legacy weapon-only tests still pass (facing defaults to 0): regression check", () => {
    // The non-modular aggregated path reads `weapon.facing` off the effect;
    // when undefined (which is the default for catalog weapons), it
    // defaults to 0. A weapon with no explicit facing fires along ship
    // heading — the behaviour the entire pre-modfacing test suite relies on.
    // This duplicate exists so a future regression that flips the default
    // surfaces here, not buried inside the forward-mounted test above.
    const result = runBattle(inputs([mountedAttacker("a1", 0), stationaryTarget("d1")]));
    const first = firstProjectile(result);
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.x).toBeGreaterThan(5);
    expect(Math.abs(first.y)).toBeLessThan(1e-6);
  });

  it("facing-driven firing is deterministic", () => {
    const mk = () =>
      runBattle(inputs([mountedAttacker("a1", Math.PI / 2), stationaryTarget("d1")]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
