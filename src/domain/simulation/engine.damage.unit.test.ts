import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { runBattle } from "@/domain/simulation/engine";
import { applyCollisionDamage } from "@/domain/simulation/engine/collision";
import type { ShipContact } from "@/domain/simulation/engine/collision";
import { resolveChainReactions } from "@/domain/simulation/engine/chain-reaction";
import { applyDamage } from "@/domain/simulation/engine/damage";
import { stepTechCooldowns } from "@/domain/simulation/engine/mines";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { SimShip } from "@/domain/simulation/engine/types";
import { mulberry32 } from "@/domain/simulation/rng";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip, ResolvedModule } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Phase 4 of the realism overhaul: explosive chain reactions (a reactor or
 * magazine going up shreds the cells around it, chaining into further volatile
 * cells) and kinetic ship-ship collision damage (a ram converts a fraction of
 * the collision's kinetic energy into structural damage on both ships).
 *
 * The chain-reaction tests drive `resolveChainReactions` directly on a built
 * ship so the blast geometry is observable without a whole battle; the kinetic
 * and determinism tests run full battles through `runBattle`.
 */

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

/** A module at integer cell coordinates; world position is the cell index scaled
 *  by CELL_SIZE so col/row (adjacency) and x/y (blast geometry) agree. */
function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxScaffoldHp: number,
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
    surface: "bare",
    edges: OPEN,
    maxSurfaceHp: 0,
    maxScaffoldHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
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
    compartments: 0,
    airtightCompartments: 0,
    ...over,
  };
}

function combatShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
  over: Partial<CombatShip> = {},
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "test",
    side,
    stats: stats(),
    position: { x: 0, y: 0 },
    facing: 0,
    orders: { ...defaultOrders, engageRange: "hold" },
    classification: "frigate",
    modules,
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
    ...over,
  };
}

/** Build a SimShip from modules, with no rng staggering (a fixed rng so the
 *  cooldown stagger is deterministic but irrelevant to these tests). */
function buildSim(id: string, modules: ResolvedModule[]): SimShip {
  return toSimShip(combatShip(id, "defender", modules), mulberry32(1));
}

function findModule(ship: SimShip, slotId: string) {
  const m = ship.modules?.find((x) => x.slotId === slotId);
  if (m === undefined) throw new Error(`no module ${slotId}`);
  return m;
}

