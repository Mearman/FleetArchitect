import { describe, expect, it } from "vitest";
import { runBattleCached } from "@/domain/cache/run-battle-cached";
import { catalog } from "@/data/catalog";
import type { PointDefenseEffect, WeaponEffect, WeaponType } from "@/schema/module";
import type { CombatShip } from "@/domain/simulation/types";
import type { BattleResult } from "@/schema/battle";
import {
  inputs,
  modularShip,
  moduleOf,
  targetDummy,
} from "./engine.factions-tech-helpers";

/**
 * Projectile-weapons integration: missiles, torpedoes, and cannon (kinetic)
 * rounds fired from modular ships in live tick-loop battles. Asserts the
 * observable behaviour the engine produces — projectiles in flight, the right
 * kind carried, damage dealt, a declared winner, guided homing, and point-
 * defence interception — not merely "doesn't crash".
 *
 * The base {@link modularShip} helper already mounts a command bridge (required
 * for the per-module firing path), a bidirectional drive + reaction wheel
 * (manoeuvrability), and an omni sensor (target acquisition at any test range).
 * Each armed ship carries a small thrust so the engine cells bridge the weapon
 * cell at col -2 into the command component (without it the ship starts
 * fragmented and loses targeting on tick 1 — see engine.formation-verbs
 * integration test for the discovery). A hold order station-keeps at the
 * opening range so neither ship drifts into collision.
 *
 * The three weapon kinds cover the full powered×guided taxonomy:
 *  - cannon  — unpowered, unguided (a ballistic slug; the schema's "kinetic").
 *  - missile — powered + guided (homing, finite-burn motor).
 *  - torpedo — powered + guided (slower, heavier, shorter burn).
 *
 * The missile kind test uses the catalogue's real `mod-missile-rack` effect, so
 * the assertion exercises an authored weapon definition rather than a synthetic
 * fixture alone.
 */

const SEED = 42;
const MAX_TICKS = 100;
const ATTACKER_ID = "gunner";
const DUMMY_ID = "dummy";

// --- weapon-effect factories -------------------------------------------------

/** A kinetic cannon round: fast, unpowered, unguided, low tracking. */
function cannonEffect(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 40,
    range: 500,
    cooldown: 3,
    projectileSpeed: 20,
    projectileMass: 1,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0.2,
    spread: 0.02,
    facing: 0,
    ...over,
  };
}

/** A guided missile: powered + guided, moderate tracking, finite burn. */
function missileEffect(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "missile",
    damage: 80,
    range: 600,
    cooldown: 6,
    projectileSpeed: 8,
    projectileMass: 1,
    tracking: 2.5,
    shieldPiercing: 0.1,
    armourPiercing: 0.2,
    spread: 0.2,
    facing: 0,
    powered: true,
    guided: true,
    thrust: 50,
    burnTicks: 40,
    ...over,
  };
}

/** A heavy torpedo: slow, high-damage, short guided burn. */
function torpedoEffect(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "torpedo",
    damage: 150,
    range: 500,
    cooldown: 10,
    projectileSpeed: 5,
    projectileMass: 2,
    tracking: 1,
    shieldPiercing: 0.4,
    armourPiercing: 0.3,
    spread: 0.05,
    facing: 0,
    powered: true,
    guided: true,
    thrust: 30,
    burnTicks: 20,
    ...over,
  };
}

/** A short-range, fast-refire point-defence module. */
function pdEffect(over: Partial<PointDefenseEffect> = {}): PointDefenseEffect {
  return {
    kind: "pointDefense",
    damage: 10,
    range: 150,
    cooldown: 0,
    hitChance: 0.4,
    tracking: 0.2,
    ...over,
  };
}

// --- ship fixtures -----------------------------------------------------------

/** Armed modular attacker. Small thrust keeps the engine cells mounted (which
 *  bridge the weapon cell into the command component); hold order station-keeps
 *  at the opening range so the ship doesn't drift into collision. */
function buildAttacker(
  weapon: WeaponEffect,
  id: string = ATTACKER_ID,
  x: number = -50,
): CombatShip {
  return modularShip({
    id,
    side: "attacker",
    x,
    y: 0,
    facing: 0,
    structure: 1000,
    thrust: 0.5,
    turnRate: 0.02,
    weapons: [weapon],
    orders: { engageRange: "hold" },
  });
}

/** Stationary target dummy: on-axis hull cells pass damage straight through to
 *  structure, so each landed hit is observable as a structure decrement. */
