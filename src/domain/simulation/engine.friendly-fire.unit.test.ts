import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import type { WeaponEffect } from "@/schema/module";
import { inputs, modularShip, targetDummy } from "./engine.factions-tech-helpers";

/**
 * Friendly-fire prevention (battle-level).
 *
 * The engine blocks friendly fire through a side filter in the projectile's
 * spatial hit check: a round only strikes cells whose `ship.side` matches the
 * projectile's enemy side (weapons.ts — `c.ship.side === enemySide`). So a
 * projectile fired by an attacker flies through a same-side ship's cells
 * without affecting them and continues to the enemy beyond. This test pins
 * that invariant end-to-end: an attacker firing at a defender overflies a
 * same-side blocker sat on the line of fire and reaches the defender behind
 * it, while the blocker's structure stays byte-identical to its starting value.
 */

/** A cannon whose round reaches the defender behind the same-side blocker. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 50,
    range: 600,
    cooldown: 2,
    projectileSpeed: 12,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

/** Structure of a ship at a given tick; throws if the frame or ship is absent. */
function structureAt(
  result: ReturnType<typeof runBattle>,
  tick: number,
  id: string,
): number {
  const frame = result.frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const ship = frame.ships.find((s) => s.instanceId === id);
  if (ship === undefined) throw new Error(`ship ${id} missing from tick ${tick}`);
  return ship.structure;
}

describe("engine.friendly-fire — side-filtered projectile hits", () => {
  it("a projectile overflies a same-side ship and strikes the enemy behind it", () => {
    // Attacker A holds near the origin facing +x, where the sole enemy D lies.
    // It carries a small engine grid (a combat-ready modular ship needs drive
    // cells to fight) but no movement orders, so it applies no thrust of its own
    // and drifts only under weapon recoil — under a metre over the whole run —
    // keeping B on its line of fire. Same-side blocker B is placed on that line
    // at x=30 and the enemy defender D behind it at x=60, all on y=0 so B's
    // cells lie exactly on A's shot path. A acquires D (its only enemy) and
    // fires; the round is aimed at D and must pass through B's cells without
    // striking them (same side → skipped by the hit check) and reach D behind.
    const a = modularShip({
      id: "A",
      side: "attacker",
      x: 0,
      y: 0,
      facing: 0,
      thrust: 100,
      turnRate: 0,
      weapons: [cannon()],
    });
    const b = targetDummy({ id: "B", side: "attacker", x: 30, y: 0, structure: 100 });
    const d = targetDummy({ id: "D", side: "defender", x: 60, y: 0, structure: 100 });
    const result = runBattle(inputs([a, b, d], 100, 42));

    const bInitial = structureAt(result, 0, "B");
    const dInitial = structureAt(result, 0, "D");
    // Track the worst-case deviation of B's structure and the minimum of D's
    // across every frame each ship appears in, so the assertion holds whether
    // or not a destroyed ship is dropped from later frames.
    let bMaxDelta = 0;
    let dMin = dInitial;
    for (const f of result.frames) {
      for (const s of f.ships) {
        if (s.instanceId === "B") {
          const delta = Math.abs(s.structure - bInitial);
          if (delta > bMaxDelta) bMaxDelta = delta;
        } else if (s.instanceId === "D" && s.structure < dMin) {
          dMin = s.structure;
        }
      }
    }
    // B is same-side: the round overflies it, so its structure never moves.
    expect(bMaxDelta, "same-side blocker B must never take friendly fire").toBe(0);
    // D, behind B on the same axis, is struck by the overflying round.
    expect(dMin, "the round must overfly B and reach enemy D").toBeLessThan(dInitial);
  });
});
