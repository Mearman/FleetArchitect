import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import {
  BattleAbortError,
  DirectBattleRunner,
  WorkerBattleRunner,
} from "@/domain/simulation/runner";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import { defaultOrders } from "@/schema/fleet";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { BattleFrame } from "@/schema/battle";

function weapon(): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
  };
}

function makeShip(id: string, side: "attacker" | "defender", x: number): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    massCapacity: 100,
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
  };
  return {
    instanceId: id,
    designId: `design-${id}`,
    faction: "test",
    side,
    stats,
    position: { x, y: 0 },
    facing: 0,
    orders: { ...defaultOrders },
    classification: "frigate",
  };
}

function fixedInputs(): BattleInputs {
  return {
    ships: [makeShip("a1", "attacker", -100), makeShip("d1", "defender", 100)],
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomaly: "none",
    seed: 42,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("DirectBattleRunner", () => {
  it("produces a BattleResult identical to calling runBattle directly for a fixed seed", async () => {
    const runner = new DirectBattleRunner();
    const viaRunner = await runner.run(fixedInputs());
    const viaEngine = runBattle(fixedInputs());

    expect(viaRunner.winner).toBe(viaEngine.winner);
    expect(viaRunner.ticks).toBe(viaEngine.ticks);
    expect(viaRunner.frames).toStrictEqual(viaEngine.frames);
  });

  it("rejects with BattleAbortError when the signal is already aborted", async () => {
    const runner = new DirectBattleRunner();
    const controller = new AbortController();
    controller.abort();
    await expect(runner.run(fixedInputs(), { signal: controller.signal })).rejects.toBeInstanceOf(
      BattleAbortError,
    );
  });

  it("invokes onFrames with all frames and the result is unchanged", async () => {
    const runner = new DirectBattleRunner();
    const inputs = fixedInputs();
    const capturedBatches: { frames: readonly BattleFrame[]; ticks: number }[] = [];

    const result = await runner.run(inputs, {
      onFrames: (frames, computedTicks) => {
        capturedBatches.push({ frames, ticks: computedTicks });
      },
    });

    // onFrames is called at least once on the direct (synchronous) path.
    expect(capturedBatches.length).toBeGreaterThan(0);

    // The frames handed to onFrames are exactly the frames in the resolved result.
    const allCaptured = capturedBatches.flatMap((b) => b.frames);
    expect(allCaptured).toStrictEqual(result.frames);

    // The resolved BattleResult is identical to what runBattle produces directly.
    const viaEngine = runBattle(inputs);
    expect(result.winner).toBe(viaEngine.winner);
    expect(result.ticks).toBe(viaEngine.ticks);
    expect(result.frames).toStrictEqual(viaEngine.frames);
  });
});

describe("WorkerBattleRunner", () => {
  it("is constructed with a worker factory without throwing", () => {
    expect(() => new WorkerBattleRunner(() => new Worker(""))).not.toThrow();
  });

  it("rejects with BattleAbortError when the signal is already aborted, without spawning a worker", async () => {
    let factoryCalled = false;
    const runner = new WorkerBattleRunner(() => {
      factoryCalled = true;
      return new Worker("");
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runner.run(fixedInputs(), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BattleAbortError);
    expect(factoryCalled).toBe(false);
  });
});
