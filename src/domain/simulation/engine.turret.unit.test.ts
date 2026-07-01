import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { runBattle } from "@/domain/simulation/engine";
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
 * Independently-rotating turrets. A weapon with `turretTurnRate > 0` slews a
 * live barrel angle toward its target each tick, clamped to a traverse window
 * of `±turretArc` about its mount direction (`weaponFacing`). The barrel angle
 * is independent of the ship's heading, so a turret can engage an off-axis
 * target a fixed mount could never bear on. A fixed mount (`turretTurnRate 0`)
 * leaves its barrel on the mount direction and fires only when the ship's own
 * heading brings the target into the forward firing arc.
 *
 * The ship sits at the origin facing +x, holds station (`engageRange: "hold"`
 * so it never turns), and carries a single weapon plus a command reactor. The
 * target sits on the +y axis at bearing ≈ π/2, which is outside the ship's
 * forward firing arc (SIM.firingArc ≈ 1.2 rad < π/2). So:
 *  - a fixed mount never fires (the ship can't point at the target and the
 *    barrel can't move);
 *  - a turret with enough arc slews its barrel to π/2 and fires off-axis.
 */

/** The muzzle clearance the engine spawns projectiles at, in world units. */
const MUZZLE_OFFSET = CELL_SIZE / 2;

/**
 * Doctrine equivalent of the legacy `{ ...defaultOrders, engageRange: "hold" }`:
 * every axis at its default (balanced stance, nearest targeting, no focus fire,
 * no cohesion, no retreat) except range, which holds station within a 0.3 band
 * of the target so the ship's heading never changes.
 */
const HOLD_STATION_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 0,
    range: 1000,
    cooldown: 1000,
    projectileSpeed: 1,
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
  command = false,
): ResolvedModule {
  const isWeapon = effect.kind === "weapon";
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col: Math.round(x),
    row: Math.round(y),
    x,
    y,
    maxSurfaceHp: 0,
    maxSubstrateHp: 50,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
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
    weaponFacing: 0,
    turretArc: isWeapon && effect.kind === "weapon" ? effect.turretArc ?? 0 : 0,
    turretTurnRate:
      isWeapon && effect.kind === "weapon" ? effect.turretTurnRate ?? 0 : 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function statsBlock(): ShipStats {
  return {
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
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
  airtightCompartments: 0,
};
}

/** An attacker at the origin facing +x with a single weapon and a command
 *  reactor, holding station so its heading never changes. */
function weaponShip(id: string, weapon: WeaponEffect): CombatShip {
  const modules: ResolvedModule[] = [
    moduleOf("w1", weapon, 0, 0),
    moduleOf("p1", { kind: "power", output: 40 }, 0, -12, true),
  ];
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "attacker",
    stats: statsBlock(),
    position: { x: 0, y: 0 },
    facing: 0,
    doctrine: HOLD_STATION_DOCTRINE,
    classification: "frigate",
    modules,
  };
}

/** A stationary target on the +y axis (bearing ≈ π/2 from the origin). */
function targetAt(id: string, x: number, y: number): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side: "defender",
    stats: { ...statsBlock(), structure: 1_000_000 },
    position: { x, y },
    facing: Math.PI,
    doctrine: HOLD_STATION_DOCTRINE,
    classification: "frigate",
  };
}

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

/** The first projectile the attacker ever spawned, if any. */
function firstProjectile(
  result: ReturnType<typeof runBattle>,
): { x: number; y: number; kind: string } | undefined {
  for (const frame of result.frames) {
    const proj = frame.projectiles[0];
    if (proj !== undefined) return proj;
  }
  return undefined;
}

/** The index of `slotId` in the attacker's descriptor layout. The per-tick
 *  cells are INDEX-MATCHED to the layout, so the cell for that slot is
 *  cells[indexOf(slotId)]. */
function attackerCellIndex(result: ReturnType<typeof runBattle>, slotId: string): number | undefined {
  const layout = result.descriptors?.find((d) => d.instanceId === "a1")?.cells;
  if (layout === undefined) return undefined;
  const idx = layout.findIndex((c) => c.slotId === slotId);
  return idx === -1 ? undefined : idx;
}

/** The live turret angle of the attacker's weapon module on the last frame
 *  it is reported (turret modules emit `turretAngle`; fixed mounts don't). */
function lastTurretAngle(
  result: ReturnType<typeof runBattle>,
): number | undefined {
  const w1Idx = attackerCellIndex(result, "w1");
  if (w1Idx === undefined) return undefined;
  let last: number | undefined;
  for (const frame of result.frames) {
    const ship = frame.ships.find((s) => s.instanceId === "a1");
    const angle = ship?.cells?.cellTurretAngle?.[w1Idx];
    if (angle !== undefined && !Number.isNaN(angle)) last = angle;
  }
  return last;
}

