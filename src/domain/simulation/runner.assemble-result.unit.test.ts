import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { assembleResult } from "@/domain/simulation/runner";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";
import type {
  BattleFrame,
  BattleResult,
  BattleResultSummary,
} from "@/schema/battle";
import type { ShipStats } from "@/domain/stats";

/**
 * Unit tests for {@link assembleResult}: the pure reassembly that stitches a
 * terminal {@link BattleResultSummary} (the worker's `result` message, minus
 * frames) back together with the frames accumulated from the worker's streamed
 * `frames` batches. The contract is byte-identical reconstruction — the
 * assembled `frames` must be exactly the accumulated array in tick order, and
 * the assembled result must equal the original `BattleResult` produced by
 * `runBattle` when the summary and frames are derived from it.
 */

function weapon(): WeaponEffect {
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
  };
}

function makeShip(id: string, side: "attacker" | "defender", x: number): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 100,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [{ slotId: `slot-${id}`, effect: weapon() }],
    compartments: 0,
    airtightCompartments: 0,
  };
  // Empty doctrine carries the legacy defaults: stance undefined falls back to
  // balanced, crew undefined to combat, targeting undefined to nearest — the
  // behaviour these fixtures previously got from spreading `defaultOrders`.
  const doctrine: Doctrine = { base: {}, rules: [] };
  return {
    instanceId: id,
    designId: `design-${id}`,
    faction: "Terran",
    side,
    stats,
    position: { x, y: 0 },
    facing: 0,
    doctrine,
    classification: "frigate",
  };
}

function fixedInputs(): BattleInputs {
  return {
    ships: [makeShip("a1", "attacker", -100), makeShip("d1", "defender", 100)],
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomalies: [],
    seed: 42,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

/** Split a full BattleResult into the (summary, frames) pair the worker posts. */
function splitResult(result: BattleResult): {
  summary: BattleResultSummary;
  frames: BattleFrame[];
} {
  const { frames, ...summary } = result;
  return { summary, frames };
}

describe("assembleResult", () => {
  it("reassembles a BattleResult byte-identical to runBattle's output", () => {
    const original = runBattle(fixedInputs());
    const { summary, frames } = splitResult(original);

    const assembled = assembleResult(summary, frames);

    // Deep equality on the whole result.
    expect(assembled).toStrictEqual(original);
    // Byte-identical frames assertion: the assembled frame array must equal
    // the input array in tick order, with no reordering, drop, or duplicate.
    // assembleResult spreads the input into a new array (it deliberately does
    // not alias the caller's array), so assert content equality, not identity.
    expect(assembled.frames).toStrictEqual(frames);
    expect(JSON.stringify(assembled.frames)).toBe(JSON.stringify(original.frames));
  });

  it("returns a frames array that equals the input array in tick order", () => {
    const original = runBattle(fixedInputs());
    const { summary, frames } = splitResult(original);

    const { frames: assembledFrames } = assembleResult(summary, frames);

    // Same length, same order, element-wise byte-identical.
    expect(assembledFrames.length).toBe(frames.length);
    // Walk the two arrays in lockstep with index guards so each access is
    // narrowed under noUncheckedIndexedAccess.
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const assembledFrame = assembledFrames[i];
      if (frame === undefined || assembledFrame === undefined) {
        throw new Error(`frame ${i} missing`);
      }
      expect(assembledFrame).toStrictEqual(frame);
      expect(assembledFrame.tick).toBe(frame.tick);
    }
    // Ticks strictly ascending — preserves the streamed timeline order.
    for (let i = 1; i < assembledFrames.length; i++) {
      const prev = assembledFrames[i - 1];
      const curr = assembledFrames[i];
      if (prev === undefined || curr === undefined) throw new Error("unreachable");
      expect(curr.tick).toBeGreaterThan(prev.tick);
    }
  });

  it("does not mutate the input frames array", () => {
    const original = runBattle(fixedInputs());
    const { summary, frames } = splitResult(original);
    const snapshot = [...frames];

    assembleResult(summary, frames);

    expect(frames).toStrictEqual(snapshot);
  });

  it("produces independent frame arrays across calls (no shared reference)", () => {
    const original = runBattle(fixedInputs());
    const { summary, frames } = splitResult(original);

    const a = assembleResult(summary, frames);
    const b = assembleResult(summary, frames);

    // The summary spread produces a new object each call, and the frames
    // spread inside assembleResult produces a new array each call — mutating
    // one result must not affect the other.
    expect(a).not.toBe(b);
    expect(a.frames).not.toBe(b.frames);
    expect(a.frames).toStrictEqual(b.frames);
  });

  it("reassembles correctly when frames arrive in multiple batches", () => {
    // Simulate the streamed-batch accumulation: the worker posts frames in
    // chunks, the runner appends each batch's frames to an accumulator, and
    // the terminal summary carries no frames. The assembled result must equal
    // the original regardless of how the frames were chunked.
    const original = runBattle(fixedInputs());
    const { summary, frames } = splitResult(original);

    // Pick a batch boundary in the middle of the timeline.
    const midpoint = Math.floor(frames.length / 2);
    const accumulated: BattleFrame[] = [];
    for (const frame of frames.slice(0, midpoint)) accumulated.push(frame);
    for (const frame of frames.slice(midpoint)) accumulated.push(frame);

    const assembled = assembleResult(summary, accumulated);

    expect(assembled).toStrictEqual(original);
  });
});
