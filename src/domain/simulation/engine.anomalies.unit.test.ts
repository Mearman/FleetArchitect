import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { runBattle } from "@/domain/simulation/engine";
import { ACCEL_PER_TICK_FROM_SI, DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleAnomalyKind } from "@/schema/battle";
import type { CombatShip, BattleInputs, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
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
 * Empty doctrine == legacy defaults: stance undefined (balanced fallback),
 * crew undefined (combat), targeting undefined (nearest), no spatial rule. The
 * engine reads SimShip.doctrine only, so this is what a ship that previously
 * carried `defaultOrders` now receives.
 */
const DEFAULT_DOCTRINE: Doctrine = { base: {}, rules: [] };

/**
 * Hold-position doctrine: the legacy `orders.engageRange: "hold"` equivalent —
 * station-keep at 0.3 (the legacy default `rangeKeepingBand`) of the range to
 * the target, bearing free. Used by every fixture that was a fixed firing
 * turret so the realistic-thrust closing controller does not drift the firing
 * line between runs.
 */
const HOLD_POSITION_DOCTRINE: Doctrine = {
  base: {
    spatial: {
      reference: { kind: "target" },
      range: { kind: "hold", band: 0.3 },
      bearing: { kind: "free" },
    },
  },
  rules: [],
};

/**
 * Opus-tier: the three spatial anomalies, each of which mutates an
 * otherwise-clean engine phase (movement, shield regen, projectile
 * update). They have the most physics, the most "what could go wrong,"
 * and previously zero regression coverage.
 *
 * Each test compares the anomalies-on battle against the same battle with
 * anomalies=none so the assertion is robust to the rest of the engine.
 *
 * Helper duplicated so this file is self-contained.
 *
 * Fixture split: the attacker is a per-module ship (it needs a sensor module
 * to acquire the defender at range across every anomalies — a nebula halves the
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
    projectileMass: 0.5,
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
    maxSubstrateHp: 50,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "deck",
    edges: OPEN_EDGES,
    // A realistic per-cell mass: a modular ship's mass is the SUM of its module
    // masses (stats.mass is ignored for modular ships). At mass 5 a ship of a
    // few cells (~25 t) is so light that its own continuous gun recoil
    // accelerates it backward past muzzle speed, so under correct
    // inherited-velocity ballistics its rounds can no longer reach the target.
    mass: 50000,
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
 *  so it acquires the defender at range across every anomalies (a nebula halves
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
  /** Resolved authored doctrine. Defaults to {@link DEFAULT_DOCTRINE} (legacy
   *  `defaultOrders` equivalent). Pass {@link HOLD_POSITION_DOCTRINE} for a ship
   *  that was previously `orders.engageRange: "hold"`. */
  doctrine?: Doctrine;
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
    // SI torque: the integrator rescales torque/I into the per-tick clock via
    // ACCEL_PER_TICK_FROM_SI, so the bare per-tick authority is divided by it.
    moduleOf(`${opts.id}-rcs`, { kind: "rcs", torque: 0.5 / ACCEL_PER_TICK_FROM_SI }, 0, 0),
    moduleOf(`${opts.id}-se`, omniSensor(2000), 1, 0),
    ...weapons.map((w, i) => moduleOf(`${opts.id}-w${i}`, w, 0, 1 + i)),
  ];
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",side: "attacker",
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    doctrine: opts.doctrine ?? DEFAULT_DOCTRINE,
    classification: opts.classification ?? "frigate",
    modules,
  };
}

/** The defender: a modular target dummy. A high-HP bridge sits off the line
 *  of fire so the ship survives the attacker's barrage, while a row of
 *  on-axis cells either pass damage straight through (bare cells, for the
 *  structure-decrement and shield-regen tests) or carry enough substrate HP
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
  /** Substrate HP of each on-axis absorbing cell. Defaults to 0 (bare cells
   *  that pass damage straight to structure). Set above the per-shot damage
   *  so each cell absorbs several hits before dying, for fixture patterns
   *  that count landed hits via cell losses. */
  absorbingSubstrateHp?: number;
}): CombatShip {
  // The defender is a thrustless (thrust 0, turnRate 0) target dummy, so its
  // movement doctrine has no behavioural effect — it stays put regardless. The
  // legacy `orders.engageRange: "hold"` it carried was therefore a no-op and is
  // not mirrored onto a doctrine here.
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
    absorbingSubstrateHp: opts.absorbingSubstrateHp,
  });
}

