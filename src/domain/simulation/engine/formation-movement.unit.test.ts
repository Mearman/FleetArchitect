import { describe, expect, it } from "vitest";
import { desiredPoint, cohesionCentroidFor, ownFormationCentroid } from "./formation-movement";
import { buildAggregates, makeResolver } from "./formation-doctrine";
import type { SpatialObjective } from "@/schema/ai";
import type { SimShip } from "./types";
import type { DeploymentReference } from "./movement";

/** Minimal valid SimShip for formation-movement tests. Mirrors the fixture in
 *  engine.formation-doctrine.unit.test.ts — only the fields the consumers read
 *  are meaningful. */
function ship(
  over: Partial<SimShip> & {
    instanceId: string;
    side: "attacker" | "defender";
  },
): SimShip {
  return {
    instanceId: over.instanceId,
    faction: "Terran",
    side: over.side,
    classification: over.classification ?? "frigate",
    x: over.x ?? 0,
    y: over.y ?? 0,
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
    mass: over.mass ?? 1,
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
    alive: over.alive ?? true,
    salvageMass: 0,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    sensorSaturation: 0,
    formationId: over.formationId,
    formationChain: over.formationChain,
    role: over.role,
  };
}

const DEPLOYMENT: DeploymentReference = {
  attacker: { x: 0, y: 0 },
  defender: { x: 1000, y: 0 },
};

/** Build the resolver + aggregates the same way the engine does, for tests. */
function resolverFor(ships: readonly SimShip[]) {
  const sorted = ships
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );
  const byId = new Map(ships.map((s) => [s.instanceId, s]));
  const aggregates = buildAggregates(sorted);
  const resolve = makeResolver(sorted, byId, aggregates, DEPLOYMENT, new Map());
  return { sorted, byId, aggregates, resolve };
}

describe("engine.formation-movement — desiredPoint GATE", () => {
  it("returns undefined when the ship has no aiSpatial (preset behaviour)", () => {
    const a = ship({ instanceId: "a1", side: "attacker", x: 100, y: 0 });
    const { resolve } = resolverFor([a]);
    expect(desiredPoint(a, 0, resolve)).toBeUndefined();
  });

  it("returns undefined when the reference unresolves (no target set)", () => {
    const a = ship({ instanceId: "a1", side: "attacker", x: 0, y: 0 });
    a.aiSpatial = {
      reference: { kind: "target" },
      range: { kind: "close" },
      bearing: { kind: "free" },
    };
    const { resolve } = resolverFor([a]);
    // No target locked → reference unresolves → undefined (fall through).
    expect(desiredPoint(a, 0, resolve)).toBeUndefined();
  });
});