describe("engine.turrets", () => {
  it("a turret slews to bear on an off-axis target and fires", () => {
    // A 360° turret that slews fast enough to reach π/2 within a few ticks.
    const turret = cannon({ turretArc: Math.PI, turretTurnRate: 0.3 });
    const result = runBattle(inputs([weaponShip("a1", turret), targetAt("d1", 0, 80)]));

    // It fired despite the target being outside the ship's forward firing arc.
    const proj = firstProjectile(result);
    expect(proj, "the turret should have fired at the off-axis target").toBeDefined();

    // The barrel slewed to bear on the +y target: live angle ≈ π/2.
    const angle = lastTurretAngle(result);
    expect(angle, "a turret weapon should report its live barrel angle").toBeDefined();
    if (angle === undefined) return;
    expect(Math.abs(angle - Math.PI / 2)).toBeLessThan(0.2);
  });

  it("the projectile spawns from the slewed muzzle, not the ship's nose", () => {
    // With the barrel slewed to ≈ π/2 the muzzle sits on the ship's +y side,
    // so the first projectile spawns near (0, +MUZZLE_OFFSET) — not (+x, 0)
    // where a forward mount would put it. The probe speed (0.01) is tiny, so
    // the captured frame reads essentially the muzzle position.
    const turret = cannon({ turretArc: Math.PI, turretTurnRate: 0.3, projectileSpeed: 0.01 });
    const result = runBattle(inputs([weaponShip("a1", turret), targetAt("d1", 0, 80)]));
    const proj = firstProjectile(result);
    expect(proj).toBeDefined();
    if (proj === undefined) return;
    expect(proj.y).toBeGreaterThan(MUZZLE_OFFSET * 0.8);
    expect(Math.abs(proj.x)).toBeLessThan(MUZZLE_OFFSET);
  });

  it("a fixed mount (turretTurnRate 0) does not fire at an off-axis target", () => {
    // Same geometry, but a fixed mount: the barrel can't move and the ship's
    // forward arc (≈1.2 rad) doesn't cover the +y target (bearing ≈ π/2),
    // so no shot is ever fired.
    const fixed = cannon();
    const result = runBattle(inputs([weaponShip("a1", fixed), targetAt("d1", 0, 80)]));
    expect(firstProjectile(result)).toBeUndefined();
    // A fixed mount emits no live turret angle.
    expect(lastTurretAngle(result)).toBeUndefined();
  });

  it("a fixed mount still fires when the target is within its forward arc", () => {
    // Target dead ahead on the +x axis: a fixed forward mount fires, exactly
    // as before turrets existed.
    const fixed = cannon();
    const result = runBattle(inputs([weaponShip("a1", fixed), targetAt("d1", 80, 0)]));
    const proj = firstProjectile(result);
    expect(proj).toBeDefined();
    if (proj === undefined) return;
    expect(proj.x).toBeGreaterThan(MUZZLE_OFFSET);
    expect(Math.abs(proj.y)).toBeLessThan(1e-6);
  });

  it("the turret angle is clamped to its traverse arc", () => {
    // A narrow turret (±0.3 rad) can never bear on a target at bearing π/2:
    // its barrel slews only to the +0.3 rad arc limit and holds there. With
    // the target out of reach it cannot fire either.
    const narrow = cannon({ turretArc: 0.3, turretTurnRate: 0.3 });
    const result = runBattle(inputs([weaponShip("a1", narrow), targetAt("d1", 0, 80)]));

    const angle = lastTurretAngle(result);
    expect(angle).toBeDefined();
    if (angle === undefined) return;
    // Clamped at the +0.3 rad arc limit (about its mount direction 0), never
    // reaching the π/2 bearing.
    expect(angle).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(angle).toBeGreaterThan(0.3 - 1e-6);
    // Out of arc and out of the forward firing arc — no shot.
    expect(firstProjectile(result)).toBeUndefined();
  });

  it("a turret slewing onto a target holds fire until its barrel bears", () => {
    // A slow turret (turn rate 0.02) takes many ticks to swing from 0 to the
    // ≈π/2 bearing. The barrel angle on the first frame a projectile exists
    // must already be near the target bearing — the turret does not fire
    // through the side of its mount while still slewing.
    const slow = cannon({ turretArc: Math.PI, turretTurnRate: 0.02, cooldown: 0, range: 1000 });
    const result = runBattle(inputs([weaponShip("a1", slow), targetAt("d1", 0, 80)]));
    const w1Idx = attackerCellIndex(result, "w1");
    if (w1Idx === undefined) throw new Error("no w1");
    let firedAngle: number | undefined;
    for (const frame of result.frames) {
      if (frame.projectiles.length === 0) continue;
      const ship = frame.ships.find((s) => s.instanceId === "a1");
      const angle = ship?.cells?.cellTurretAngle?.[w1Idx];
      firedAngle = angle !== undefined && !Number.isNaN(angle) ? angle : undefined;
      break;
    }
    expect(firedAngle, "the turret should have fired at some point").toBeDefined();
    if (firedAngle === undefined) return;
    // The barrel was within the firing tolerance of π/2 when it fired.
    expect(Math.abs(firedAngle - Math.PI / 2)).toBeLessThan(1.2 + 1e-6);
  });

  it("turret slewing is deterministic", () => {
    const turret = cannon({ turretArc: Math.PI, turretTurnRate: 0.1 });
    const mk = () => runBattle(inputs([weaponShip("a1", turret), targetAt("d1", 0, 80)]));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });
});