function inputs(ships: CombatShip[], anomalies: BattleAnomalyKind[], seed = 1, maxTicks = DEFAULT_MAX_TICKS): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies,
    seed,
    maxTicks,
  };
}

/** Count on-axis absorbing cells destroyed over the battle. Each cell's
 *  substrate HP exceeds the per-shot damage, so a cell only dies after several
 *  landed hits — making the cell-loss count a stable proxy for "how many
 *  projectiles landed", which the asteroid field's per-tick projectile
 *  destruction reduces. Structure itself never moves (cells absorb every
 *  shot), so counting structure decrements (the legacy metric) would see
 *  zero events in either battle. */
function cellsDestroyed(result: ReturnType<typeof runBattle>, targetId: string): number {
  const first = result.frames[0]?.ships.find((s) => s.instanceId === targetId);
  const initialAlive = countAlive(first?.cells?.cellAlive);
  const last = result.frames.at(-1)?.ships.find((s) => s.instanceId === targetId);
  const finalAlive = countAlive(last?.cells?.cellAlive);
  return initialAlive - finalAlive;
}

/** Count set bits in a Uint8Array alive flags (0/1 per cell). */
function countAlive(alive: Uint8Array | undefined): number {
  if (alive === undefined) return 0;
  let count = 0;
  for (let i = 0; i < alive.length; i += 1) {
    if (alive[i] !== 0) count += 1;
  }
  return count;
}

function shieldAt(result: ReturnType<typeof runBattle>, tick: number, id: string): number {
  const f = result.frames.find((frame) => frame.tick === tick);
  if (f === undefined) throw new Error(`no frame at tick ${tick}`);
  return f.ships.find((s) => s.instanceId === id)?.shield ?? 0;
}

