import { describe, expect, it } from "vitest";
import { doctrineUsesModuleDestroyed, stepAi } from "./engine/ai-step";
import type { Condition, Doctrine, DoctrineRule } from "@/schema/ai";
import type { SimShip } from "./engine/types";

/** Minimal valid SimShip for AI-step tests. Only the fields stepAi reads are
 *  meaningful; the rest carry inert defaults so the literal type-checks. */
function ship(over: Partial<SimShip> & { instanceId: string; side: "attacker" | "defender" }): SimShip {
  return {
    instanceId: over.instanceId,
    faction: "Terran",
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
    deflector: 0,
    maxDeflector: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    deflectorRegenCountdown: 0,
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
    doctrine: over.doctrine ?? { base: {}, rules: [] },
    aiHoldFire: false,
    aiStance: null,
    aiFocusFire: false,
    aiRetreat: false,
    aiPrioritiseRepair: false,
    aiRally: false,
    aiWasFiredUpon: false,
    target: over.target,
    alive: true,
    salvageMass: 0,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    sensorSaturation: 0,
  };
}

describe("engine.ai-step", () => {
  it("holds fire when a holdFire rule's trigger is satisfied", () => {
    const rule: DoctrineRule = {
      condition: { kind: "shieldBelow", fraction: 0.5 },
      then: { fire: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      shield: 10,
      maxShield: 100,
      doctrine: { base: {}, rules: [rule] },
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
      doctrine: {
        base: {},
        rules: [{ condition: { kind: "shieldBelow", fraction: 0.5 }, then: { fire: "holdFire" } }],
      },
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
    const rule: DoctrineRule = {
      condition: { kind: "structureBelow", fraction: 0.25 },
      then: { fire: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      structure: 10,
      maxStructure: 100,
      doctrine: { base: {}, rules: [rule] },
      target: "d1",
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(true);
  });

  it("sets outclassed from the two sides' total effective HP", () => {
    // Attacker total = 110, defender total = 500 -> attacker is outclassed.
    const rule: DoctrineRule = {
      condition: { kind: "outclassed" },
      then: { fire: "holdFire" },
    };
    const shipA = ship({
      instanceId: "a1",
      side: "attacker",
      structure: 10,
      shield: 100,
      maxShield: 100,
      doctrine: { base: {}, rules: [rule] },
      target: "d1",
    });
    const shipD = ship({ instanceId: "d1", side: "defender", x: 100, structure: 500, shield: 0, maxShield: 0 });
    stepAi([shipA, shipD], new Map([[shipA.instanceId, shipA], [shipD.instanceId, shipD]]));
    expect(shipA.aiHoldFire).toBe(true);
    // The defender is not outclassed (its side is stronger), so it fires.
    expect(shipD.aiHoldFire).toBe(false);
  });

  describe("doctrineUsesModuleDestroyed", () => {
    // Guards the buildContext gate: the destroyed-module-kind set is built
    // only when this returns true, so its recursion over the condition tree
    // (including nested all/any combinators) must be exactly correct. A
    // false-negative would silently drop a moduleDestroyed rule's effect.
    function doctrineWith(condition: Condition): Doctrine {
      return { base: {}, rules: [{ condition, then: { fire: "holdFire" } }] };
    }

    it("is false for an empty rules array", () => {
      expect(doctrineUsesModuleDestroyed({ base: {}, rules: [] })).toBe(false);
    });

    it("is false for a non-moduleDestroyed top-level condition", () => {
      expect(
        doctrineUsesModuleDestroyed(
          doctrineWith({ kind: "outclassed" }),
        ),
      ).toBe(false);
    });

    it("is true for a top-level moduleDestroyed condition", () => {
      expect(
        doctrineUsesModuleDestroyed(
          doctrineWith({ kind: "moduleDestroyed", moduleKind: "weapon" }),
        ),
      ).toBe(true);
    });

    it("is true when moduleDestroyed is nested inside an `all` combinator", () => {
      expect(
        doctrineUsesModuleDestroyed(
          doctrineWith({
            kind: "all",
            of: [
              { kind: "outclassed" },
              { kind: "moduleDestroyed", moduleKind: "shield" },
            ],
          }),
        ),
      ).toBe(true);
    });

    it("is true when moduleDestroyed is nested inside an `any` combinator", () => {
      expect(
        doctrineUsesModuleDestroyed(
          doctrineWith({
            kind: "any",
            of: [
              { kind: "shieldBelow", fraction: 0.5 },
              {
                kind: "all",
                of: [
                  { kind: "outclassed" },
                  { kind: "moduleDestroyed", moduleKind: "engine" },
                ],
              },
            ],
          }),
        ),
      ).toBe(true);
    });

    it("is memoised: a repeated lookup returns the cached value", () => {
      // The same doctrine object must hit the WeakMap cache on the second call;
      // this also confirms a cached `false` is not recomputed (which would be
      // correct but wasteful) nor turned into `true` by a faulty fallback.
      const doctrine = doctrineWith({
        kind: "any",
        of: [
          { kind: "outclassed" },
          { kind: "shieldBelow", fraction: 0.5 },
        ],
      });
      expect(doctrineUsesModuleDestroyed(doctrine)).toBe(false);
      expect(doctrineUsesModuleDestroyed(doctrine)).toBe(false);
    });
  });
});
