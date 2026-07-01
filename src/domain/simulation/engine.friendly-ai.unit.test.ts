/**
 * Engine-level integration tests for the two player-authored friendly-awareness
 * doctrine conditions added in `src/schema/ai.ts` and evaluated in
 * `engine/formation-doctrine.ts`:
 *
 *  - `friendlyInLineOfFire` — paired with `then: { fire: "holdFire" }`, a ship
 *    whose firing line to its target crosses a friendly holds fire (no
 *    projectile spawned) for as long as the friendly is on the line; moving the
 *    friendly off the line restores fire.
 *  - `friendlyProximity` — paired with `then: { spatial: { ... evade ... } }`,
 *    a ship that has a friendly inside the threshold opens range from the
 *    friendly formation's centroid, so the two ships diverge.
 *
 * These complement the direct handler unit tests in
 * `engine/formation-doctrine.unit.test.ts` (which assert the condition fires and
 * writes `aiFire` / `aiSpatial` in isolation); here the assertion is the
 * end-to-end behaviour the player sees: a projectile stream and a movement
 * trajectory.
 */
import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { Doctrine, DoctrineRule, SpatialObjective } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";

import { modularShip, targetDummy } from "./engine.factions-tech-helpers";

/** A short-cooldown, slow-travelling cannon so distinct shots appear as
 *  distinct in-flight projectiles (one per cooldown cycle). Range 700 m so a
 *  shooter at 600 m reach the targetDummy without closing. */
function cannon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "cannon",
    damage: 20,
    range: 700,
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

// ---------------------------------------------------------------------------
// friendlyInLineOfFire — holdFire while a friendly blocks the firing line.
// ---------------------------------------------------------------------------

/** A three-ship battle: a shooter (`s`) on the attacker side, a defender
 *  targetDummy (`e`) it can hit, and an attacker targetDummy blocker (`b`) at a
 *  caller-chosen position. The shooter's doctrine holds fire whenever a friendly
 *  is on its line to the target.
 *
 *  The shooter needs engines to sustain fire across ticks (the weapon system is
 *  kept active as part of the powered drive loop — a thrust-0 hull fires once
 *  then goes silent), so it carries `thrust` and slowly closes on the target.
 *  Its facing (0) already bears on the +x target, so no turning is needed. The
 *  blocker is placed near the enemy so that it stays on the shooter→enemy line
 *  regardless of how far the shooter closes within the tick budget. The blocker
 *  and enemy are targetDummies — no weapons, no engines — so the shooter is the
 *  only possible source of projectiles, which is what the assertion keys on. */
function lineOfFireBattle(blockerX: number, blockerY: number): BattleInputs {
  const rule: DoctrineRule = {
    condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
    then: { fire: "holdFire" },
  };
  const shooter: CombatShip = {
    ...modularShip({
      id: "s",
      side: "attacker",
      x: -300,
      y: 0,
      facing: 0,
      thrust: 7200,
      turnRate: 0.05,
      weapons: [cannon()],
    }),
    doctrine: { base: {}, rules: [rule] },
  };
  // Blocker: same side as the shooter, so it is the friendly the condition
  // checks. A targetDummy stays alive on the board (its bridge is off-axis and
  // huge-HP) but contributes no weapons fire.
  const blocker = targetDummy({
    id: "b",
    side: "attacker",
    x: blockerX,
    y: blockerY,
    structure: 10000,
  });
  const enemy = targetDummy({
    id: "e",
    side: "defender",
    x: 300,
    y: 0,
    structure: 100000,
  });
  return {
    ships: [shooter, blocker, enemy],
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks: 40,
  };
}

/** The set of distinct projectile ids that ever appear in any frame — i.e. the
 *  count of shots the shooter actually spawned (a projectile persists across
 *  many frames as it travels, so this dedupes by id rather than summing per
 *  frame). */
function distinctProjectiles(result: ReturnType<typeof runBattle>): Set<string> {
  const ids = new Set<string>();
  for (const f of result.frames) {
    for (const p of f.projectiles) ids.add(p.id);
  }
  return ids;
}

describe("engine friendly-awareness AI — friendlyInLineOfFire", () => {
  it("holds fire while a friendly is on the firing line, fires when it clears", () => {
    // On-line: blocker at (0,0) is exactly on the segment shooter(-300,0) →
    // enemy(300,0): projection 300 ∈ (0,600), perpendicular 0, angular offset
    // 0° ≤ 5°. The condition fires every tick the shooter has a target.
    // On-line: blocker at (250, 0) sits on the shooter→enemy segment. It is
    // placed near the enemy so it stays between the pair however far the
    // shooter closes within the tick budget (the shooter starts at x=-300 and
    // reaches only ~-174 by tick 40, well short of x=250). Projection from the
    // shooter stays in (0, segLen) and the perpendicular offset is 0, so the
    // angular offset is 0° ≤ 5° — the condition fires every tick the shooter
    // has a target.
    const onLine = runBattle(lineOfFireBattle(250, 0));
    // Off-line: same x, lifted 3000 m off the x-axis. The angular offset from
    // the firing line is atan2(3000, 250) ≈ 85° ≫ 5°, so the condition never
    // fires and the shooter fires freely.
    const offLine = runBattle(lineOfFireBattle(250, 3000));

    const onLineShots = distinctProjectiles(onLine);
    const offLineShots = distinctProjectiles(offLine);

    // Positive control: with the line clear, the shooter does fire (otherwise
    // the on-line result could be vacuously empty).
    expect(offLineShots.size).toBeGreaterThan(0);

    // The rule suppresses sustained fire: while a friendly blocks the line the
    // shooter spawns strictly fewer shots than with the line clear. The on-line
    // count is not strictly zero because formation-doctrine runs BEFORE the
    // targeting pass: on tick 1 the shooter acquires its target and fires
    // before the condition can first evaluate (it needs the target from the
    // prior tick); from tick 2 on, holdFire is in effect. So at most the single
    // tick-1 pre-acquisition shot leaks through — far below the clear-line
    // stream of roughly maxTicks / cooldown shots.
    expect(onLineShots.size).toBeLessThan(offLineShots.size);
    expect(onLineShots.size).toBeLessThanOrEqual(2);

    // Determinism: the suppression is reproducible run-to-run.
    expect(runBattle(lineOfFireBattle(250, 0)).frames).toEqual(onLine.frames);
  });
});