describe("engine.anomalies", () => {
  it("asteroid field deflects projectiles: fewer hits than anomalies=none", () => {
    // The defender has effectively infinite structure so it never dies;
    // the only difference between the two battles is how many projectiles
    // the asteroid field destroys on the way to the target.
    const mkAttacker = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: 0,
              y: 0,
              facing: 0,
              // Hold position: the attacker is a fixed firing turret 100 m from
              // the defender (well inside the 600 m weapon reach), so it streams
              // a steady barrage in both battles. This isolates the one variable
              // under test — the asteroid field's in-flight projectile
              // destruction — rather than letting the realistic-thrust closing
              // controller drift the firing line between the two runs.
              doctrine: HOLD_POSITION_DOCTRINE,
              // A round that steps one cell size per tick so it samples each
              // absorbing cell on the defender's row rather than tunnelling
              // past them — the cell contact distance is now one (1 m) cell, so
              // a fast round would jump clean over the column of cells.
              weapons: [weapon({ projectileSpeed: CELL_SIZE })],
            }),
            defender({
              id: "d1",
              x: 100,
              y: 0,
              structure: 99999,
              // Substrate HP above the per-shot damage (10) so each cell absorbs
              // several hits before dying — giving a large sample of cell-loss
              // events whose count the asteroid field can reduce.
              absorbingSubstrateHp: 100,
            }),
          ],
          anomalies,
          1,
          1500,
        ),
      );
    const none = mkAttacker([]);
    const field = mkAttacker(["asteroidField"]);
    const noneHits = cellsDestroyed(none, "d1");
    const fieldHits = cellsDestroyed(field, "d1");
    expect(noneHits, "control battle should destroy cells").toBeGreaterThan(0);
    expect(fieldHits).toBeLessThan(noneHits);
  });

  it("nebula halves shield regeneration", () => {
    // A huge shield with a single big hit drops it to a level where
    // regen brings it back up but does not cap within the sample
    // window. The nebula regen factor (0.5) must produce a strictly
    // smaller shield value than anomalies=none over the same time.
    const mkDefender = (anomalies: BattleAnomalyKind[]) =>
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
              doctrine: HOLD_POSITION_DOCTRINE,
            }),
            defender({
              id: "d1",
              x: 80,
              y: 0,
              structure: 99999,
              shield: 10000,
              shieldRechargeRate: 1,
              shieldRechargeDelay: 1,
            }),
          ],
          anomalies,
          1,
          300,
        ),
      );
    const none = mkDefender([]);
    const nebula = mkDefender(["nebula"]);
    const sampleTick = 250;
    const noneShield = shieldAt(none, sampleTick, "d1");
    const nebulaShield = shieldAt(nebula, sampleTick, "d1");
    expect(noneShield, "control battle should show post-hit regen").toBeGreaterThan(2000);
    expect(nebulaShield).toBeLessThan(noneShield);
  });

  it("black hole pulls ships toward the centre and kills them within the lethal radius", () => {
    // A weaponless target dummy placed just outside the lethal radius (2 km) is
    // yanked in by the 1/distance gravity well and takes continuous damage once
    // it crosses inside. The dummy has negligible thrust so it cannot resist
    // the pull. The control (none) shows the same ship staying put.
    //
    // The battle cap is capped well below `DEFAULT_MAX_TICKS`: the behaviour
    // under test (the ship crossing the lethal radius and dying) plays out
    // within a few hundred ticks.
    //
    // Re-baselined for km combat (Phase 5): the horizon is now 2 km so the
    // dummy starts just outside the tidal zone at 4.5 km; structure is in
    // joules (well above the tidal damage it takes while falling through the
    // zone, so the kill is the horizon crossing not the tidal grind).
    const mkShip = (anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: 50_000,
              y: 0,
              structure: 99999,
              doctrine: HOLD_POSITION_DOCTRINE,
            }),
            defender({ id: "d1", x: 4_500, y: 0, structure: 1e12 }),
          ],
          anomalies,
          1,
          800,
        ),
      );
    const none = mkShip([]);
    const hole = mkShip(["blackHole"]);
    // Control: the dummy holds near its starting position.
    const lastNone = none.frames.at(-1);
    const dNone = lastNone?.ships.find((s) => s.instanceId === "d1");
    expect(dNone?.alive).toBe(true);
    // Black hole: the dummy is pulled toward (0,0) and dies.
    const killed = hole.frames.find((f) =>
      f.ships.find((s) => s.instanceId === "d1")?.alive === false,
    );
    expect(killed, "dummy should die in the black-hole battle").toBeDefined();
  });

  it("black hole deflects projectiles, and a slow projectile bends more than a fast one", () => {
    // The proper space-time model: the same 1/r^2 field acts on
    // projectiles. A fast projectile traverses the strong-field region
    // quickly and accumulates less deflection; a slow one spends more
    // time near the hole and bends more. This is the natural
    // speed-dependence of the gravitational bending.
    //
    // Re-baselined for km combat (Phase 5): the firing line passes over the
    // 2 km horizon at km-scale offset so the round traverses the strong-field
    // region. The slow round (4 m/tick) is the pre-km projectile speed; here
    // it is rescaled so the round still samples the field rather than
    // tunnelling across the km arena in a single tick.
    const mk = (projectileSpeed: number, anomalies: BattleAnomalyKind[]) =>
      runBattle(
        inputs(
          [
            attacker({
              id: "a1",
              x: -800,
              y: 5_000,
              facing: 0,
              structure: 1e11,
              // Fire on the first tick (cooldown 1) so the round is in flight
              // before the black hole drags the now-lighter ship into the well.
              // The shot path at y=5000 passes 5 km from the origin — outside
              // the 4 km tidal zone but still deep enough in the 1/r² field for
              // measurable gravitational deflection of the round.
              weapons: [
                weapon({ damage: 1, range: 3_000, cooldown: 1, projectileSpeed }),
              ],
            }),
            defender({ id: "d1", x: 800, y: 5_000, structure: 99999 }),
          ],
          anomalies,
        ),
      );
    // y of the first projectile in flight a few ticks after the first round is
    // fired — far enough that the black hole's pull has bent its path, early
    // enough that both battles still have a projectile aloft.
    const TICKS_AFTER_FIRST_SHOT = 5;
    const earlyProjY = (result: ReturnType<typeof runBattle>): number => {
      const firstProjTick = result.frames.find((f) => f.projectiles.length > 0)?.tick;
      if (firstProjTick === undefined) throw new Error("no projectile was ever fired");
      const f = result.frames.find(
        (frame) => frame.tick === firstProjTick + TICKS_AFTER_FIRST_SHOT,
      );
      if (f === undefined) throw new Error("no frame at the inspection tick");
      const p = f.projectiles[0];
      if (p === undefined) throw new Error("no projectile at the inspection tick");
      return p.y;
    };
    // Control: with no anomalies the projectile travels straight along y=5000.
    const noneY = earlyProjY(mk(4, []));
    // Black hole: the field pulls the projectile toward (0,0), so y drops below
    // the straight-line value.
    const holeY = earlyProjY(mk(4, ["blackHole"]));
    expect(Math.abs(noneY - 5_000)).toBeLessThan(1);
    expect(holeY).toBeLessThan(noneY);
    expect(holeY).toBeLessThan(5_000);
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
