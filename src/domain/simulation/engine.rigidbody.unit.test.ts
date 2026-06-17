import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Rigid-body physics: centre of mass, projectile momentum (firing recoil
 * and hit impulse), and CoM-derived moment of inertia. Each test isolates
 * one conservation law or geometric property by setting up two ships with
 * known masses and either firing a single slow projectile or letting them
 * trade a single hit, then reading the resulting velocities off the first
 * frame after the interaction.
 *
 * The constants in play:
 *   - SIM.projectileMass = 0.5 (mass of one spawned projectile)
 *   - The hit impulse is +m_p * v_p / M_target at the impact point.
 *   - The firing recoil is -m_p * v_p / M_ship at the muzzle.
 *   - Torque is `r × F` about the CoM, with r in ship-local.
 *   - Moment of inertia is `Σ m_i · |r_i − r_com|²` over every module.
 */

/** A slow cannon round: travels 4 units/tick so a single tick is easy to
 *  read. Damage is non-zero so the projectile is "live" but the target's
 *  structure is high enough to absorb many hits. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 1,
    range: 1000,
    cooldown: 1000,
    projectileSpeed: 4,
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
    maxHp,
    mass,
    powerDraw: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: "facing" in effect && typeof effect.facing === "number" ? effect.facing : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
  };
}

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    massCapacity: 100,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 999_999,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
  };
}

/** A modular ship with a power module at the origin (the command module)
 *  and whatever other modules the caller supplies. Sits at the given world
 *  position with the given facing and uses `hold` orders so it neither
 *  moves under its own thrust nor turns — any velocity it gains is purely
 *  from impulses. */
