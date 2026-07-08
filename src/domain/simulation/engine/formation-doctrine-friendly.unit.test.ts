/**
 * Direct handler tests for the two friendly-awareness doctrine conditions
 * (`friendlyInLineOfFire`, `friendlyProximity`) evaluated in
 * `engine/formation-doctrine.ts`. These drive {@link stepFormationDoctrine}
 * with minimal hand-built ships and assert the resolved `aiFire` / `aiSpatial`
 * outputs directly — fast, deterministic coverage of the condition geometry
 * (projection bounds, angular tolerance, direction, alive/side filtering) that
 * complements the end-to-end engine test in
 * `engine.friendly-ai.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { stepFormationDoctrine } from "./formation-doctrine";
import type { DoctrineRule } from "@/schema/ai";
import {
  EMPTY_DEPLOYMENT,
  EMPTY_POINTS,
  NO_CONTEXTS,
  SPATIAL,
  index,
  ship,
} from "./formation-doctrine-test-helpers";

describe("engine.formation-doctrine — friendlyInLineOfFire", () => {
  it("fires when a same-side ship is on the observer→target segment", () => {
    // a1 at (0,0) targets d1 at (1000,0). a2 (same side) at (500,0) sits on
    // the line: projection 500 ∈ (0, 1000), perpendicular 0, angular offset 0.
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 500, y: 0 });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine([a1, a2, d1], index([a1, a2, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiFire).toBe("holdFire");
  });

  it("does not fire when the friendly is off the line beyond the tolerance", () => {
    // a2 at (500, 100): projection 500, perpendicular 100, angular offset
    // atan2(100, 500) ≈ 11.3° > 5°.
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0, target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 500, y: 100 });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine([a1, a2, d1], index([a1, a2, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiFire).toBeUndefined();
  });

  it("fires when the tolerance is wide enough to encompass the offset", () => {
    // Same geometry as above but toleranceDeg 15: 11.3° < 15° → fires.
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 15 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0, target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 500, y: 100 });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine([a1, a2, d1], index([a1, a2, d1]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiFire).toBe("holdFire");
  });

  it("does not fire for a friendly behind the observer or past the target", () => {
    // Behind: projection negative → skipped. Past: projection ≥ segLen → skipped.
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0, target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const behind = ship({ instanceId: "behind", side: "attacker", x: -500, y: 0 });
    const past = ship({ instanceId: "past", side: "attacker", x: 1500, y: 0 });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine(
      [a1, behind, past, d1],
      index([a1, behind, past, d1]),
      0,
      EMPTY_DEPLOYMENT,
      EMPTY_POINTS,
      NO_CONTEXTS,
    );
    expect(a1.aiFire).toBeUndefined();
  });

  it("does not fire when the observer has no target", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 500, y: 0 });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiFire).toBeUndefined();
  });

  it("ignores dead and enemy ships on the line", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyInLineOfFire", toleranceDeg: 5 },
      then: { fire: "holdFire" },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0, target: "d1",
      doctrine: { base: {}, rules: [rule] },
    });
    const deadAlly = ship({ instanceId: "dead", side: "attacker", x: 500, y: 0, alive: false });
    const d1 = ship({ instanceId: "d1", side: "defender", x: 1000, y: 0 });
    stepFormationDoctrine(
      [a1, deadAlly, d1],
      index([a1, deadAlly, d1]),
      0,
      EMPTY_DEPLOYMENT,
      EMPTY_POINTS,
      NO_CONTEXTS,
    );
    expect(a1.aiFire).toBeUndefined();
  });
});

describe("engine.formation-doctrine — friendlyProximity", () => {
  it("fires (within) when a same-side ship is closer than the threshold", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyProximity", threshold: 50, direction: "within" },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    // 30 m away — within the 50 m threshold.
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 30, y: 0 });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiSpatial).toBe(SPATIAL);
  });

  it("does not fire (within) when every friendly is farther than the threshold", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyProximity", threshold: 50, direction: "within" },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 60, y: 0 });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiSpatial).toBeUndefined();
  });

  it("fires (beyond) when a same-side ship is farther than the threshold", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyProximity", threshold: 50, direction: "beyond" },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    const a2 = ship({ instanceId: "a2", side: "attacker", x: 60, y: 0 });
    stepFormationDoctrine([a1, a2], index([a1, a2]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiSpatial).toBe(SPATIAL);
  });

  it("does not fire when no alive same-side ship is present", () => {
    const rule: DoctrineRule = {
      condition: { kind: "friendlyProximity", threshold: 50, direction: "within" },
      then: { spatial: SPATIAL },
    };
    const a1 = ship({
      instanceId: "a1", side: "attacker", x: 0, y: 0,
      doctrine: { base: {}, rules: [rule] },
    });
    // Only an enemy and a dead friendly — neither counts.
    const d1 = ship({ instanceId: "d1", side: "defender", x: 10, y: 0 });
    const dead = ship({ instanceId: "dead", side: "attacker", x: 10, y: 0, alive: false });
    stepFormationDoctrine([a1, d1, dead], index([a1, d1, dead]), 0, EMPTY_DEPLOYMENT, EMPTY_POINTS, NO_CONTEXTS);
    expect(a1.aiSpatial).toBeUndefined();
  });
});
