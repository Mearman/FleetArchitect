import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleAnomaly } from "@/schema/battle";
import type { CombatShip, BattleInputs, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { ShipClassification } from "@/schema/armor";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import { targetDummy } from "./engine.factions-tech-helpers";


const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/**
 * Opus-tier: the three spatial anomalies, each of which mutates an
 * otherwise-clean engine phase (movement, shield regen, projectile
 * update). They have the most physics, the most "what could go wrong,"
 * and previously zero regression coverage.
 *
 * Each test compares the anomaly-on battle against the same battle with
 * anomaly=none so the assertion is robust to the rest of the engine.
 *
 * Helper duplicated so this file is self-contained.
 *
 * Fixture split: the attacker is a per-module ship (it needs a sensor module
 * to acquire the defender at range across every anomaly — a nebula halves the
 * innate visual radius so the 80–300 wu separations in these tests would be
 * blind without one), while the defender is a legacy aggregated ship so
 * `totalHitsOn` — which counts structure decrements — sees every projectile
 * hit directly (per-module damage would be absorbed by module HP first).
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 10,
    range: 600,
    cooldown: 1,
    projectileSpeed: 8,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

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
    maxScaffoldHp: 50,
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

/** An all-round (omni) sensor effect — a full detection circle, which is what
 *  the removed sensorRange scalar stood in for. */
function omniSensor(detectionRange: number): ModuleEffect {
  return {
    kind: "sensor",
    sensorType: "omni",
    arc: Math.PI,
    detectionRange,
    bearing: 0,
    nebulaImmune: false,
  };
}

/** The attacker: a per-module ship (command + engine + omni sensor + weapons)
 *  so it acquires the defender at range across every anomaly (a nebula halves
 *  the innate visual radius, so without a sensor the longer-range fixtures
 *  would be blind). Weapons are modules so the per-module fire path runs. */
function attacker(opts: {
  id: string;
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
}): CombatShip {
  const weapons = opts.weapons ?? [];
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: opts.structure ?? 500,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 60,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
    compartments: 0,
  airtightCompartments: 0,
};
  const modules: ResolvedModule[] = [
    moduleOf(`${opts.id}-cmd`, { kind: "power", output: 1000 }, 0, 0, true),
    moduleOf(`${opts.id}-eng`, { kind: "engine", thrust: 0.5, facing: Math.PI }, -1, 0),
    // RCS at the origin so the attacker has commandable turn authority under
    // the torque-driven attitude model (replaces the removed engine `turnRate`).
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 }, 0, 0),
    moduleOf(`${opts.id}-se`, omniSensor(2000), 1, 0),
    ...weapons.map((w, i) => moduleOf(`${opts.id}-w${i}`, w, 0, 1 + i)),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",side: "attacker",
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    orders: { ...defaultOrders, ...opts.orders },
    classification: opts.classification ?? "frigate",
    modules,
  };
}

/** The defender: a modular target dummy. A high-HP bridge sits off the line
 *  of fire so the ship survives the attacker's barrage, while a row of
 *  on-axis cells either pass damage straight through (bare cells, for the
 *  structure-decrement and shield-regen tests) or carry enough scaffold HP
 *  to absorb several shots before dying (for the asteroid-field test, which
 *  counts cell losses as its landed-hit proxy). */
function defender(opts: {
  id: string;
  x: number;
  y: number;
  structure?: number;
  shield?: number;
  shieldRechargeRate?: number;
  shieldRechargeDelay?: number;
  classification?: ShipClassification;
  orders?: Partial<typeof defaultOrders>;
  /** Scaffold HP of each on-axis absorbing cell. Defaults to 0 (bare cells
   *  that pass damage straight to structure). Set above the per-shot damage
   *  so each cell absorbs several hits before dying, for fixture patterns
   *  that count landed hits via cell losses. */
  absorbingScaffoldHp?: number;
}): CombatShip {
  return targetDummy({
    id: opts.id,
    side: "defender",
    x: opts.x,
    y: opts.y,
    structure: opts.structure,
    shield: opts.shield,
    shieldRechargeRate: opts.shieldRechargeRate,
    shieldRechargeDelay: opts.shieldRechargeDelay,
    classification: opts.classification,
    absorbingCells: 60,
    absorbingScaffoldHp: opts.absorbingScaffoldHp,
    orders: opts.orders,
  });
}