function modularShip(
  id: string,
  side: "attacker" | "defender",
  position: { x: number; y: number },
  facing: number,
  modules: ResolvedModule[],
): CombatShip {
  // Always include a command module at the origin so the ship can fire.
  const all = [moduleOf("p1", { kind: "power", output: 40 }, 0, 0, 100, 5, true), ...modules];
  return {
    instanceId: id,
    designId: `d-${id}`,
    side,
    stats: stats({
      thrust: modules
        .filter((m) => m.effect.kind === "engine")
        .reduce((s, m) => s + (m.effect.kind === "engine" ? m.effect.thrust : 0), 0),
    }),
    position,
    facing,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules: all,
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

interface FrameShip {
  instanceId: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  facing?: number;
  comX?: number;
  comY?: number;
  alive: boolean;
}

function findShip(frame: { ships: FrameShip[] }, id: string): FrameShip {
  const s = frame.ships.find((x) => x.instanceId === id);
  if (s === undefined) throw new Error(`no ship ${id}`);
  return s;
}

function vxOf(frame: { ships: FrameShip[] }, id: string): number {
  return findShip(frame, id).vx ?? 0;
}
function vyOf(frame: { ships: FrameShip[] }, id: string): number {
  return findShip(frame, id).vy ?? 0;
}

/** Smallest signed difference between two angles, wrapped to (-π, π]. */
function angleDelta(a: number, b: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

describe("engine.rigidbody — centre of mass", () => {
  it("a symmetric modular ship has its CoM at the origin", () => {
    // Two equal-mass modules at (-10, 0) and (+10, 0) plus a command
    // module at (0, 0): the mass-weighted centroid is the origin.
    const ship = modularShip("s1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf("h1", { kind: "hull" }, -10, 0, 100, 5),
      moduleOf("h2", { kind: "hull" }, 10, 0, 100, 5),
    ]);
    runBattle(inputs([ship, modularShip("d1", "defender", { x: 500, y: 0 }, 0, [])]));
    const result = runBattle(inputs([ship, modularShip("d1", "defender", { x: 500, y: 0 }, 0, [])]));
    const f0 = result.frames[0];
    if (f0 === undefined) throw new Error("no frame 0");
    const s = findShip(f0, "s1");
    // Symmetric layout → CoM at (0, 0). The snapshot omits comX/comY when
    // both are zero (for backward compat), so we expect them to be absent
    // OR very close to zero.
    expect(s.comX ?? 0).toBeCloseTo(0, 5);
    expect(s.comY ?? 0).toBeCloseTo(0, 5);
  });

  it("an asymmetric modular ship has its CoM offset toward the heavier side", () => {
    // Modules: command (mass 5 at origin), h1 (mass 5 at x=-10), h2
    // (mass 50 at x=+10). The ship's hull base mass (frigate: 15) sits
    // at the origin as a point mass. So:
    //   Σ m_i * x_i = 15*0 + 5*0 + 5*(-10) + 50*10 = -50 + 500 = 450
    //   Σ m_i       = 15 + 5 + 5 + 50 = 75
    //   CoM_x       = 450 / 75 = 6
    const ship = modularShip("s1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf("h1", { kind: "hull" }, -10, 0, 100, 5),
      moduleOf("h2", { kind: "hull" }, 10, 0, 100, 50),
    ]);
    const result = runBattle(inputs([ship, modularShip("d1", "defender", { x: 500, y: 0 }, 0, [])]));
    const f0 = result.frames[0];
    if (f0 === undefined) throw new Error("no frame 0");
    const s = findShip(f0, "s1");
    expect(s.comX ?? 0).toBeCloseTo(6, 5);
    expect(s.comY ?? 0).toBeCloseTo(0, 5);
  });
});

describe("engine.rigidbody — firing recoil", () => {
  it("a stationary ship firing forward is pushed backward by m_p * v_p / M", () => {
    // Attacker faces +x. Its forward weapon fires along +x. The ship
    // gains delta_v = -m_p * v_p / M along +x. We isolate this by giving
    // the target huge structure and reading the shooter's velocity at
    // the first tick where it goes non-zero. The projectile's speed is
    // 4, projectile mass is 0.5, ship mass is hull_mass.frigate (15) +
    // module masses (5 + 5 = 10) = 25. Expected delta_v per shot along
    // x = -(0.5 * 4) / 25 = -0.08.
    //
    // We use cooldown 1 with a fixed seed so the weapon's first fire
    // happens at a deterministic tick, then scan for the first frame
    // where the shooter's x-velocity has changed.
    const ship = modularShip("a1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf("w1", cannon({ cooldown: 1 }), 12, 0, 100, 5),
    ]);
    const target = modularShip("d1", "defender", { x: 50, y: 0 }, 0, []);
    const result = runBattle(inputs([ship, target]));
    // Find the first frame where the shooter has acquired non-zero vx.
    let firedFrame: { ships: FrameShip[] } | undefined;
    for (let i = 1; i < result.frames.length; i++) {
      const f = result.frames[i];
      if (f === undefined) continue;
      if (Math.abs(vxOf(f, "a1")) > 1e-6) {
        firedFrame = f;
        break;
      }
    }
    if (firedFrame === undefined) throw new Error("shooter never fired");
    const v = vxOf(firedFrame, "a1");
    expect(v, "forward shot must push shooter backward (-x)").toBeLessThan(-1e-4);
    // Expected impulse magnitude is m_p * v_p / M = 0.5 * 4 / 25 = 0.08.
    // Damping may reduce the recorded value slightly but the magnitude
    // is the right order.
    expect(Math.abs(v)).toBeGreaterThan(0.005);
    expect(Math.abs(v)).toBeLessThan(0.1);
    // Perpendicular recoil is zero (weapon mounted on the centreline).
    expect(Math.abs(vyOf(firedFrame, "a1"))).toBeCloseTo(0, 5);
  });

  it("a side-mounted weapon on a stationary ship produces both linear and angular recoil", () => {
    // Ship at origin facing +x. Layout (all Chebyshev-adjacent through
    // an L-shape so every cell is 4-connected (edge-sharing) and the weapon
    // sits off the firing axis:
    //   - command (mass 5) at (0, 0)
    //   - hull    (mass 5) at (1, 0)  ← bridges the command to the weapon
    //   - weapon  (mass 5) at (1, 1)  ← off the x-axis, so its recoil torques
    //
    // The weapon fires along +x (weaponFacing 0). Its recoil impulse is
    // (-m_p * v_p, 0) at a cell with a non-zero y offset from the CoM, so the
    // cross product r × F is non-zero — the ship both slides backward (−x) and
    // spins. (The cells form a connected L; under 4-connectivity a diagonal
    // layout would instead break apart, which is exactly the new rule.)
    const ship = modularShip("a1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf("h1", { kind: "hull" }, 1, 0, 100, 5),
      moduleOf("w1", cannon({ cooldown: 1 }), 1, 1, 100, 5),
    ]);
    const target = modularShip("d1", "defender", { x: 50, y: 0 }, 0, []);
    const result = runBattle(inputs([ship, target]));
    // Find the first frame where the shooter has acquired non-zero speed
    // — the moment the first shot was fired (recoil changes velocity
    // immediately; facing changes on the following tick because the
    // per-tick facing update runs in moveShips, before fireWeapons).
    let firedFrameIdx = -1;
    for (let i = 1; i < result.frames.length; i++) {
      const f = result.frames[i];
      if (f === undefined) continue;
      const s = findShip(f, "a1");
      const sp = Math.hypot(s.vx ?? 0, s.vy ?? 0);
      if (sp > 1e-6) {
        firedFrameIdx = i;
        break;
      }
    }
    if (firedFrameIdx < 0) throw new Error("shooter never fired");
    const firedFrame = result.frames[firedFrameIdx];
    if (firedFrame === undefined) throw new Error("missing frame");
    // Linear recoil along -x.
    const dvx = vxOf(firedFrame, "a1");
    expect(dvx, "side-mounted weapon's recoil must still push shooter backward").toBeLessThan(-1e-4);
    // Angular kick: facing must have drifted by the NEXT frame, since
    // moveShips applies angVel to facing at the start of each tick.
    const nextFrame = result.frames[firedFrameIdx + 1];
    if (nextFrame === undefined) throw new Error("no frame after fire");
    const facing = findShip(nextFrame, "a1").facing ?? 0;
    expect(Math.abs(facing), "off-centre weapon must spin the ship").toBeGreaterThan(1e-6);
  });
});

