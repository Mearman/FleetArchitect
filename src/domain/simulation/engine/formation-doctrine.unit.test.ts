import { describe, expect, it } from "vitest";
import { stepFormationDoctrine } from "./formation-doctrine";
import type {
  Doctrine,
  DoctrineRule,
  FormationReference,
} from "@/schema/ai";
import type { DeploymentReference } from "./movement";
import {
  EMPTY_DEPLOYMENT,
  EMPTY_POINTS,
  SPATIAL,
  index,
  ship,
} from "./formation-doctrine-test-helpers";

describe("engine.formation-doctrine — GATE", () => {
  it("is a complete no-op for a fleet with no rules", () => {
    const a = ship({ instanceId: "a1", side: "attacker" });
    const d = ship({ instanceId: "d1", side: "defender" });
    // Seed the fields with sentinel values to prove they are NOT cleared.
    a.aiSpatial = SPATIAL;
    a.aiTargeting = { kind: "nearest" };
    a.aiFire = "holdFire";
    stepFormationDoctrine([a, d], index([a, d]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a.aiSpatial).toBe(SPATIAL);
    expect(a.aiTargeting).toEqual({ kind: "nearest" });
    expect(a.aiFire).toBe("holdFire");
  });

  it("is a complete no-op for a fleet with only ship-self rules", () => {
    const doctrine: Doctrine = {
      base: {},
      rules: [
        {
          condition: { kind: "shieldBelow", fraction: 0.5 },
          then: { fire: "holdFire" },
        },
        {
          condition: { kind: "structureBelow", fraction: 0.25 },
          then: { spatial: SPATIAL },
        },
      ],
    };
    const a = ship({ instanceId: "a1", side: "attacker", doctrine });
    a.aiSpatial = SPATIAL; // sentinel
    stepFormationDoctrine([a], index([a]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    // The ship-self rules are NOT evaluated by this pass; the sentinel survives.
    expect(a.aiSpatial).toBe(SPATIAL);
    expect(a.aiFire).toBeUndefined();
  });
});

describe("engine.formation-doctrine — formationStrength", () => {
  it("fires when the referenced formation is below threshold (direction: below)", () => {
    // Two attackers in formation "f1"; one is near death (structure 5/100).
    // Combined alive = 5 + 100 (shields 0) = 105; initial = 100+100 = 200;
    // fraction = 105/200 = 0.525. Below 0.6 -> fires.
    const rule: DoctrineRule = {
      condition: {
        kind: "formationStrength",
        reference: { kind: "self" },
        threshold: 0.6,
        direction: "below",
      },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      structure: 5,
      shield: 0,
      maxShield: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      structure: 100,
      shield: 0,
      maxShield: 0,
    });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiSpatial).toEqual(SPATIAL);
  });

  it("does not fire when the referenced formation is above threshold (direction: below)", () => {
    // Both attackers at full strength; fraction = 1.0, not below 0.6.
    const rule: DoctrineRule = {
      condition: {
        kind: "formationStrength",
        reference: { kind: "self" },
        threshold: 0.6,
        direction: "below",
      },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
    });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiSpatial).toBeUndefined();
  });

  it("fires for direction: above when the formation exceeds the threshold", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "formationStrength",
        reference: { kind: "self" },
        threshold: 0.9,
        direction: "above",
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });
});

