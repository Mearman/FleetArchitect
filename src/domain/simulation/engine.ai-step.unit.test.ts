import { describe, expect, it } from "vitest";
import { stepAi } from "./engine/ai-step";
import type { Rule } from "@/schema/ai";
import type { SimShip } from "./engine/types";

/** Minimal valid SimShip for AI-step tests. Only the fields stepAi reads are
 *  meaningful; the rest carry inert defaults so the literal type-checks. */
function ship(over: Partial<SimShip> & { instanceId: string; side: "attacker" | "defender" }): SimShip {
  return {
    instanceId: over.instanceId,
    faction: "test",
    side: over.side,
    classification: "frigate",
    x: 0,
    y: 0,
    facing: 0,
    velX: 0,
    velY: 0,
    px: 0,
    py: 0,
    angVel: 0,
    dilationFactor: 1,
    structure: over.structure ?? 100,
    maxStructure: over.maxStructure ?? 100,
    shield: over.shield ?? 50,
    maxShield: over.maxShield ?? 50,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
    engineThrottle: 0,
    mass: 1,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: 1,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    orders: {
      stance: "balanced",
      targetPriority: "nearest",
      engageRange: "medium",
      retreatThreshold: 0,
      focusFire: false,
      vulnerableTargetWeight: 0,
      formationKeeping: 0,
      rangeKeepingBand: 0.3,
    },
    crewPriority: "combat",
    shipStance: over.shipStance ?? "balanced",
    rules: over.rules ?? [],
    aiHoldFire: false,
    aiStance: null,
    aiFocusFire: false,
    aiRetreat: false,
    aiPrioritiseRepair: false,
    aiRally: false,
    target: over.target,
    alive: true,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
  };
}

describe("engine.ai-step", () => {
  it("holds fire when a holdFire rule's trigger is satisfied", () => {
    const rule: Rule = {
      trigger: { kind: "shieldBelow", fraction: 0.5 },
      action: { kind: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      shield: 10,
      maxShield: 100,
      rules: [rule],
      target: "d1",
      x: 0,
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(true);
  });

  it("fires (holdFire=false) when no rule matches", () => {
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      shield: 80,
      maxShield: 100,
      rules: [{ trigger: { kind: "shieldBelow", fraction: 0.5 }, action: { kind: "holdFire" } }],
      target: "d1",
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(false);
  });

  it("fires with no rules (default stance)", () => {
    const shipA = ship({ instanceId: "a1", side: "attacker", target: "d1" });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(false);
  });

  it("derives structureFraction from effective structure HP", () => {
    // structureBelow 0.25 -> holdFire when structure is at 10% (10/100).
    const rule: Rule = {
      trigger: { kind: "structureBelow", fraction: 0.25 },
      action: { kind: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      structure: 10,
      maxStructure: 100,
      rules: [rule],
      target: "d1",
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(true);
  });

  it("sets outclassed from the two sides' total effective HP", () => {
    // Attacker total = 110, defender total = 500 -> attacker is outclassed.
    const rule: Rule = {
      trigger: { kind: "outclassed" },
      action: { kind: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      structure: 10,
      shield: 100,
      maxShield: 100,
      rules: [rule],
      target: "d1",
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100, structure: 500, shield: 0, maxShield: 0 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(true);
    // The defender is not outclassed (its side is stronger), so it fires.
    expect(shipD.aiHoldFire).toBe(false);
  });
});