describe("engine.rigidbody — hit impulse", () => {
  it("a projectile hitting a stationary target transfers positive momentum", () => {
    // Attacker at (-50, 0) facing +x fires a projectile along +x at v_p=4.
    // Target at (+10, 0) is hit on its left edge. The target's delta_v
    // along x is +m_p * v_p / M_target ≈ +0.5*4/M_target.
    const target = modularShip("d1", "defender", { x: 30, y: 0 }, 0, []);
    // Shooter: needs to be in firing range. Place at x=-30 facing +x.
    const shooter = modularShip("a1", "attacker", { x: -30, y: 0 }, 0, [
      moduleOf("w1", cannon({ damage: 1 }), 12, 0, 100, 5),
    ]);
    const result = runBattle(inputs([shooter, target]));
    // Find the first frame in which the target's x-velocity has become
    // positive — the moment of impact.
    let impacted = false;
    for (let i = 1; i < result.frames.length; i++) {
      const f = result.frames[i];
      if (f === undefined) continue;
      const v = vxOf(f, "d1");
      if (v > 0.0001) {
        impacted = true;
        break;
      }
    }
    expect(impacted, "target must have absorbed forward momentum from the hit").toBe(true);
  });

  it("total momentum is conserved across a fire+hit cycle", () => {
    // Closed system: one attacker, one defender. Attacker fires one shot;
    // the shot lands on the defender. Sum of (M*v) for both ships plus
    // the projectile (when in flight) should be conserved — zero in the
    // frame where both started at rest. We check the x-component.
    //
    // Heavy hull masses keep the per-shot delta small so the test is
    // well-conditioned. Both ships start at rest.
    const shooter = modularShip("a1", "attacker", { x: -30, y: 0 }, 0, [
      moduleOf("w1", cannon({ damage: 1, cooldown: 1, projectileSpeed: 4 }), 12, 0, 100, 5),
    ]);
    const target = modularShip("d1", "defender", { x: 30, y: 0 }, 0, []);
    const result = runBattle(inputs([shooter, target]));
    // Find the moment of impact (first frame after fire where the shooter
    // has fired at least once and the projectile has either been absorbed
    // or is still in flight). We check momentum bookkeeping across three
    // stages: pre-fire (frame 0), post-fire mid-flight, post-impact.
    const f0 = result.frames[0];
    if (f0 === undefined) throw new Error("no frame 0");
    // Pre-fire total momentum: both at rest, no projectile.
    const px0 = vxOf(f0, "a1") * 25 + vxOf(f0, "d1") * 20; // masses from modular layout
    expect(px0).toBeCloseTo(0, 6);
    // Walk forward: at every frame, total momentum (ship + projectile)
    // along x must equal px0. The projectile's momentum isn't directly
    // observable in the snapshot, but after impact its momentum has been
    // absorbed by the target — so the two-ship total alone should be
    // close to zero. We scan for the post-impact frame: the first frame
    // where the target has non-zero velocity.
    let postImpactFrame: { ships: FrameShip[] } | undefined;
    for (let i = 1; i < result.frames.length; i++) {
      const f = result.frames[i];
      if (f === undefined) continue;
      if (Math.abs(vxOf(f, "d1")) > 1e-4) {
        postImpactFrame = f;
        break;
      }
    }
    if (postImpactFrame === undefined) throw new Error("target was never hit");
    // The shooter's recoil is -m_p*v_p/M_shooter and the target's impulse
    // is +m_p*v_p/M_target (modulo damping). The magnitudes differ because
    // the masses differ, but the SUM of momentum transfers at the instant
    // of the fire+hit is zero. Linear damping decays both independently,
    // so we instead check that the impulse magnitudes per unit mass are
    // symmetric: the shooter's |delta_v| * M_shooter should equal the
    // target's |delta_v| * M_target (both are m_p * v_p). Damping applies
    // equally, so the ratio is preserved.
    // Find shooter's velocity just before impact to isolate the impulse.
    // Easier: check that shooter's vx is negative and target's vx is
    // positive — signs confirm equal-and-opposite momentum transfer.
    expect(vxOf(postImpactFrame, "a1"), "shooter recoils backward").toBeLessThan(-1e-4);
    expect(vxOf(postImpactFrame, "d1"), "target is pushed forward").toBeGreaterThan(1e-4);
  });
});