describe("engine.damage — explosive chain reactions", () => {
  it("a destroyed reactor's blast damages adjacent cells", () => {
    // A central reactor with a high output (big blast) flanked by two ordinary
    // cells one grid step away (one cell in from the CELL_SIZE*2 blast radius).
    const ship = buildSim("s1", [
      moduleOf("p1", { kind: "power", output: 200_000 }, 0, 0, 50, 5, true),
      moduleOf("n1", { kind: "hull" }, 1, 0, 1000),
      moduleOf("n2", { kind: "hull" }, -1, 0, 1000),
    ]);
    const reactor = findModule(ship, "p1");
    const n1 = findModule(ship, "n1");
    const n2 = findModule(ship, "n2");
    const hpBefore = n1.hp;

    // Kill the reactor (as a weapon/mine/ram would have this tick).
    reactor.hp = 0;
    reactor.alive = false;

    resolveChainReactions(ship);

    // 200_000 * 0.001 = 200 J yield; at one cell (CELL_SIZE units) inside radius
    // CELL_SIZE*2 the linear falloff is 1 - 1/2 = 0.5, so each neighbour takes
    // 100 damage.
    expect(reactor.exploded).toBe(true);
    expect(n1.hp).toBeLessThan(hpBefore);
    expect(n2.hp).toBeLessThan(hpBefore);
    expect(n1.hp).toBeCloseTo(hpBefore - 100, 6);
    expect(n2.hp).toBeCloseTo(hpBefore - 100, 6);
  });

  it("a destroyed magazine's blast damages adjacent cells", () => {
    const ship = buildSim("s2", [
      moduleOf("m1", { kind: "magazine", ammoStored: 10 }, 0, 0, 50, 5, true),
      moduleOf("n1", { kind: "hull" }, 1, 0, 1000),
    ]);
    const mag = findModule(ship, "m1");
    const n1 = findModule(ship, "n1");
    const hpBefore = n1.hp;

    mag.hp = 0;
    mag.alive = false;

    resolveChainReactions(ship);

    // 10 rounds * 500 = 5000 J yield; falloff 0.5 at one cell → 2500 damage,
    // far past the neighbour's 1000 HP, so it is destroyed.
    expect(mag.exploded).toBe(true);
    expect(n1.hp).toBeLessThan(hpBefore);
    expect(n1.alive).toBe(false);
  });

  it("a blast that destroys a second volatile module chains into it", () => {
    // Two magazines side by side. Destroying the first must set off the second
    // (the blast overkills it), and the second's own blast must then reach the
    // far neighbour beyond the first magazine's range.
    const ship = buildSim("s3", [
      moduleOf("m1", { kind: "magazine", ammoStored: 10 }, 0, 0, 50, 5, true),
      moduleOf("m2", { kind: "magazine", ammoStored: 10 }, 1, 0, 20),
      // One cell beyond m2 (two cells from m1, distance CELL_SIZE*2 = the blast
      // radius, so m1's blast alone cannot reach it — only m2's chained blast
      // can).
      moduleOf("n1", { kind: "hull" }, 2, 0, 500),
    ]);
    const m1 = findModule(ship, "m1");
    const m2 = findModule(ship, "m2");
    const n1 = findModule(ship, "n1");

    m1.hp = 0;
    m1.alive = false;

    resolveChainReactions(ship);

    expect(m1.exploded).toBe(true);
    // The second magazine was destroyed by the first's blast and then detonated.
    expect(m2.alive).toBe(false);
    expect(m2.exploded).toBe(true);
    // The far cell sits at m1's radius edge (no damage from m1) but one cell
    // from m2, so only the chained second blast could have hurt it.
    expect(n1.hp).toBeLessThan(n1.maxHp);
  });

  it("does nothing when no volatile module has died", () => {
    const ship = buildSim("s4", [
      moduleOf("p1", { kind: "power", output: 200_000 }, 0, 0, 50, 5, true),
      moduleOf("n1", { kind: "hull" }, 1, 0, 1000),
    ]);
    const n1 = findModule(ship, "n1");
    const hpBefore = n1.hp;
    // No module killed — the reactor is alive.
    resolveChainReactions(ship);
    expect(n1.hp).toBe(hpBefore);
    expect(findModule(ship, "p1").exploded).toBe(false);
  });

  it("each volatile module detonates only once across repeated calls", () => {
    const ship = buildSim("s5", [
      moduleOf("p1", { kind: "power", output: 200_000 }, 0, 0, 50, 5, true),
      moduleOf("n1", { kind: "hull" }, 1, 0, 1000),
    ]);
    const reactor = findModule(ship, "p1");
    const n1 = findModule(ship, "n1");
    reactor.hp = 0;
    reactor.alive = false;
    resolveChainReactions(ship);
    const hpAfterFirst = n1.hp;
    // A second drain on the same already-spent reactor must add no further
    // damage — the `exploded` guard prevents a re-detonation.
    resolveChainReactions(ship);
    expect(n1.hp).toBe(hpAfterFirst);
  });
});

/** A modular ship of a command cell plus a forward engine and a token
 *  short-range weapon, so under "short"/aggressive orders it closes to
 *  point-blank and rams its target. The weapon does no damage; it only pulls
 *  the desired range in so the ships collide. Modules have modest HP so the
 *  kinetic ram visibly chews them. */