function buildDummy(opts: {
  id?: string;
  x?: number;
  y?: number;
  structure?: number;
} = {}): CombatShip {
  return targetDummy({
    id: opts.id ?? DUMMY_ID,
    side: "defender",
    x: opts.x ?? 50,
    y: opts.y ?? 0,
    structure: opts.structure ?? 1000,
    absorbingCells: 10,
  });
}

// --- shared assertion: a projectile kind spawns, carries its kind, damages ---

/**
 * Run a {@link buildAttacker}+{@link buildDummy} battle with the given weapon
 * and assert the four properties the engine must produce for every projectile
 * kind: the battle completes with a valid winner, projectiles appear in flight,
 * the projectiles carry the expected kind, and the dummy takes damage.
 */
async function assertProjectileBattle(weapon: WeaponEffect, expectedKind: WeaponType): Promise<void> {
  const result = await runBattleCached(inputs([buildAttacker(weapon), buildDummy()], MAX_TICKS, SEED));

  // Completes with a declared winner (no crash, no hang).
  expect(result.frames.length, "battle should produce frames").toBeGreaterThan(0);
  expect(result.ticks, "battle should advance at least one tick").toBeGreaterThan(0);
  expect(["attacker", "defender", "draw"], "winner should be a declared side").toContain(
    result.winner,
  );

  // Projectiles appear in at least one frame.
  const hasProjectiles = result.frames.some((f) => f.projectiles.length > 0);
  expect(hasProjectiles, `${expectedKind} projectiles should appear in flight`).toBe(true);

  // The projectiles carry the right kind.
  const hasKind = result.frames.some((f) =>
    f.projectiles.some((p) => p.kind === expectedKind),
  );
  expect(hasKind, `some projectile should carry kind=${expectedKind}`).toBe(true);

  // Damage dealt: the dummy's shield or structure decreased from frame 0.
  const firstFrame = result.frames[0];
  if (firstFrame === undefined) throw new Error("battle produced no frames");
  const dummyStart = firstFrame.ships.find((s) => s.instanceId === DUMMY_ID);
  if (dummyStart === undefined) throw new Error("dummy missing from opening frame");
  const damaged = result.frames.some((f) => {
    const d = f.ships.find((s) => s.instanceId === DUMMY_ID);
    return d !== undefined && (d.shield < dummyStart.shield || d.structure < dummyStart.structure);
  });
  expect(damaged, "dummy should have taken shield or structure damage").toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("projectile weapons in live battles", () => {
  it("cannon (kinetic) rounds spawn, carry the cannon kind, and deal damage", async () => {
    await assertProjectileBattle(cannonEffect(), "cannon");
  });

  it("missiles (catalogue missile-rack) spawn, carry the missile kind, and deal damage", async () => {
    // Exercise a real authored weapon definition, not just a synthetic fixture.
    const rack = catalog().module("mod-missile-rack");
    expect(rack, "catalogue should define mod-missile-rack").toBeDefined();
    if (rack === undefined) return;
    expect(rack.effect.kind, "missile-rack effect should be a weapon").toBe("weapon");
    if (rack.effect.kind !== "weapon") return;
    await assertProjectileBattle(rack.effect, "missile");
  });

  it("torpedoes spawn, carry the torpedo kind, and deal damage", async () => {
    await assertProjectileBattle(torpedoEffect(), "torpedo");
  });

  it("a guided missile converges on its target (distance-to-target decreases to a hit)", async () => {
    // A guided missile with `tracking > 0` and `guided: true` runs the engine's
    // per-tick steer path (weapons.ts: `if (p.guided && p.tracking > 0)`),
    // curving its velocity toward the target's current position. We track one
    // projectile by its stable snapshot id and assert the distance-to-target
    // shrinks to a hit. The snapshot carries {id, x, y, kind} only, so we
    // follow the missile by id rather than reading a targetId from the frame.
    //
    // The target sits directly along the attacker's heading (both at y=0) so
    // the fixed-mount weapon can fire without depending on the ship's bearing
    // controller. `spread` injects a small angular error at spawn so a
    // guided round must actively correct during flight.
    const weapon = missileEffect({
      range: 700,
      projectileSpeed: 6,
      tracking: 2.5,
      spread: 0.2,
    });
    const result = await runBattleCached(
      inputs([buildAttacker(weapon), buildDummy({ structure: 2000 })], MAX_TICKS, SEED),
    );

    // Acquire the first missile id, then record its distance to the target
    // across every frame it remains alive in flight.
    let missileId: string | undefined;
    const distances: number[] = [];
    for (const frame of result.frames) {
      const target = frame.ships.find((s) => s.instanceId === DUMMY_ID);
      if (target === undefined) continue;
      if (missileId === undefined) {
        const m = frame.projectiles.find((p) => p.kind === "missile");
        if (m !== undefined) missileId = m.id;
      }
      if (missileId === undefined) continue;
      const p = frame.projectiles.find((pr) => pr.id === missileId);
      if (p === undefined) continue; // missile expired or struck this tick
      distances.push(Math.hypot(p.x - target.x, p.y - target.y));
    }

    expect(distances.length, "guided missile should be observed in flight").toBeGreaterThan(2);
    const first = distances[0];
    const last = distances[distances.length - 1];
    if (first === undefined || last === undefined) throw new Error("no distance samples");
    expect(last, "missile should converge (distance decreasing over flight)").toBeLessThan(first);
    const minDist = Math.min(...distances);
    expect(minDist, "missile should close to within striking distance").toBeLessThan(30);

    // The target should take damage — the missile connected.
    const startStruct = result.frames[0]?.ships.find((s) => s.instanceId === DUMMY_ID)?.structure;
    const endStruct = result.frames
      .at(-1)
      ?.ships.find((s) => s.instanceId === DUMMY_ID)?.structure;
    if (startStruct === undefined || endStruct === undefined) {
      throw new Error("dummy missing from first or last frame");
    }
    expect(endStruct, "target should take damage from the guided missile").toBeLessThan(startStruct);
  });

  it("point-defence shoots down incoming missiles before they reach the hull", async () => {
    // Two otherwise-identical defenders: one carries a PD module adjacent to
    // its bridge (staying 4-connected to the command component so it survives
    // break-apart), the other does not. The same attacker fires the same
    // missile stream at both. PD should intercept most missiles in flight, so
    // far fewer reach the defender and the PD-defended hull retains more
    // structure. This mirrors engine.pointdefense.unit.test.ts but drives the
    // fixtures through the shared modularShip/targetDummy helpers.
    const weapon = missileEffect({
      damage: 80,
      range: 500,
      cooldown: 8,
      projectileSpeed: 8,
      tracking: 1.5,
    });

    const buildPdDefender = (id: string, withPd: boolean): CombatShip => {
      const defender = targetDummy({
        id,
        side: "defender",
        x: 120,
        y: 0,
        structure: 5000,
        absorbingCells: 10,
      });
      if (defender.modules === undefined) {
        throw new Error("targetDummy returned no modules");
      }
      if (withPd) {
        // PD module at col -1, row 1: edge-adjacent to the bridge (0, 1), so it
        // shares the command component and never triggers a break-apart split.
        defender.modules.push(moduleOf(`${id}-pd`, pdEffect(), -1, 1, 50, 4, 0));
      }
      return defender;
    };

    const withPd = await runBattleCached(
      inputs([buildAttacker(weapon, "gunner-a"), buildPdDefender("def-pd", true)], 80, SEED),
    );
    const bare = await runBattleCached(
      inputs([buildAttacker(weapon, "gunner-b"), buildPdDefender("def-bare", false)], 80, SEED),
    );

    // Count frames where a missile reaches within striking distance of the
    // defender — each such frame is a missile PD failed to stop.
    const defenderX = 120;
    const hitRadius = 40;
    const breakthroughs = (result: BattleResult): number =>
      result.frames.filter((f) =>
        f.projectiles.some(
          (p) => p.kind === "missile" && Math.abs(p.x - defenderX) <= hitRadius,
        ),
      ).length;

    // Premise: without PD, a meaningful number of missiles reach the defender.
    const bareHits = breakthroughs(bare);
    expect(bareHits, "undefended defender should see missiles reach it").toBeGreaterThan(3);

    // With PD, far fewer missiles get through.
    const pdHits = breakthroughs(withPd);
    expect(pdHits, "PD should stop most missiles before they reach the hull").toBeLessThan(bareHits);

    // And the PD-defended hull retains more structure than the bare one.
    const pdStruct =
      withPd.frames.at(-1)?.ships.find((s) => s.instanceId === "def-pd")?.structure ?? 0;
    const bareStruct =
      bare.frames.at(-1)?.ships.find((s) => s.instanceId === "def-bare")?.structure ?? 0;
    expect(pdStruct, "PD-defended hull should retain more structure").toBeGreaterThan(bareStruct);
  });
});