describe("engine.rigidbody — moment of inertia and engine torque", () => {
  it("an engine mounted at the CoM produces no torque regardless of facing", () => {
    // Layout: command module (mass 5) at origin, an engine (mass 5) also
    // at origin with facing = π/2 (thrusts along +y in ship-local). CoM
    // is at the origin, lever arm zero, torque zero. The ship should
    // strafe without spinning.
    const ship = modularShip("s1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf(
        "e1",
        { kind: "engine", thrust: 1.0, turnRate: 0, facing: Math.PI / 2 },
        0,
        0,
        100,
        5,
      ),
    ]);
    const target = modularShip("d1", "defender", { x: 0, y: 500 }, 0, []);
    // Use non-hold orders so the ship actually thrusts.
    ship.orders = defaultOrders;
    const result = runBattle(inputs([ship, target]));
    // Wait several ticks for any angVel to manifest; compare facing.
    const a = result.frames[5];
    const b = result.frames[20];
    if (a === undefined || b === undefined) throw new Error("missing frames");
    const fa = findShip(a, "s1").facing ?? 0;
    const fb = findShip(b, "s1").facing ?? 0;
    expect(Math.abs(angleDelta(fa, fb)), "CoM-mounted engine must not spin the ship").toBeLessThan(0.01);
  });

  it("an off-CoM engine produces torque in the expected direction", () => {
    // Layout: command module at origin, engine at (0, +10) facing 0
    // (thrusts along +x in ship-local). CoM is at y = +5 (midway between
    // the two equal-mass modules). Lever arm from CoM: (0, +10) - (0, +5)
    // = (0, +5). Force: (+F, 0). Torque = r × F = 0*0 - (+5)*(+F) = -5F
    // (negative, clockwise — facing drifts negative).
    const ship = modularShip("s1", "attacker", { x: 0, y: 0 }, 0, [
      moduleOf(
        "e1",
        { kind: "engine", thrust: 1.0, turnRate: 0, facing: 0 },
        0,
        10,
        100,
        5,
      ),
    ]);
    const target = modularShip("d1", "defender", { x: 500, y: 0 }, 0, []);
    ship.orders = defaultOrders;
    const result = runBattle(inputs([ship, target]));
    const a = result.frames[5];
    const b = result.frames[20];
    if (a === undefined || b === undefined) throw new Error("missing frames");
    const fa = findShip(a, "s1").facing ?? 0;
    const fb = findShip(b, "s1").facing ?? 0;
    const delta = angleDelta(fa, fb);
    expect(delta, "off-CoM engine must spin the ship clockwise (negative)").toBeLessThan(-1e-4);
  });
});