function rammer(
  id: string,
  side: "attacker" | "defender",
  position: { x: number; y: number },
  facing: number,
): CombatShip {
  return combatShip(
    id,
    side,
    [
      moduleOf("c1", { kind: "power", output: 40 }, 0, 0, 5_000, 5, true),
      moduleOf("e1", { kind: "engine", thrust: 1, facing: Math.PI }, 1, 0, 5_000),
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
        5_000,
      ),
    ],
    {
      stats: stats({ thrust: 1 }),
      position,
      facing,
      orders: { ...defaultOrders, engageRange: "short", stance: "aggressive" },
    },
  );
}

function inputs(ships: CombatShip[], seed = 7): BattleInputs {
  return {
    ships,
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomaly: "none",
    seed,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.damage — kinetic collision damage", () => {
  it("a head-on collision damages both ships in proportion to closing energy", () => {
    // Two equal-mass ships ram head-on. Both must lose module HP from the
    // kinetic impact — Newton's third law: the rammer and the rammed both suffer.
    const a = rammer("a1", "attacker", { x: -60, y: 0 }, 0);
    const b = rammer("b1", "defender", { x: 60, y: 0 }, Math.PI);
    const result = runBattle(inputs([a, b]));

    const totalModuleHp = (frame: (typeof result.frames)[number], id: string): number => {
      const ship = frame.ships.find((s) => s.instanceId === id);
      return (ship?.cells ?? []).reduce((sum, m) => sum + m.hp, 0);
    };
    const first = result.frames[0];
    const last = result.frames.at(-1);
    if (first === undefined || last === undefined) throw new Error("no frames");

    // Both ships' aggregate module HP must have dropped: the only damage in this
    // battle is the kinetic collision (the weapon deals zero), so any HP loss is
    // the ram.
    expect(totalModuleHp(last, "a1")).toBeLessThan(totalModuleHp(first, "a1"));
    expect(totalModuleHp(last, "b1")).toBeLessThan(totalModuleHp(first, "b1"));
  });

  it("collision damage scales with kinetic energy (KE ∝ v_rel²)", () => {
    // Two equal-mass ships, one stationary, the other approaching head-on. Run
    // `applyCollisionDamage` directly on a hand-built contact so the relative
    // speed is exact and observable. Damage = 0.5 * m_r * v_rel² * fraction,
    // split inversely to mass; with equal masses each ship takes half. Doubling
    // the relative speed must quadruple the damage.
    const damageForSpeed = (speed: number): number => {
      const a = buildSim("ka", [
        moduleOf("a0", { kind: "hull" }, 0, 0, 1_000_000, 5, true),
      ]);
      const b = buildSim("kb", [
        moduleOf("b0", { kind: "hull" }, 0, 0, 1_000_000, 5, true),
      ]);
      // b approaches a along +x at `speed` (a is stationary). The contact stores
      // the pre-impulse relative velocity of b w.r.t. a directly.
      b.velX = -speed; // b moving toward a (which is to its left)
      const aHp0 = findModule(a, "a0").hp;
      const contact: ShipContact = {
        a,
        b,
        px: (a.x + b.x) / 2,
        py: 0,
        nx: 1,
        ny: 0,
        depth: 1,
        relVx: b.velX - a.velX,
        relVy: b.velY - a.velY,
      };
      applyCollisionDamage([contact]);
      return aHp0 - findModule(a, "a0").hp;
    };
    const slow = damageForSpeed(2);
    const fast = damageForSpeed(4); // double the speed
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    // KE ∝ v², so quadrupling is expected when speed doubles.
    expect(fast).toBeCloseTo(slow * 4, 6);
  });

  it("collision damage splits inversely to mass (the lighter ship takes more)", () => {
    // A light ship rams a heavy one head-on. Both lose HP (Newton's third law),
    // but the lighter ship absorbs the larger share of the dissipated energy.
    const light = buildSim("light", [
      moduleOf("l0", { kind: "hull" }, 0, 0, 1_000_000, 5, true),
    ]);
    const heavy = buildSim("heavy", [
      moduleOf("h0", { kind: "hull" }, 0, 0, 1_000_000, 50, true),
      moduleOf("h1", { kind: "hull" }, 1, 0, 1_000_000, 50),
      moduleOf("h2", { kind: "hull" }, 2, 0, 1_000_000, 50),
    ]);
    light.velX = 5;
    const lightHp0 = findModule(light, "l0").hp;
    const heavyHp0 = findModule(heavy, "h0").hp;
    const contact: ShipContact = {
      a: light,
      b: heavy,
      px: 0,
      py: 0,
      nx: 1,
      ny: 0,
      depth: 1,
      relVx: heavy.velX - light.velX,
      relVy: heavy.velY - light.velY,
    };
    applyCollisionDamage([contact]);
    const lightLost = lightHp0 - findModule(light, "l0").hp;
    const heavyLost = heavyHp0 - findModule(heavy, "h0").hp;
    expect(lightLost).toBeGreaterThan(0);
    expect(heavyLost).toBeGreaterThan(0);
    expect(lightLost).toBeGreaterThan(heavyLost);
  });
});

