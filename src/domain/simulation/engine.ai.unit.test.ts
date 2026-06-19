import { describe, expect, it } from "vitest";
import { baseAiState, effectiveAi, triggerSatisfied, type TriggerContext } from "./engine/ai";
import type { ModuleKind, Rule } from "@/schema/ai";

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  shieldFraction: 1,
  structureFraction: 1,
  targetRange: 400,
  targetClassification: "frigate",
  destroyedModuleKinds: new Set(),
  outclassed: false,
  ...over,
});

const rule = (trigger: Rule["trigger"], action: Rule["action"]): Rule => ({
  trigger,
  action,
});

describe("engine.ai", () => {
  it("shieldBelow / structureBelow fire on the fraction threshold", () => {
    expect(triggerSatisfied({ kind: "shieldBelow", fraction: 0.5 }, ctx({ shieldFraction: 0.3 }))).toBe(true);
    expect(triggerSatisfied({ kind: "shieldBelow", fraction: 0.5 }, ctx({ shieldFraction: 0.7 }))).toBe(false);
    expect(triggerSatisfied({ kind: "structureBelow", fraction: 0.25 }, ctx({ structureFraction: 0.1 }))).toBe(true);
  });

  it("targetInRange checks the [min, max] band, and is false with no target", () => {
    expect(triggerSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: 400 }))).toBe(true);
    expect(triggerSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: 50 }))).toBe(false);
    expect(triggerSatisfied({ kind: "targetInRange", min: 100, max: 500 }, ctx({ targetRange: undefined }))).toBe(false);
  });

  it("targetClass matches the target's classification", () => {
    expect(triggerSatisfied({ kind: "targetClass", classes: ["cruiser", "dreadnought"] }, ctx({ targetClassification: "cruiser" }))).toBe(true);
    expect(triggerSatisfied({ kind: "targetClass", classes: ["cruiser"] }, ctx({ targetClassification: "frigate" }))).toBe(false);
  });

  it("moduleDestroyed fires when a destroyed kind is present", () => {
    expect(triggerSatisfied({ kind: "moduleDestroyed", moduleKind: "weapon" }, ctx({ destroyedModuleKinds: new Set<ModuleKind>(["weapon"]) }))).toBe(true);
    expect(triggerSatisfied({ kind: "moduleDestroyed", moduleKind: "shield" }, ctx({ destroyedModuleKinds: new Set<ModuleKind>(["weapon"]) }))).toBe(false);
  });

  it("outclassed reflects the fleet-strength flag", () => {
    expect(triggerSatisfied({ kind: "outclassed" }, ctx({ outclassed: true }))).toBe(true);
    expect(triggerSatisfied({ kind: "outclassed" }, ctx({ outclassed: false }))).toBe(false);
  });

  it("first matching rule wins; later rules do not stack", () => {
    const rules: Rule[] = [
      rule({ kind: "structureBelow", fraction: 0.5 }, { kind: "setStance", stance: "defensive" }),
      rule({ kind: "structureBelow", fraction: 0.9 }, { kind: "setStance", stance: "evasive" }),
    ];
    // structure 0.3 matches BOTH (0.5 and 0.9); the first wins -> defensive.
    expect(effectiveAi("balanced", rules, ctx({ structureFraction: 0.3 })).stance).toBe("defensive");
  });

  it("no matching rule leaves the base stance and no flags", () => {
    const rules: Rule[] = [rule({ kind: "shieldBelow", fraction: 0.1 }, { kind: "holdFire" })];
    const state = effectiveAi("aggressive", rules, ctx({ shieldFraction: 0.9 }));
    expect(state.stance).toBe("aggressive");
    expect(state.holdFire).toBe(false);
    expect(baseAiState("balanced")).toEqual({ stance: "balanced", holdFire: false, focusFire: false, retreat: false, prioritiseRepair: false, rally: false });
  });

  it("flag actions set their flag; setStance overrides the stance", () => {
    expect(effectiveAi("balanced", [rule({ kind: "outclassed" }, { kind: "retreat" })], ctx({ outclassed: true })).retreat).toBe(true);
    expect(effectiveAi("balanced", [rule({ kind: "outclassed" }, { kind: "holdFire" })], ctx({ outclassed: true })).holdFire).toBe(true);
    expect(effectiveAi("balanced", [rule({ kind: "outclassed" }, { kind: "setStance", stance: "evasive" })], ctx({ outclassed: true })).stance).toBe("evasive");
    expect(effectiveAi("balanced", [rule({ kind: "outclassed" }, { kind: "fireAtWill" })], ctx({ outclassed: true })).holdFire).toBe(false);
  });

  it("is deterministic (pure functions)", () => {
    const rules: Rule[] = [rule({ kind: "shieldBelow", fraction: 0.5 }, { kind: "focusFire" })];
    const c = ctx({ shieldFraction: 0.3 });
    expect(effectiveAi("balanced", rules, c)).toEqual(effectiveAi("balanced", rules, c));
  });
});