describe("engine.formation-doctrine — formationEngaged / formationDestroyed / flagshipLost", () => {
  it("formationEngaged fires when any member has a target", () => {
    const rule: DoctrineRule = {
      condition: { kind: "formationEngaged", reference: { kind: "self" } },
      then: {
        targeting: {
          mode: { kind: "threatsTo", reference: { kind: "self" } },
          vulnerableWeight: 0,
          focusFire: false,
        },
      },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      target: "d1",
    });
    const d1 = ship({ instanceId: "d1", side: "defender" });
    stepFormationDoctrine([a1, a2, d1], index([a1, a2, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiTargeting).toEqual({ kind: "threatsTo", reference: { kind: "self" } });
  });

  it("formationDestroyed fires when no alive members remain in the referenced formation", () => {
    // The only member of enemy formation "fd" is dead, so its memberCount is 0.
    // A survivor in a different formation references the destroyed enemy
    // formation by role.
    const rule: DoctrineRule = {
      condition: {
        kind: "formationDestroyed",
        reference: { kind: "enemy", role: "line" },
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "fa",
      formationChain: ["fa"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    const d1 = ship({
      instanceId: "d1",
      side: "defender",
      formationId: "fd",
      formationChain: ["fd"],
      role: "line",
      alive: false,
    });
    stepFormationDoctrine([a1, d1], index([a1, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });

  it("flagshipLost fires when the first (instanceId-sorted) member is dead", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "flagshipLost",
        reference: { kind: "self" },
      },
      then: { fire: "holdFire" },
    };
    // a1 (flagship, instanceId-sorted first) is dead; a2 carries the rule.
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      alive: false,
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a2.aiFire).toBe("holdFire");
  });
});

describe("engine.formation-doctrine — range between references", () => {
  it("fires when the distance between two resolved points is within [min, max]", () => {
    // self at (0,0), target at (100, 0). Distance = 100, within [50, 150].
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "target" },
        min: 50,
        max: 150,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 100, y: 0 });
    stepFormationDoctrine([a1, d1], index([a1, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });

  it("does not fire when the distance is outside [min, max]", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "target" },
        min: 50,
        max: 150,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine([a1, d1], index([a1, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBeUndefined();
  });

  it("does not fire when a reference is unresolvable (no target)", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "target" },
        min: 0,
        max: 9999,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBeUndefined();
  });

  it("resolves `between` references by linear interpolation", () => {
    // between(self, target, 0.5) -> midpoint at (50, 0). range from self (0,0)
    // to the midpoint is 50, within [40, 60].
    const midpoint: FormationReference = {
      kind: "between",
      a: { kind: "self" },
      b: { kind: "target" },
      alpha: 0.5,
    };
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: midpoint,
        min: 40,
        max: 60,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 100, y: 0 });
    stepFormationDoctrine([a1, d1], index([a1, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });
});

describe("engine.formation-doctrine — all / any", () => {
  it("all fires when every sub-condition holds", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "all",
        of: [
          { kind: "tickAfter", tick: 3 },
          { kind: "tickAfter", tick: 1 },
        ],
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });

  it("all does not fire when any sub-condition fails", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "all",
        of: [
          { kind: "tickAfter", tick: 3 },
          { kind: "tickAfter", tick: 10 },
        ],
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBeUndefined();
  });

  it("any fires when at least one sub-condition holds", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "any",
        of: [
          { kind: "tickAfter", tick: 100 },
          { kind: "tickAfter", tick: 3 },
        ],
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });
});

describe("engine.formation-doctrine — tickAfter / phase", () => {
  it("tickAfter fires at and after the threshold tick", () => {
    const rule: DoctrineRule = {
      condition: { kind: "tickAfter", tick: 10 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 9, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBeUndefined();
    stepFormationDoctrine([a1], index([a1]), 10, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("holdFire");
  });

  it("phase opening fires before any formation is engaged", () => {
    const rule: DoctrineRule = {
      condition: { kind: "phase", phase: "opening" },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      formationId: "fa",
      formationChain: ["fa"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    const d1 = ship({
      instanceId: "d1",
      side: "defender",
      formationId: "fd",
      formationChain: ["fd"],
      role: "line",
    });
    stepFormationDoctrine([a1, d1], index([a1, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });
});

describe("engine.formation-doctrine — friendly/enemy role resolution", () => {
  it("resolves a friendly role to the formation centroid", () => {
    // Two friendly ships in role "screen": a1 at (0, 100), a2 at (0, -100).
    // Centroid (0, 0). Rule: range from self (a3 at (50,0)) to friendly screen
    // is 50, within [0, 100].
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "friendly", role: "screen" },
        min: 0,
        max: 100,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 100,
      formationId: "fsc",
      formationChain: ["fsc"],
      role: "screen",
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      x: 0,
      y: -100,
      formationId: "fsc",
      formationChain: ["fsc"],
      role: "screen",
    });
    const a3 = ship({
      instanceId: "a3",
      side: "attacker",
      x: 50,
      y: 0,
      formationId: "fln",
      formationChain: ["fln"],
      role: "line",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1, a2, a3], index([a1, a2, a3]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a3.aiFire).toBe("atWill");
  });

  it("an unresolvable friendly role makes the condition unsatisfied", () => {
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "friendly", role: "nonexistent" },
        min: 0,
        max: 9999,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBeUndefined();
  });
});

describe("engine.formation-doctrine — first-match-wins + reset", () => {
  it("the first matching rule wins; later rules do not stack", () => {
    const rule: DoctrineRule = {
      condition: { kind: "tickAfter", tick: 0 },
      then: { fire: "holdFire" },
    };
    const later: DoctrineRule = {
      condition: { kind: "tickAfter", tick: 0 },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule, later] },
    });
    stepFormationDoctrine([a1], index([a1]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    // First match wins: holdFire, NOT atWill.
    expect(a1.aiFire).toBe("holdFire");
  });

  it("clears a prior tick's override when no rule fires this tick", () => {
    // Tick 5: rule fires (tickAfter 0), writing holdFire.
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: {
        base: {},
        rules: [
          {
            condition: { kind: "tickAfter", tick: 0 },
            then: { fire: "holdFire" },
          },
        ],
      },
    });
    stepFormationDoctrine([a1], index([a1]), 5, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a1.aiFire).toBe("holdFire");
    // Tick 6: a doctrine whose condition never fires at tick 6. The pass still
    // resets the field to undefined.
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      doctrine: {
        base: {},
        rules: [
          {
            condition: { kind: "tickAfter", tick: 100 },
            then: { fire: "holdFire" },
          },
        ],
      },
    });
    a2.aiFire = "holdFire"; // sentinel from a prior tick
    stepFormationDoctrine([a2], index([a2]), 6, EMPTY_DEPLOYMENT, EMPTY_POINTS);
    expect(a2.aiFire).toBeUndefined();
  });
});