describe("engine.damage — determinism", () => {
  it("a chain-reaction battle replays byte-identically", () => {
    // A modular target carrying a magazine and a reactor as its frontmost cells,
    // hammered point-blank by a legacy beam ship (hitscan, never misses) until a
    // volatile cell breaches and chains. Two identical runs must produce
    // byte-identical frames.
    const beam: WeaponEffect = {
      kind: "weapon",
      weaponType: "beam",
      damage: 30,
      range: 500,
      cooldown: 2,
      projectileSpeed: 0,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 1,
      spread: 0,
      facing: 0,
    };
    const attacker: CombatShip = {
      instanceId: "atk",
      designId: "d-atk",
      faction: "test",
      side: "attacker",
      stats: stats({ structure: 99_999, weapons: [{ slotId: "s", effect: beam }] }),
      position: { x: 0, y: 0 },
      facing: 0,
      orders: { ...defaultOrders, engageRange: "hold" },
      classification: "frigate",
      shipStance: "balanced",
      crewPriority: "combat",
      rules: [],
    };
    const target = combatShip(
      "tgt",
      "defender",
      [
        moduleOf("tc", { kind: "power", output: 100_000 }, 0, 0, 30, 5, true),
        moduleOf("tm", { kind: "magazine", ammoStored: 8 }, 1, 0, 30),
        moduleOf("ta", { kind: "hull" }, 0, 1, 80),
        moduleOf("tb", { kind: "hull" }, 1, 1, 80),
      ],
      {
        stats: stats({ structure: 4_000 }),
        position: { x: 80, y: 0 },
        facing: Math.PI,
      },
    );
    const mk = () => runBattle(inputs([attacker, target], 42));
    const a = mk();
    const b = mk();
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    // Sanity: a volatile cell really did breach and chain at some point — a
    // frame exists where the target lost a volatile module.
    const volatileSlots = new Set<string>();
    for (const c of a.descriptors?.find((d) => d.instanceId === "tgt")?.cells ?? []) {
      if (c.kind === "power" || c.kind === "magazine") volatileSlots.add(c.slotId);
    }
    const breached = a.frames.some((f) => {
      const t = f.ships.find((s) => s.instanceId === "tgt");
      return (t?.cells ?? []).some((m) => volatileSlots.has(m.slotId) && !m.alive);
    });
    expect(breached, "a reactor or magazine should breach during the battle").toBe(true);
  });

  it("a kinetic-ram battle replays byte-identically", { timeout: 30_000 }, () => {
    const a = rammer("a1", "attacker", { x: -60, y: 0 }, 0);
    const b = rammer("b1", "defender", { x: 60, y: 0 }, Math.PI);
    const mk = () => runBattle(inputs([a, b]));
    const first = mk();
    const second = mk();
    expect(second.frames).toEqual(first.frames);
    expect(second.winner).toBe(first.winner);
  });
});