// ---------------------------------------------------------------------------
// friendlyProximity — evade divergence when a friendly is close.
// ---------------------------------------------------------------------------

/** A spatial objective that opens range from the reference (the ship's own
 *  friendly formation centroid when `reference` is `{ kind: "friendly", role }`)
 *  — the natural pairing for a `friendlyProximity within` trigger. */
function evadeFrom(reference: SpatialObjective["reference"], minRange: number): SpatialObjective {
  return {
    reference,
    range: { kind: "evade", minRange },
    bearing: { kind: "free" },
  };
}

/** A four-ship battle: two attacker wing-ships close together in formation
 *  `fw1`, a distant defender targetDummy so the battle runs past tick 1 (a
 *  one-side battle resolves immediately), and a doctrine on each wing. The
 *  wings' base spatial is `hold` relative to the distant target so they do not
 *  pursue it; only the rule's evade override moves them. */
function proximityBattle(direction: "within" | "beyond", separation: number): BattleInputs {
  const rule: DoctrineRule = {
    condition: { kind: "friendlyProximity", threshold: 250, direction },
    then: { spatial: evadeFrom({ kind: "friendly", role: "wing" }, 200) },
  };
  // `hold` engageRange compiles to a hold-range-to-target base spatial, so the
  // wings station-keep at their current (large) range from the distant dummy
  // instead of closing on it — keeping the only meaningful movement the rule's
  // evade override.
  const holdDoctrine: Doctrine = {
    base: {
      spatial: {
        reference: { kind: "target" },
        range: { kind: "hold", band: 0.3 },
        bearing: { kind: "free" },
      },
    },
    rules: [rule],
  };
  const wing = (id: string, x: number): CombatShip => ({
    ...modularShip({
      id,
      side: "attacker",
      x,
      y: 0,
      facing: 0,
      // 8 × TICKS_PER_SECOND² (900): movement divides by 900, so this is the
      // closing/evade acceleration that lets the wing actually open range on
      // the friendly centroid within the tick budget.
      thrust: 7200,
      turnRate: 0.05,
    }),
    formationId: "fw1",
    formationChain: ["fw1"],
    role: "wing",
    doctrine: holdDoctrine,
  });
  const half = separation / 2;
  const p1 = wing("p1", -half);
  const p2 = wing("p2", half);
  const enemy = targetDummy({
    id: "e",
    side: "defender",
    x: 5000,
    y: 0,
    structure: 100000,
  });
  return {
    ships: [p1, p2, enemy],
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1,
    maxTicks: 200,
  };
}

/** Distance between two ships in a frame, by instanceId. */
function separation(
  result: ReturnType<typeof runBattle>,
  tick: number,
  a: string,
  b: string,
): number {
  const frame = result.frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const sa = frame.ships.find((s) => s.instanceId === a);
  const sb = frame.ships.find((s) => s.instanceId === b);
  if (sa === undefined || sb === undefined) throw new Error("wing missing");
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
}

describe("engine friendly-awareness AI — friendlyProximity", () => {
  it("drives close friendlies apart when the rule fires (within)", () => {
    // The wings start 100 m apart — well outside the separation-steering contact
    // field (which scales with the pair's bounding-disc contact distance), so
    // the only force that can separate them here is the doctrine's evade
    // override. Threshold 250 m: at 100 m the `within` condition fires.
    const START = 100;
    const firing = runBattle(proximityBattle("within", START));
    // Same geometry, same evade spatial, but `direction: "beyond"`: at 100 m the
    // condition does NOT fire (100 m is not beyond 250 m), so no evade override
    // is written and the wings hold station on the distant dummy — separation
    // stays at its starting value. This isolates the divergence to the
    // `friendlyProximity within` condition.
    const inert = runBattle(proximityBattle("beyond", START));

    const startFiring = separation(firing, 1, "p1", "p2");
    const endFiring = separation(firing, firing.frames.length - 1, "p1", "p2");
    const endInert = separation(inert, inert.frames.length - 1, "p1", "p2");

    // Sanity: the battle actually ran enough ticks for the evade to act.
    expect(startFiring).toBeLessThanOrEqual(START + 1);
    // The firing rule separates the pair well beyond both their starting
    // separation and the inert (no-fire) run's final separation.
    expect(endFiring).toBeGreaterThan(endInert + 50);
    expect(endFiring).toBeGreaterThan(START + 50);
    // The inert run never fires the override, so the pair stays roughly put.
    expect(endInert).toBeLessThan(START + 30);

    // Determinism: the divergence is reproducible run-to-run.
    expect(runBattle(proximityBattle("within", START)).frames).toEqual(firing.frames);
  });
});