describe("engine.formation-doctrine — deployment reference", () => {
  it("resolves the deployment reference to the side's deployment centroid", () => {
    // Attacker deployed at (0, -500). Ship a1 at (0, 0). Range from self to
    // own deployment = 500, within [400, 600].
    const deployment: DeploymentReference = {
      attacker: { x: 0, y: -500 },
      defender: { x: 0, y: 500 },
    };
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "deployment" },
        min: 400,
        max: 600,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, deployment, EMPTY_POINTS);
    expect(a1.aiFire).toBe("atWill");
  });
});

describe("engine.formation-doctrine — point (waypoint) reference", () => {
  it("resolves a {kind: 'point'} reference to the authored world position", () => {
    // A waypoint "wp1" authored at world (200, 0). Ship a1 at (0, 0). Range from
    // self to the point is 200, within [150, 250] — the rule fires, proving the
    // point reference resolved to the authored position via the points map.
    const points = new Map<string, { x: number; y: number }>([
      ["wp1", { x: 200, y: 0 }],
    ]);
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "point", pointId: "wp1" },
        min: 150,
        max: 250,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, points);
    expect(a1.aiFire).toBe("atWill");
  });

  it("does not fire when the pointId is absent from the points map", () => {
    // No entry for "missing" — the reference is unresolvable, so the range
    // condition is unsatisfied. This is the total-reference contract: an absent
    // point never errors, it simply fails the condition.
    const points = new Map<string, { x: number; y: number }>([
      ["wp1", { x: 200, y: 0 }],
    ]);
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: { kind: "point", pointId: "missing" },
        min: 0,
        max: 99999,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, points);
    expect(a1.aiFire).toBeUndefined();
  });

  it("resolves a `between` interpolation that spans a point and self", () => {
    // between(self, point, 0.5): self at (0,0), point at (200,0) → midpoint
    // (100, 0). Range from self to the midpoint is 100, within [80, 120].
    const points = new Map<string, { x: number; y: number }>([
      ["wp1", { x: 200, y: 0 }],
    ]);
    const midpoint: FormationReference = {
      kind: "between",
      a: { kind: "self" },
      b: { kind: "point", pointId: "wp1" },
      alpha: 0.5,
    };
    const rule: DoctrineRule = {
      condition: {
        kind: "range",
        a: { kind: "self" },
        b: midpoint,
        min: 80,
        max: 120,
      },
      then: { fire: "atWill" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    stepFormationDoctrine([a1], index([a1]), 0, EMPTY_DEPLOYMENT, points);
    expect(a1.aiFire).toBe("atWill");
  });
});