describe("engine.damage — per-cell armour reduction and reactive plating", () => {
  /** A single high-HP armour cell with the given passive and reactive reduction,
   *  built as a one-cell ship so a hit lands on it directly. The cell is the
   *  bridge so the ship cannot lose its command and die mid-test. */
  function armourCell(over: {
    surfaceReduction?: number;
    reactiveReduction?: number;
    reactiveWindow?: number;
  }): SimShip {
    const base = moduleOf("c1", { kind: "hull" }, 0, 0, 1000, 5, true);
    const cell: ResolvedModule = {
      ...base,
      surface: "armor",
      maxSurfaceHp: 1000,
      surfaceReduction: over.surfaceReduction ?? 0,
      reactiveReduction: over.reactiveReduction ?? 0,
      reactiveWindow: over.reactiveWindow ?? 0,
    };
    return buildSim("armour", [cell]);
  }

  it("passive surface reduction absorbs its fraction of a hit", () => {
    const ship = armourCell({ surfaceReduction: 0.5 });
    const cell = findModule(ship, "c1");
    const before = cell.surfaceHp;
    // 100 damage at 0.5 reduction → 50 reaches the plate.
    applyDamage(ship, 100, 0, 0, ship.x, ship.y, 0);
    expect(cell.surfaceHp).toBeCloseTo(before - 50, 6);
  });

  it("a charged reactive plate stacks its bonus on the first hit, then spends its charge", () => {
    // Passive 0.5 + reactive 0.3 = 0.8 absorbed on the first hit; the plate then
    // recharges over 90 ticks. With reactiveCharge > 0 only the passive 0.5
    // applies, so the second (in-window) hit lands harder.
    const ship = armourCell({
      surfaceReduction: 0.5,
      reactiveReduction: 0.3,
      reactiveWindow: 90,
    });
    const cell = findModule(ship, "c1");
    expect(cell.reactiveCharge).toBe(0); // born ready

    const h0 = cell.surfaceHp;
    applyDamage(ship, 100, 0, 0, ship.x, ship.y, 0); // 100 * (1 - 0.8) = 20 lands
    expect(cell.surfaceHp).toBeCloseTo(h0 - 20, 6);
    expect(cell.reactiveCharge).toBe(90); // charge spent

    const h1 = cell.surfaceHp;
    applyDamage(ship, 100, 0, 0, ship.x, ship.y, 0); // reactive on cooldown → 100 * (1 - 0.5) = 50
    expect(cell.surfaceHp).toBeCloseTo(h1 - 50, 6);
  });

  it("the reactive plate recharges over its window and absorbs the extra fraction again", () => {
    const ship = armourCell({
      surfaceReduction: 0.5,
      reactiveReduction: 0.3,
      reactiveWindow: 3,
    });
    const cell = findModule(ship, "c1");
    applyDamage(ship, 100, 0, 0, ship.x, ship.y, 0);
    expect(cell.reactiveCharge).toBe(3);
    // Three ticks of recharge bring it back to ready (0).
    stepTechCooldowns(ship);
    stepTechCooldowns(ship);
    stepTechCooldowns(ship);
    expect(cell.reactiveCharge).toBe(0);

    const h = cell.surfaceHp;
    applyDamage(ship, 100, 0, 0, ship.x, ship.y, 0); // reactive ready again → 0.8 absorbed
    expect(cell.surfaceHp).toBeCloseTo(h - 20, 6);
  });

  it("armour-piercing scales the per-cell reduction down", () => {
    // Passive 0.5 at 0.5 armourPiercing → effective 0.25 absorbed, so 75 lands.
    const ship = armourCell({ surfaceReduction: 0.5 });
    const cell = findModule(ship, "c1");
    const before = cell.surfaceHp;
    applyDamage(ship, 100, 0, 0.5, ship.x, ship.y, 0);
    expect(cell.surfaceHp).toBeCloseTo(before - 75, 6);
  });
});
