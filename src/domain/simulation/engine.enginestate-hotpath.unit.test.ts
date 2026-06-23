/**
 * EngineState hot-path guard (Part 2, Phase 6).
 *
 * `simulateBattle` was refactored to lift every mutable generator local —
 * `ships`, the per-side views, `byId`, the in-flight entity arrays
 * (projectiles / mines / pods / pulses / emissions / debris), every monotonic
 * `*Seq` id counter, the deployment reference, the tick count, and the outcome
 * fields — onto one explicit `EngineState` object the loop reads and writes.
 * That lift is purely structural: it must not perturb the simulation by a single
 * bit, because the checkpoint capture/restore phases that follow snapshot from
 * exactly this object and rely on a fresh, no-checkpoint run being identical to
 * the old behaviour.
 *
 * This test is the proof for that property on a representative multi-ship combat
 * battle: a run driven straight through `simulateBattle` (the generator the
 * worker streams from, and the capture/restore harness will hook) must produce
 * frames byte-identical to `runBattle(inputs)` (the direct entry point) — both
 * by deep structural equality (`toEqual`) AND by a SHA-256 over
 * `JSON.stringify(frames)`, so a divergence in any field, in any frame, in any
 * order fails loudly.
 *
 * The fixture is a synthetic four-ship engagement (two attackers, two
 * defenders) trading beam and cannon fire across the centreline: rounds fly
 * (populating the lifted projectile array), hits land, hulls die, and the
 * per-side ship lists are rebuilt as a side is whittled down — so the lifted
 * entity arrays, the per-side rebuild after a death, the id counters, and the
 * outcome fields are all exercised, not just the static opening frame. It uses
 * the legacy aggregated `CombatShip` form (stats.weapons, no per-cell modules)
 * precisely because that path reliably engages in a small synthetic scene and
 * is byte-reproducible; the heavy preset battles carry a documented pre-existing
 * base-engine non-determinism (see the engine.crew-perf header), so they cannot
 * back a byte-identity gate.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { runBattle, simulateBattle } from "@/domain/simulation/engine";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { BattleFrame } from "@/schema/battle";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import { defaultOrders } from "@/schema/fleet";

/** A hitscan beam: lands damage the instant a target is in arc and range, so
 *  hulls reliably die within the cap and the per-side rebuild on a death is
 *  exercised. */
const beam: WeaponEffect = {
  kind: "weapon",
  weaponType: "beam",
  damage: 5,
  range: 500,
  cooldown: 3,
  projectileSpeed: 0,
  projectileMass: 0,
  tracking: 0,
  shieldPiercing: 0,
  armourPiercing: 0,
  spread: 0,
};

/** A cannon: a real projectile (non-zero speed) so the lifted in-flight
 *  projectile array is genuinely populated each tick a round is airborne. */
const cannon: WeaponEffect = {
  kind: "weapon",
  weaponType: "cannon",
  damage: 3,
  range: 500,
  cooldown: 5,
  projectileSpeed: 30,
  projectileMass: 0.5,
  tracking: 0,
  shieldPiercing: 0,
  armourPiercing: 0,
  spread: 0,
};

/** A legacy aggregated combatant (no per-cell modules): the path the streaming
 *  byte-identity test already exercises, which reliably acquires and engages a
 *  near enemy in a small synthetic scene. */
function ship(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y: number;
}): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 50,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 60,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [
      { slotId: `${opts.id}-beam`, effect: beam },
      { slotId: `${opts.id}-cannon`, effect: cannon },
    ],
    compartments: 0,
    airtightCompartments: 0,
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "test",
    side: opts.side,
    stats,
    position: { x: opts.x, y: opts.y },
    facing: 0,
    orders: { ...defaultOrders },
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    classification: "frigate",
  };
}

/** Two attackers vs two defenders, ids spanning the sort order, opposed across
 *  the centreline well inside the innate visual radius (~140 m) so they acquire
 *  and trade fire from the opening ticks rather than drifting out of contact. */
function combatInputs(maxTicks: number): BattleInputs {
  return {
    ships: [
      ship({ id: "a-alpha", side: "attacker", x: -25, y: -10 }),
      ship({ id: "a-gamma", side: "attacker", x: -25, y: 10 }),
      ship({ id: "d-beta", side: "defender", x: 25, y: -10 }),
      ship({ id: "d-delta", side: "defender", x: 25, y: 10 }),
    ],
    attackerFleetId: "fa",
    defenderFleetId: "fd",
    anomalies: [],
    seed: 1234,
    maxTicks,
  };
}

/** Drive the generator straight through to collect its frame stream — the path
 *  the worker streams from and the checkpoint harness will hook. */
function framesFromGenerator(inputs: BattleInputs): BattleFrame[] {
  const frames: BattleFrame[] = [];
  const gen = simulateBattle(inputs);
  let step = gen.next();
  while (!step.done) {
    frames.push(step.value);
    step = gen.next();
  }
  return frames;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("EngineState refactor leaves the hot path unperturbed (Phase 6)", () => {
  it("a no-checkpoint generator run is byte-identical to runBattle on a multi-ship combat", () => {
    // A generous cap (the fixture decides well before this) bounds the run; at
    // 25 m separation the fleets are in contact from tick 0, trade fire, and a
    // side is eliminated within a few dozen ticks — so the lifted projectile
    // array and the per-side rebuild after a death are genuinely exercised, not
    // just the opening frame.
    const COMBAT_TICKS = 400;
    const direct = runBattle(combatInputs(COMBAT_TICKS));
    const streamed = framesFromGenerator(combatInputs(COMBAT_TICKS));

    // Deep structural equality over the whole frame stream.
    expect(streamed).toEqual(direct.frames);
    // And a content hash, so a single drifting bit anywhere fails loudly.
    expect(sha256(streamed)).toBe(sha256(direct.frames));

    // Sanity: the fixture really is a combat that progresses, not a static
    // opening frame — projectiles fly (the lifted in-flight array is populated)
    // and at least one hull dies (the per-side ship lists are rebuilt as a side
    // is whittled down). Asserted on the reference run; the equality above
    // carries the property to the streamed run.
    const first = direct.frames[0];
    const last = direct.frames.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) throw new Error("no frames");
    const startAlive = first.ships.filter((s) => s.alive).length;
    const finalAlive = last.ships.filter((s) => s.alive).length;
    expect(finalAlive).toBeLessThan(startAlive);
    const maxProjectiles = Math.max(...direct.frames.map((f) => f.projectiles.length));
    expect(maxProjectiles).toBeGreaterThan(0);
  });
});