describe("engine.formation-movement — movement-verb mapping", () => {
  it("hold: desired point is the reference point itself, with the authored band", () => {
    // A defender's deployment reference is (1000, 0). Hold at it.
    const d = ship({ instanceId: "d1", side: "defender", x: 500, y: 0 });
    const spatial: SpatialObjective = {
      reference: { kind: "deployment" },
      range: { kind: "hold", band: 0.25 },
      bearing: { kind: "free" },
    };
    d.aiSpatial = spatial;
    const { resolve } = resolverFor([d]);
    const dp = desiredPoint(d, 0, resolve);
    expect(dp).not.toBeUndefined();
    expect(dp?.x).toBe(1000);
    expect(dp?.y).toBe(0);
    expect(dp?.want).toBe(0);
    expect(dp?.band).toBe(0.25);
  });

  it("close: desired point is the reference point, want 0", () => {
    // Defender deploys at (1000, 0). Close on own deployment → point P, want 0.
    const d = ship({ instanceId: "d1", side: "defender", x: 0, y: 100 });
    d.aiSpatial = {
      reference: { kind: "deployment" },
      range: { kind: "close" },
      bearing: { kind: "free" },
    };
    const { resolve } = resolverFor([d]);
    const dp = desiredPoint(d, 0, resolve);
    expect(dp).not.toBeUndefined();
    expect(dp?.x).toBeCloseTo(1000, 6);
    expect(dp?.y).toBeCloseTo(0, 6);
    expect(dp?.want).toBe(0);
    expect(dp?.band).toBeUndefined();
  });

  it("maintain: point is the reference, want is the range (free bearing)", () => {
    // Defender deployment (reference) at (1000, 0). Free bearing → point is P
    // itself; the controller holds range 400 from it (want = 400).
    const d = ship({ instanceId: "d1", side: "defender", x: 0, y: 0 });
    d.aiSpatial = {
      reference: { kind: "deployment" },
      range: { kind: "maintain", range: 400, tolerance: 0.1 },
      bearing: { kind: "free" },
    };
    const { resolve } = resolverFor([d]);
    const dp = desiredPoint(d, 0, resolve);
    expect(dp).not.toBeUndefined();
    expect(dp?.x).toBeCloseTo(1000, 6);
    expect(dp?.y).toBeCloseTo(0, 6);
    expect(dp?.want).toBeCloseTo(400, 6);
  });

  it("orbit: desired point circles the reference as a pure function of tick (want 0)", () => {
    // Reference = self at (0,0). Orbit with omega = pi/2 per tick, phase 0,
    // radius 100 (maintain range 100 → the radius). At tick 0 → angle 0 →
    // (100, 0). At tick 1 → angle pi/2 → (0, 100). The point IS the offset
    // location; want = 0 (sit on it).
    const a = ship({ instanceId: "a1", side: "attacker", x: 0, y: 0 });
    a.aiSpatial = {
      reference: { kind: "self" },
      range: { kind: "maintain", range: 100, tolerance: 0.1 },
      bearing: { kind: "orbit", omega: Math.PI / 2, phase: 0 },
    };
    const { resolve } = resolverFor([a]);
    const dp0 = desiredPoint(a, 0, resolve);
    expect(dp0?.x).toBeCloseTo(100, 6);
    expect(dp0?.y).toBeCloseTo(0, 6);
    expect(dp0?.want).toBe(0);
    const dp1 = desiredPoint(a, 1, resolve);
    // cos(pi/2) ≈ 0, sin(pi/2) = 1 → (0, 100).
    expect(dp1?.x).toBeCloseTo(0, 6);
    expect(dp1?.y).toBeCloseTo(100, 6);
    // Determinism: the same tick always yields the same point.
    const dp1Again = desiredPoint(a, 1, resolve);
    expect(dp1Again?.x).toBe(dp1?.x);
    expect(dp1Again?.y).toBe(dp1?.y);
  });

  it("evade: point is the reference, want is minRange (hold open range)", () => {
    // Evade opens range beyond minRange. Ship at (0,0), reference (defender
    // deployment) at (1000,0). Free bearing → point is P; want = minRange 200
    // (the controller holds 200 from P).
    const d = ship({ instanceId: "d1", side: "defender", x: 0, y: 0 });
    d.aiSpatial = {
      reference: { kind: "deployment" },
      range: { kind: "evade", minRange: 200 },
      bearing: { kind: "free" },
    };
    const { resolve } = resolverFor([d]);
    const dp = desiredPoint(d, 0, resolve);
    expect(dp?.x).toBeCloseTo(1000, 6);
    expect(dp?.y).toBeCloseTo(0, 6);
    expect(dp?.want).toBeCloseTo(200, 6);
  });

  it("offset bearing: point is offset from the reference by the range radius (want 0)", () => {
    // Reference = self at (0,0). Maintain range 100 → radius 100. Offset angle
    // pi/2 (world) → point at (0, 100); want = 0 (sit on the offset point).
    const a = ship({ instanceId: "a1", side: "attacker", x: 0, y: 0 });
    a.aiSpatial = {
      reference: { kind: "self" },
      range: { kind: "maintain", range: 100, tolerance: 0.1 },
      bearing: { kind: "offset", frame: "world", angle: Math.PI / 2 },
    };
    const { resolve } = resolverFor([a]);
    const dp = desiredPoint(a, 5, resolve);
    expect(dp?.x).toBeCloseTo(0, 6);
    expect(dp?.y).toBeCloseTo(100, 6);
    expect(dp?.want).toBe(0);
  });
});