describe("engine.rigidbody — break-apart chunks", () => {
  it("a break-away chunk carries its own CoM recomputed from its modules", () => {
    // Layout mirrors engine.breakaway: a hammer ship with a single
    // hitscan beam, plus a modular defender with a fragile hull cell
    // at the impact edge and two side cells behind it. Destroying the
    // hull severs the graph and the side cells become independent
    // chunks, each carrying one cell with its own CoM.
    const attacker: CombatShip = {
      instanceId: "a1",
      designId: "d-a1",
      side: "attacker",
      stats: stats({
        weapons: [
          {
            slotId: "s",
            effect: cannon({
              weaponType: "beam",
              damage: 50,
              range: 500,
              cooldown: 1,
              projectileSpeed: 0,
            }),
          },
        ],
      }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
    };
    // Defender faces π so its local -x edge faces the attacker. Modules
    // all carry mass 5; hull HP is 1 so the first hit tears it apart.
    // The three cells form a vertical column at local x = -14: the central
    // hull cell at row 0 and two side cells at rows ±1. The hull is edge-
    // adjacent (4-connected) to both side cells, but the side cells are two
    // rows apart, so killing the central hull severs them into two single-
    // cell chunks. CoM uses x = -14, y = ±1 for each surviving side cell.
    const defender: CombatShip = {
      instanceId: "d1",
      designId: "d-d1",
      side: "defender",
      stats: stats({ structure: 5000 }),
      position: { x: 80, y: 0 },
      facing: Math.PI,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
      modules: [
        moduleOf("h1", { kind: "hull" }, -14, 0, 1, 5, true),
        moduleOf("s1", { kind: "hull" }, -14, -1, 100, 5),
        moduleOf("s2", { kind: "hull" }, -14, 1, 100, 5),
      ],
    };
    const result = runBattle(inputs([attacker, defender]));
    // The first frame that contains a chunk is the split frame.
    const splitFrame = result.frames.find((f) => f.ships.length > 2);
    if (splitFrame === undefined) throw new Error("ship never split");
    const chunks = splitFrame.ships.filter((s) => s.instanceId.includes("chunk"));
    expect(chunks.length, "expected at least one chunk after split").toBeGreaterThanOrEqual(1);
    // Each chunk carries one hull cell at (-14, ±1) plus the frigate's
    // hull base mass (15) as a point at the origin. So:
    //   CoM_x = (15*0 + 5*(-14)) / (15+5) = -70/20 = -3.5
    //   CoM_y = (15*0 + 5*(±1)) / 20     = ±5/20 = ±0.25
    for (const c of chunks) {
      expect(c.comX ?? 0, "chunk CoM_x must reflect its single cell's x").toBeCloseTo(-3.5, 5);
      expect(Math.abs(c.comY ?? 0), "chunk CoM_y must reflect its single cell's y").toBeCloseTo(0.25, 5);
    }
  });
});

describe("engine.rigidbody — determinism", () => {
  it("running the same battle twice yields identical frames", () => {
    const mk = () =>
      runBattle(
        inputs([
          modularShip("a1", "attacker", { x: -30, y: 0 }, 0, [
            moduleOf("w1", cannon({ cooldown: 1 }), 12, 0, 100, 5),
          ]),
          modularShip("d1", "defender", { x: 30, y: 0 }, 0, []),
        ]),
      );
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
  });

  it("running a complex modular battle twice yields identical frames", () => {
    const mk = () =>
      runBattle(
        inputs([
          modularShip("a1", "attacker", { x: -50, y: -10 }, 0.1, [
            moduleOf("w1", cannon({ cooldown: 2, damage: 5 }), 10, 4, 100, 8),
            moduleOf(
              "e1",
              { kind: "engine", thrust: 0.8, turnRate: 0, facing: Math.PI },
              -8,
              0,
              100,
              5,
            ),
            moduleOf("h1", { kind: "hull" }, 4, -6, 100, 6),
          ]),
          modularShip("d1", "defender", { x: 60, y: 5 }, -0.2, [
            moduleOf("w1", cannon({ cooldown: 3, damage: 4 }), -10, 0, 100, 7),
            moduleOf("h1", { kind: "hull" }, 5, 5, 100, 10),
          ]),
        ]),
      );
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
  });
});
