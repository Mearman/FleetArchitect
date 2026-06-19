import { describe, expect, it } from "vitest";

import {
  CRITICAL_STRUCTURE_RATIO,
  CREW_TASK_KINDS,
  CrewPriority,
  crewTaskOrder,
  structureIsCritical,
} from "@/domain/simulation/engine/crew-priority";
import type { CrewPriorityShipState } from "@/domain/simulation/engine/crew-priority";

/**
 * Crew priority modes reorder the four crew task kinds (manning, ammo haul,
 * power haul, repair) deterministically, with a structure-ratio conditional
 * for damage-control. The ordering is what the crew tick will consume to drive
 * its idle-assignment passes; here we assert each mode's order, the
 * conditional, and the determinism contract (same inputs → same output, no
 * RNG or insertion-order dependence).
 */

const ALL_KINDS = new Set<string>(CREW_TASK_KINDS);

function state(structure: number, maxStructure: number): CrewPriorityShipState {
  return { structure, maxStructure };
}

describe("crew-priority — CrewTaskKind union", () => {
  it("exposes exactly the four task kinds", () => {
    expect(CREW_TASK_KINDS).toEqual(["manning", "haulAmmo", "haulPower", "repair"]);
  });
});

describe("crew-priority — CrewPriority schema", () => {
  it("accepts the three modes and rejects anything else", () => {
    for (const mode of CrewPriority.options) {
      expect(CrewPriority.safeParse(mode).success).toBe(true);
    }
    expect(CrewPriority.safeParse("aggressive").success).toBe(false);
    expect(CrewPriority.safeParse("").success).toBe(false);
    expect(CrewPriority.safeParse(0).success).toBe(false);
  });
});

describe("crew-priority — structureIsCritical", () => {
  it("is false at and above the critical ratio and true below it", () => {
    // The ratio is 1/2: a ship at exactly half structure is NOT critical
    // (the conditional is strict `<`), but one point below is.
    const max = 100;
    expect(structureIsCritical(state(max, max))).toBe(false);
    expect(structureIsCritical(state(CRITICAL_STRUCTURE_RATIO * max, max))).toBe(false);
    expect(structureIsCritical(state(CRITICAL_STRUCTURE_RATIO * max - 1, max))).toBe(true);
    expect(structureIsCritical(state(0, max))).toBe(true);
  });

  it("treats a non-positive maxStructure as critical (nothing left to lose)", () => {
    expect(structureIsCritical(state(0, 0))).toBe(true);
    expect(structureIsCritical(state(5, -1))).toBe(true);
  });

  it("uses the documented ratio of one half", () => {
    // The midpoint of the [0, max] integrity scale — a ratio, not a tuned
    // literal. Asserted so a future edit that drifts it is caught.
    expect(CRITICAL_STRUCTURE_RATIO).toBe(1 / 2);
  });
});

describe("crew-priority — crewTaskOrder base modes", () => {
  it("combat mans weapons first, then ammo, power, repair", () => {
    expect(crewTaskOrder("combat", state(100, 100))).toEqual([
      "manning",
      "haulAmmo",
      "haulPower",
      "repair",
    ]);
  });

  it("resupply hauls ammo and power before manning or repair", () => {
    expect(crewTaskOrder("resupply", state(100, 100))).toEqual([
      "haulAmmo",
      "haulPower",
      "manning",
      "repair",
    ]);
  });

  it("damageControl (stable structure) mans first, then repairs, then hauls", () => {
    // At exactly the critical ratio the ship is still stable (strict `<`).
    expect(crewTaskOrder("damageControl", state(50, 100))).toEqual([
      "manning",
      "repair",
      "haulAmmo",
      "haulPower",
    ]);
    // And well above it.
    expect(crewTaskOrder("damageControl", state(99, 100))).toEqual([
      "manning",
      "repair",
      "haulAmmo",
      "haulPower",
    ]);
  });

  it("damageControl (critical structure) repairs first, then power, manning, ammo", () => {
    expect(crewTaskOrder("damageControl", state(49, 100))).toEqual([
      "repair",
      "haulPower",
      "manning",
      "haulAmmo",
    ]);
    expect(crewTaskOrder("damageControl", state(1, 100))).toEqual([
      "repair",
      "haulPower",
      "manning",
      "haulAmmo",
    ]);
  });
});

describe("crew-priority — output invariants", () => {
  const cases: Array<{ priority: "combat" | "damageControl" | "resupply"; label: string; state: CrewPriorityShipState }> = [
    { priority: "combat", label: "combat/full", state: state(100, 100) },
    { priority: "combat", label: "combat/empty", state: state(0, 100) },
    { priority: "damageControl", label: "dc/stable", state: state(80, 100) },
    { priority: "damageControl", label: "dc/critical", state: state(10, 100) },
    { priority: "resupply", label: "resupply/full", state: state(100, 100) },
    { priority: "resupply", label: "resupply/empty", state: state(0, 100) },
  ];

  for (const { priority, label, state: s } of cases) {
    it(`${label}: returns each task kind exactly once`, () => {
      const order = crewTaskOrder(priority, s);
      expect(order).toHaveLength(ALL_KINDS.size);
      expect(new Set(order)).toEqual(ALL_KINDS);
    });
  }
});

describe("crew-priority — determinism", () => {
  it("returns identical content and order for equal inputs across repeated calls", () => {
    const s = state(30, 100);
    const runs = Array.from({ length: 5 }, () => crewTaskOrder("damageControl", s));
    // Every run produces the same array contents in the same order.
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });

  it("the damage-control conditional flips at exactly the critical ratio boundary", () => {
    // One structure point either side of the ratio boundary yields the two
    // distinct orders — proving the conditional is a pure function of the
    // ratio with no hysteresis or RNG.
    const stable = crewTaskOrder("damageControl", state(50, 100));
    const critical = crewTaskOrder("damageControl", state(49, 100));
    expect(stable[0]).toBe("manning");
    expect(critical[0]).toBe("repair");
    expect(stable).not.toEqual(critical);
  });

  it("combat and resupply are independent of structure (no conditional)", () => {
    // The same order regardless of structure ratio — the conditional is
    // damage-control only.
    const full = state(100, 100);
    const empty = state(0, 100);
    expect(crewTaskOrder("combat", full)).toEqual(crewTaskOrder("combat", empty));
    expect(crewTaskOrder("resupply", full)).toEqual(crewTaskOrder("resupply", empty));
  });
});
