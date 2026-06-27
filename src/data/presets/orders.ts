import type { Doctrine, ShipStance } from "@/schema/ai";

// Fleet doctrines — each a distinct doctrine the ships in a preset fleet share.
// These are the unified-doctrine equivalents of the former per-fleet `orders`
// (stance, targeting, engagement range, retreat, focus fire). `fraction` is the
// fraction of max weapon range the fleet engages at — mirrors SIM.rangeFraction
// (short 0.3 / medium 0.55 / long 0.85); restated here because presets are a
// schema-layer leaf that cannot import engine config.

type TargetPriority = "nearest" | "weakest" | "strongest" | "highestCost";
type EngageRange = "short" | "medium" | "long";

const ENGAGE_FRACTION: Record<EngageRange, number> = {
  short: 0.3,
  medium: 0.55,
  long: 0.85,
};

function fleetDoctrine(args: {
  stance: ShipStance;
  targetPriority: TargetPriority;
  engageRange: EngageRange;
  retreatThreshold: number;
  focusFire: boolean;
  rangeKeepingBand: number;
}): Doctrine {
  return {
    base: {
      stance: args.stance,
      targeting: {
        mode: { kind: args.targetPriority },
        vulnerableWeight: 0,
        focusFire: args.focusFire,
      },
      cohesion: 0,
      retreat: args.retreatThreshold,
      spatial: {
        reference: { kind: "target" },
        range: {
          kind: "engage",
          fraction: ENGAGE_FRACTION[args.engageRange],
          tolerance: args.rangeKeepingBand,
        },
        bearing: { kind: "free" },
      },
    },
    rules: [],
  };
}

export const lineDoctrine = fleetDoctrine({
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "long",
  retreatThreshold: 0.3,
  focusFire: true,
  rangeKeepingBand: 0.5,
});
export const strikeDoctrine = fleetDoctrine({
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0.15,
  focusFire: false,
  rangeKeepingBand: 0.3,
});
export const skirmishDoctrine = fleetDoctrine({
  stance: "evasive",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.4,
  focusFire: true,
  rangeKeepingBand: 0.6,
});
export const spearheadDoctrine = fleetDoctrine({
  stance: "aggressive",
  targetPriority: "strongest",
  engageRange: "medium",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.25,
});
/** Swarm fleets: extremely aggressive, close-range pack hunters. */
export const hiveDoctrine = fleetDoctrine({
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0,
  focusFire: true,
  rangeKeepingBand: 0.2,
});
/** Swarm brood artillery: hang back and sting from range. */
export const broodDoctrine = fleetDoctrine({
  stance: "balanced",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.5,
});
/** Crystalline phase fleets: kite at range, blink away from trouble. */
export const phaseDoctrine = fleetDoctrine({
  stance: "evasive",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.35,
  focusFire: true,
  rangeKeepingBand: 0.6,
});
/** Foundry siege fleets: hold ground and outlast at range. */
export const siegeDoctrine = fleetDoctrine({
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "medium",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.3,
});
/** Corsair raid fleets: close fast, hit hard, scatter. */
export const raidDoctrine = fleetDoctrine({
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0.2,
  focusFire: false,
  rangeKeepingBand: 0.25,
});
/** Synthetic nets: a defensive screen that picks off the weakest. */
export const netDoctrine = fleetDoctrine({
  stance: "defensive",
  targetPriority: "weakest",
  engageRange: "medium",
  retreatThreshold: 0.25,
  focusFire: true,
  rangeKeepingBand: 0.4,
});
