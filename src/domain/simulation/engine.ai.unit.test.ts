import { describe, expect, it } from "vitest";
import {
  baseAiState,
  effectiveDoctrineAi,
  shipSelfSatisfied,
  type TriggerContext,
} from "./engine/ai";
import type {
  Condition,
  Doctrine,
  DoctrineAction,
  DoctrineRule,
  ModuleKind,
} from "@/schema/ai";

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  shieldFraction: 1,
  structureFraction: 1,
  targetRange: 400,
  targetClassification: "frigate",
  destroyedModuleKinds: new Set(),
  outclassed: false,
  ...over,
});

/** Build a doctrine with an explicit base stance and an ordered rule list. */
function doctrine(baseStance: DoctrineAction["stance"], rules: DoctrineRule[]): Doctrine {
  return { base: { stance: baseStance }, rules };
}

/** Build a unified rule: when `condition` holds, apply `then`. */
function rule(condition: Condition, then: DoctrineAction): DoctrineRule {
  return { condition, then };
}

describe("engine.ai", () => {
  it("shieldBelow / structureBelow fire on the fraction threshold", () => {
    expect(shipSelfSatisfied({ kind: "shieldBelow", fraction: 0.5 }, ctx({ shieldFraction: 0.3 }))).toBe(true);
    expect(shipSelfSatisfied({ kind: "shieldBelow", fraction: 0.5 }, ctx({ shieldFraction: 0.7 }))).toBe(false);
    expect(shipSelfSatisfied({ kind: "structureBelow", fraction: 0.25 }, ctx({ structureFraction: 0.1 }))).toBe(true);
  });

  it("targetInRange checks the [min, max] band, and is false with no target", () => {
    expect(shipSelfSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: 400 }))).toBe(true);
    expect(shipSelfSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: 50 }))).toBe(false);
    expect(shipSelfSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: undefined }))).toBe(false);
  });

  it("targetClass matches the target's classification", () => {
    expect(shipSelfSatisfied({ kind: "targetClass", classes: ["cruiser", "dreadnought"] }, ctx({ targetClassification: "cruiser" }))).toBe(true);
    expect(shipSelfSatisfied({ kind: "targetClass", classes: ["cruiser"] }, ctx({ targetClassification: "frigate" }))).toBe(false);
  });

  it("moduleDestroyed fires when a destroyed kind is present", () => {
    expect(shipSelfSatisfied({ kind: "moduleDestroyed", moduleKind: "weapon" }, ctx({ destroyedModuleKinds: new Set<ModuleKind>(["weapon"]) }))).toBe(true);
    expect(shipSelfSatisfied({ kind: "moduleDestroyed", moduleKind: "shield" }, ctx({ destroyedModuleKinds: new Set<ModuleKind>(["weapon"]) }))).toBe(false);
  });

  it("outclassed reflects the fleet-strength flag", () => {
    expect(shipSelfSatisfied({ kind: "outclassed" }, ctx({ outclassed: true }))).toBe(true);
    expect(shipSelfSatisfied({ kind: "outclassed" }, ctx({ outclassed: false }))).toBe(false);
  });

  it("returns undefined for non-ship-self conditions (formation/spatial/temporal)", () => {
    // Non-ship-self kinds are delegated to the formation-doctrine pass; the
    // pure ship-self evaluator returns undefined so the caller can dispatch.
    expect(shipSelfSatisfied({ kind: "tickAfter", tick: 10 }, ctx())).toBeUndefined();
    expect(
      shipSelfSatisfied({ kind: "all", of: [{ kind: "outclassed" }] }, ctx()),
    ).toBeUndefined();
  });

  it("first matching rule wins; later rules do not stack", () => {
    const d = doctrine(undefined, [
      rule({ kind: "structureBelow", fraction: 0.5 }, { stance: "defensive" }),
      rule({ kind: "structureBelow", fraction: 0.9 }, { stance: "evasive" }),
    ]);
    // structure 0.3 matches BOTH (0.5 and 0.9); the first wins -> defensive.
    expect(effectiveDoctrineAi(d, ctx({ structureFraction: 0.3 })).stance).toBe("defensive");
  });

  it("no matching rule leaves the base stance and no flags", () => {
    const d = doctrine("aggressive", [
      rule({ kind: "shieldBelow", fraction: 0.1 }, { fire: "holdFire" }),
    ]);
    const state = effectiveDoctrineAi(d, ctx({ shieldFraction: 0.9 }));
    expect(state.stance).toBe("aggressive");
    expect(state.holdFire).toBe(false);
    expect(baseAiState("balanced")).toEqual({ stance: "balanced", holdFire: false, focusFire: false, retreat: false, prioritiseRepair: false, rally: false });
  });

  it("doctrine axes map onto AiState flags; stance overrides the base", () => {
    // stance:"retreat" -> retreat flag.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [rule({ kind: "outclassed" }, { stance: "retreat" })]),
        ctx({ outclassed: true }),
      ).retreat,
    ).toBe(true);
    // fire:"holdFire" -> holdFire flag.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [rule({ kind: "outclassed" }, { fire: "holdFire" })]),
        ctx({ outclassed: true }),
      ).holdFire,
    ).toBe(true);
    // stance axis overrides the base stance.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [rule({ kind: "outclassed" }, { stance: "evasive" })]),
        ctx({ outclassed: true }),
      ).stance,
    ).toBe("evasive");
    // fire:"atWill" clears holdFire.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [rule({ kind: "outclassed" }, { fire: "atWill" })]),
        ctx({ outclassed: true }),
      ).holdFire,
    ).toBe(false);
    // targeting.focusFire -> focusFire flag.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [
          rule(
            { kind: "outclassed" },
            { targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: true } },
          ),
        ]),
        ctx({ outclassed: true }),
      ).focusFire,
    ).toBe(true);
    // crew:"damageControl" -> prioritiseRepair flag.
    expect(
      effectiveDoctrineAi(
        doctrine(undefined, [rule({ kind: "outclassed" }, { crew: "damageControl" })]),
        ctx({ outclassed: true }),
      ).prioritiseRepair,
    ).toBe(true);
  });

  it("is deterministic (pure functions)", () => {
    const d = doctrine(undefined, [
      rule(
        { kind: "shieldBelow", fraction: 0.5 },
        { targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: true } },
      ),
    ]);
    const c = ctx({ shieldFraction: 0.3 });
    expect(effectiveDoctrineAi(d, c)).toEqual(effectiveDoctrineAi(d, c));
  });
});
