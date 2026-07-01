/**
 * Shared fixtures for the formation-doctrine unit-test suite: the minimal
 * {@link SimShip} builder, the byId index, and the empty deployment / points /
 * spatial sentinels every condition test drives {@link stepFormationDoctrine}
 * with. Extracted from `formation-doctrine.unit.test.ts` so the friendly-
 * awareness condition tests (and any future condition-kind tests) reuse the
 * same fixture rather than re-declaring it.
 */
import type { SpatialObjective } from "@/schema/ai";
import type { SimShip } from "./types";
import type { DeploymentReference } from "./movement";

/** Minimal valid SimShip for formation-doctrine tests. Only the fields the pass
 *  reads are meaningful; the rest carry inert defaults so the literal
 *  type-checks. */
export function ship(
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

export const EMPTY_DEPLOYMENT: DeploymentReference = {
  attacker: { x: 0, y: 0 },
  defender: { x: 1000, y: 0 },
};

/** An empty waypoint map — the shape every preset battle carries (no fleet
 *  authors points), so point references stay unresolvable. */
export const EMPTY_POINTS: ReadonlyMap<string, { x: number; y: number }> =
  new Map();

/** A spatial objective to use as a rule's `then.spatial`. Typed explicitly so
 *  no `as const` assertion is needed. */
export const SPATIAL: SpatialObjective = {
  reference: { kind: "self" },
  range: { kind: "hold", band: 0.1 },
  bearing: { kind: "free" },
};

/** Build the byId index for a set of ships. */
export function index(ships: readonly SimShip[]): Map<string, SimShip> {
  const m = new Map<string, SimShip>();
  for (const s of ships) m.set(s.instanceId, s);
  return m;
}
