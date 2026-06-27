import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { sumCellHp } from "@/domain/simulation/test-cell-helpers";
import type { CombatShip, BattleInputs } from "@/domain/simulation/types";
import type { ShipClassification } from "@/schema/armor";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { Doctrine, DoctrineAction } from "@/schema/ai";

/**
 * Legacy `orders` shape this fixture previously accepted. The schema dropped
 * `orders`, but the test's intent is expressed in those terms (a retreat
 * threshold, a hold-range stance), so the helper keeps the old vocabulary and
 * compiles it to a doctrine `base` — mirroring `compileOrdersToBase` in
 * `schema/fleet-normalise.ts`. Only the axes the test exercises are carried;
 * everything else falls through to the empty-doctrine defaults (stance
 * undefined -> balanced fallback, crew undefined -> combat, targeting
 * undefined -> nearest).
 */
interface LegacyOrders {
  retreatThreshold?: number;
  engageRange?: "short" | "medium" | "long" | "hold";
  rangeKeepingBand?: number;
}

/** Legacy `defaultOrders` carry-over: the band a `hold`/engage range keeps. */
const DEFAULT_RANGE_KEEPING_BAND = 0.3;

const ENGAGE_FRACTION: Record<"short" | "medium" | "long", number> = {
  short: 0.3,
  medium: 0.55,
  long: 0.85,
};

/** Compile the subset of legacy `orders` this fixture uses to a doctrine base. */
function ordersToBase(orders: LegacyOrders): DoctrineAction {
  const base: DoctrineAction = {};
  if (typeof orders.retreatThreshold === "number") base.retreat = orders.retreatThreshold;
  if (typeof orders.engageRange === "string") {
    const band = orders.rangeKeepingBand ?? DEFAULT_RANGE_KEEPING_BAND;
    // Contextual typing against `base.spatial` narrows the discriminated range
    // literal without an assertion.
    if (orders.engageRange === "hold") {
      base.spatial = {
        reference: { kind: "target" },
        range: { kind: "hold", band },
        bearing: { kind: "free" },
      };
    } else {
      base.spatial = {
        reference: { kind: "target" },
        range: {
          kind: "engage",
          fraction: ENGAGE_FRACTION[orders.engageRange],
          tolerance: band,
        },
        bearing: { kind: "free" },
      };
    }
  }
  return base;
}

/**
 * Haiku-tier: a ship whose structure drops below its retreatThreshold must
 * stop firing (it is `isRetreating`). We let the defender damage the
 * attacker below the threshold, then assert the attacker emits no
 * projectiles from the tick it crosses the threshold onward.
 *
 * Helper duplicated so this file is self-contained.
 */

function weapon(over: Partial<WeaponEffect>): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
  facing?: number;
  structure?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  orders?: LegacyOrders;
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
    structure: opts.structure ?? 100,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: weapons.map((w) => ({ slotId: `slot-${opts.id}`, effect: w })),
    compartments: 0,
  airtightCompartments: 0,
};
  const doctrine: Doctrine = { base: ordersToBase(opts.orders ?? {}), rules: [] };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: opts.facing ?? 0,
    doctrine,
    classification: (opts.classification ?? "frigate"),
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

describe("engine.retreat-firing", () => {
  // SKIP — Pending Phase 4 (damage): same root cause as the movement-modes
  // retreat test — the modular model routes the defender's hitscan damage
  // through the attacker's module HP first, so hull structure never crosses
  // the retreat threshold while the attacker is alive and the retreat-fire
  // gate never trips. Re-enable once Phase 4's unified damage gives
  // structure-independent depletion (or the retreat condition reads module
  // loss).
  it("a ship damaged below its retreatThreshold fires no further projectiles", () => {
    // Attacker: low retreatThreshold, a cannon (visible projectiles).
    // Defender: holds position, hitscan with damage 60 — enough to drop the
    // attacker from 100 → 40 (below the 0.5 threshold) in a single hit.
    // The 130 wu separation sits inside the innate visual radius so both
    // sensorless legacy ships detect each other from tick 0 without a sensor
    // module — the test is about the retreat-fire gate, not detection.
    const result = runBattle(
      inputs([
        makeShip({
          id: "a1",
          side: "attacker",
          x: 0,
          y: 0,
          weapons: [weapon({ weaponType: "cannon", projectileSpeed: 8, damage: 5, cooldown: 30, range: 600 })],
          orders: { retreatThreshold: 0.5 },
        }),
        makeShip({
          id: "d1",
          side: "defender",
          x: 0,
          y: 130,
          structure: 99999,
          weapons: [weapon({ damage: 60, range: 500, cooldown: 5 })],
          orders: { engageRange: "hold" },
        }),
      ]),
    );

    // Find the first tick at which the attacker is alive and its effective HP
    // fraction (structure + module HP) drops below the 0.5 retreat threshold.
    // Find when the attacker's effective HP (structure + module HP) drops below
    // the retreat threshold. The baseline is the initial total HP (at tick 0
    // everything is undamaged, so that IS the max).
    const f0 = result.frames[0];
    const a0 = f0?.ships.find((s) => s.instanceId === "a1");
    const initialHp = (a0?.structure ?? 0) + sumCellHp(a0?.cells);
    let retreatTick: number | undefined;
    for (const frame of result.frames) {
      const ship = frame.ships.find((s) => s.instanceId === "a1");
      if (ship?.alive !== true) continue;
      const hp = ship.structure + sumCellHp(ship.cells);
      if (initialHp > 0 && hp / initialHp < 0.5) {
        retreatTick = frame.tick;
        break;
      }
    }
    expect(retreatTick, "attacker should be damaged below its retreat threshold").toBeDefined();
    if (retreatTick === undefined) return;

    // From the retreat tick onward, the attacker must not emit any
    // projectiles (the engine skips firing for retreating ships).
    const projectilesAfterRetreat = result.frames
      .filter((f) => f.tick >= retreatTick)
      .flatMap((f) => f.projectiles)
      .filter((p) => p.kind === "cannon");
    expect(projectilesAfterRetreat).toEqual([]);
  });
});