describe("engine.formation-movement — cohesion generalisation", () => {
  it("ownFormationCentroid resolves to the formation's alive-member centroid", () => {
    // Two attackers in formation "f1": a1 at (0, 100), a2 at (0, -100).
    // Centroid = (0, 0).
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 100,
      formationId: "f1",
      formationChain: ["root", "f1"],
      role: "line",
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      x: 0,
      y: -100,
      formationId: "f1",
      formationChain: ["root", "f1"],
      role: "line",
    });
    const { aggregates } = resolverFor([a1, a2]);
    const c = ownFormationCentroid(a1, aggregates);
    expect(c?.x).toBeCloseTo(0, 6);
    expect(c?.y).toBeCloseTo(0, 6);
  });

  it("cohesionCentroidFor uses the own-formation centroid when the ship is nested", () => {
    // A nested sub-formation: chain length 2 (["root","f1"]). Own centroid
    // (0,0). Whole-fleet centroid is different (a third ship pulls it). The
    // nested ship should blend toward its OWN formation centroid.
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 100,
      formationId: "f1",
      formationChain: ["root", "f1"],
      role: "screen",
    });
    const a2 = ship({
      instanceId: "a2",
      side: "attacker",
      x: 0,
      y: -100,
      formationId: "f1",
      formationChain: ["root", "f1"],
      role: "screen",
    });
    // A lone ship in a different formation far away — pulls the whole-fleet
    // centroid off the sub-formation's.
    const a3 = ship({
      instanceId: "a3",
      side: "attacker",
      x: 5000,
      y: 5000,
      formationId: "f2",
      formationChain: ["root", "f2"],
      role: "line",
    });
    const { aggregates } = resolverFor([a1, a2, a3]);
    const wholeFleet = { x: 1666.666, y: 1666.666 }; // approximate fleet centroid
    const cohesion = cohesionCentroidFor(a1, wholeFleet, aggregates);
    // Nested → own-formation centroid (0,0), NOT the whole-fleet centroid.
    expect(cohesion?.x).toBeCloseTo(0, 6);
    expect(cohesion?.y).toBeCloseTo(0, 6);
  });

  it("cohesionCentroidFor uses the whole-fleet centroid for a flat preset fleet", () => {
    // Flat preset: chain length 1, no aiSpatial → whole-fleet centroid.
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 0,
      y: 0,
      formationChain: ["root"],
    });
    const { aggregates } = resolverFor([a1]);
    const wholeFleet = { x: 1234, y: 5678 };
    const cohesion = cohesionCentroidFor(a1, wholeFleet, aggregates);
    expect(cohesion).toEqual(wholeFleet);
  });

  it("cohesionCentroidFor uses the own-formation centroid when aiSpatial is set (even if flat)", () => {
    // Flat chain but aiSpatial set → own-formation centroid path.
    const a1 = ship({
      instanceId: "a1",
      side: "attacker",
      x: 10,
      y: 20,
      formationId: "f1",
      formationChain: ["f1"],
      role: "line",
    });
    a1.aiSpatial = {
      reference: { kind: "self" },
      range: { kind: "hold", band: 0.1 },
      bearing: { kind: "free" },
    };
    const { aggregates } = resolverFor([a1]);
    const wholeFleet = { x: 9999, y: 9999 };
    const cohesion = cohesionCentroidFor(a1, wholeFleet, aggregates);
    // Own formation centroid = a1's own position (only member) = (10, 20).
    expect(cohesion?.x).toBeCloseTo(10, 6);
    expect(cohesion?.y).toBeCloseTo(20, 6);
  });
});