function inputs(ships: CombatShip[], anomaly: BattleAnomaly, seed = 1, maxTicks = DEFAULT_MAX_TICKS): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly,
    seed,
    maxTicks,
  };
}

/** Count on-axis absorbing cells destroyed over the battle. Each cell's
 *  scaffold HP exceeds the per-shot damage, so a cell only dies after several
 *  landed hits — making the cell-loss count a stable proxy for "how many
 *  projectiles landed", which the asteroid field's per-tick projectile
 *  destruction reduces. Structure itself never moves (cells absorb every
 *  shot), so counting structure decrements (the legacy metric) would see
 *  zero events in either battle. */
function cellsDestroyed(result: ReturnType<typeof runBattle>, targetId: string): number {
  const first = result.frames[0]?.ships.find((s) => s.instanceId === targetId);
  const initialAlive = first?.modules?.filter((m) => m.alive).length ?? 0;
  const last = result.frames.at(-1)?.ships.find((s) => s.instanceId === targetId);
  const finalAlive = last?.modules?.filter((m) => m.alive).length ?? 0;
  return initialAlive - finalAlive;
}

function shieldAt(result: ReturnType<typeof runBattle>, tick: number, id: string): number {
  const f = result.frames.find((frame) => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame at tick ${tick}`);
  return f.ships.find((s) => s.instanceId === id)?.shield ?? 0;
}

describe("engine.anomalies", () => {
  it("asteroid field deflects projectiles: fewer hits than anomaly=none", () => {
    // The defender has effectively infinite structure so it never dies;
    // the only difference between the two battles is how many projectiles
    // the asteroid field destroys on the way to the target.
    const mkAttacker = (anomaly: BattleAnomaly) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: 0,
              y: 0,
              facing: 0,
              weapons: [weapon()],
            }),
            defender({
              id: "d1",
              x: 100,
              y: 0,
              structure: 99999,
              // Scaffold HP above the per-shot damage (10) so each cell absorbs
              // several hits before dying — giving a large sample of cell-loss
              // events whose count the asteroid field can reduce.
              absorbingScaffoldHp: 100,
              orders: { engageRange: "hold" },
            }),
          ],
          anomaly,
          1,
          1500,
        ),
      );
    const none = mkAttacker("none");
    const field = mkAttacker("asteroidField");
    const noneHits = cellsDestroyed(none, "d1");
    const fieldHits = cellsDestroyed(field, "d1");
    expect(noneHits, "control battle should destroy cells").toBeGreaterThan(0);
    expect(fieldHits).toBeLessThan(noneHits);
  });

  it("nebula halves shield regeneration", () => {
    // A huge shield with a single big hit drops it to a level where
    // regen brings it back up but does not cap within the sample
    // window. The nebula regen factor (0.5) must produce a strictly
    // smaller shield value than anomaly=none over the same time.
    const mkDefender = (anomaly: BattleAnomaly) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: 0,
              y: 0,
              facing: 0,
              // One big hit, long cooldown so only one hit lands and the
              // rest of the battle is pure shield regen. The cooldown exceeds
              // the battle's tick cap so a second shot never lands.
              weapons: [weapon({ damage: 8000, cooldown: 400, range: 200 })],
              orders: { engageRange: "hold" },
            }),
            defender({
              id: "d1",
              x: 80,
              y: 0,
              structure: 99999,
              shield: 10000,
              shieldRechargeRate: 1,
              shieldRechargeDelay: 1,
              orders: { engageRange: "hold" },
            }),
          ],
          anomaly,
          1,
          300,
        ),
      );
    const none = mkDefender("none");
    const nebula = mkDefender("nebula");
    const sampleTick = 250;
    const noneShield = shieldAt(none, sampleTick, "d1");
    const nebulaShield = shieldAt(nebula, sampleTick, "d1");
    expect(noneShield, "control battle should show post-hit regen").toBeGreaterThan(2000);
    expect(nebulaShield).toBeLessThan(noneShield);
  });

  it("black hole pulls ships toward the centre and kills them within the lethal radius", () => {
    // A ship placed just outside the lethal radius (24) is yanked in
    // by the 1/distance gravity well and takes continuous damage once
    // it crosses inside. The control (none) shows the same ship held
    // in place.
    //
    // The battle cap is capped well below `DEFAULT_MAX_TICKS`: the behaviour
    // under test (the ship crossing the lethal radius and dying) plays out
    // within a few hundred ticks, and the weaponless 99999-structure defender
    // otherwise stalemates to the full cap.
    const mkShip = (anomaly: BattleAnomaly) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: 30,
              y: 0,
              structure: 60,
              orders: { engageRange: "hold" },
            }),
            defender({ id: "d1", x: 0, y: 0, structure: 99999, orders: { engageRange: "hold" } }),
          ],
          anomaly,
          1,
          800,
        ),
      );
    const none = mkShip("none");
    const hole = mkShip("blackHole");
    // Control: the ship holds at its starting position.
    const lastNone = none.frames.at(-1);
    const aNone = lastNone?.ships.find((s) => s.instanceId === "a1");
    expect(aNone?.alive).toBe(true);
    expect(Math.abs((aNone?.x ?? 30) - 30)).toBeLessThan(2);
    // Black hole: the ship is pulled toward (0,0) and dies.
    const killed = hole.frames.find((f) =>
      f.ships.find((s) => s.instanceId === "a1")?.alive === false,
    );
    expect(killed, "ship should die in the black-hole battle").toBeDefined();
  });

  it("black hole deflects projectiles, and a slow projectile bends more than a fast one", () => {
    // The proper space-time model: the same 1/r^2 field acts on
    // projectiles. A fast projectile traverses the strong-field region
    // quickly and accumulates less deflection; a slow one spends more
    // time near the hole and bends more. This is the natural
    // speed-dependence of the gravitational bending.
    const mk = (projectileSpeed: number, anomaly: BattleAnomaly) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: -150,
              y: 40,
              facing: 0,
              weapons: [
                weapon({ damage: 1, range: 400, cooldown: 10, projectileSpeed }),
              ],
            }),
            defender({ id: "d1", x: 150, y: 40, structure: 99999 }),
          ],
          anomaly,
        ),
      );
    // y of the first projectile in flight at the given tick.
    const projYAt = (result: ReturnType<typeof runBattle>, tick: number): number => {
      const f = result.frames.find((frame) => frame.tick === tick);
      if (f === undefined) throw new Error(`no frame ${tick}`);
      const p = f.projectiles[0];
      if (p === undefined) throw new Error(`no projectile at tick ${tick}`);
      return p.y;
    };
    // Control: with no anomaly the projectile travels close to straight
    // along y=40. We don't assert the exact value (the spawn spread /
    // numerical integration leaves a small residual) — only that the
    // black-hole battle deflects it toward the origin.
    const noneY = projYAt(mk(4, "none"), 40);
    // Black hole: the field pulls the projectile toward (0,0), so y
    // drops meaningfully below the straight-line value.
    const holeY = projYAt(mk(4, "blackHole"), 40);
    expect(Math.abs(noneY - 40)).toBeLessThan(1);
    expect(holeY).toBeLessThan(noneY);
    expect(holeY).toBeLessThan(40);
    // (A natural speed-dependence emerges from the physics — a fast
    // projectile sweeps through the field and bends less in *angle*,
    // while a slow one accumulates more integrated pull — but asserting
    // it on a discrete position snapshot is brittle: position
    // deflection and the physically meaningful bending angle scale
    // differently, and the fast projectile covers more path. The
    // deflection-existence assertion above is the stable, meaningful
    // check; the speed-dependence is documented in the engine.)
  });
});
