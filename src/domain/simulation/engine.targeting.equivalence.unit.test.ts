import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  electFocusTarget,
  electFocusTargetReference,
  pickTarget,
  pickTargetReference,
  scanExtrema,
  scoreEnemy,
  scoreEnemyReference,
  type EnemyView,
} from "@/domain/simulation/engine/targeting";
import type { FormationTargetingContext } from "@/domain/simulation/engine/formation-targeting";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { Doctrine, TargetingMode } from "@/schema/ai";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimShip } from "@/domain/simulation/engine/types";

/**
 * Equivalence between the reference (oracle) and optimised targeting
 * implementations. Both share the scoring core (`scoreEnemyImpl`); the only
 * difference is where the normalisation extrema come from. The optimised path
 * (`scoreEnemy`, wired into `pickTarget` / `electFocusTarget`) memoises a single
 * O(K) min/max scan per (ship, living-set) and resolves it lazily — so each
 * scored candidate is O(1) off the fast path. The reference path
 * (`scoreEnemyReference`, and the `*Reference` pick/elect wrappers) re-scans the
 * living set on every slow-path call — the unoptimised O(K^2) over K candidates
 * the optimised path bounds.
 *
 * The extrema are a min/max reduction over the same ordered living array
 * (comparisons exact on finite floats, seed-independent over the set), so the
 * resolved extrema — and therefore the normalised, blended score — are
 * bit-identical. Each path runs against the same inputs (scoreEnemy /
 * scoreEnemyReference are pure; pickTarget / electFocusTarget read only
 * ship-awareness and enemy state, which is fixed across the two calls), so the
 * per-enemy scores, the picked target, and the elected focus target must all
 * agree exactly.
 *
 * Fixtures exercise the THREE slow-path triggers — vulnerability weight, stance
 * bias, and the PD (point-defence) bias — plus two non-`nearest` scalar
 * priorities, so the optimised scan's `rawPriorityScore` branches are covered.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 1_000_000,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    ...over,
    compartments: 0,
    airtightCompartments: 0,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  mass = 5,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    surface: "bare",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: "facing" in effect && typeof effect.facing === "number" ? effect.facing : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function combatShip(
  id: string,
  side: "attacker" | "defender",
  position: { x: number; y: number },
  doctrine: Doctrine,
  facing = 0,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position,
    facing,
    doctrine,
    classification: "frigate",
    modules: [moduleOf(`cmd-${id}`, { kind: "hull" }, 0, 0, 1_000, 5, true)],
  };
}

function resolveToSim(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** First ship of a non-empty array, throwing if empty so `ships[0]`'s
 *  `SimShip | undefined` under `noUncheckedIndexedAccess` is handled. */
function firstShip(ships: readonly SimShip[]): SimShip {
  const s = ships[0];
  if (s === undefined) throw new Error("expected at least one ship");
  return s;
}

/** Build an EnemyView directly. scoreEnemy is pure over the view's fields, so a
 *  hand-built view exercises the scorer identically to one built by
 *  `visibleEnemyViews`, without needing an awareness/stealth setup. */
function view(
  instanceId: string,
  x: number,
  y: number,
  structure: number,
  shield: number,
  maxStructure: number,
  maxShield: number,
  cost: number,
): EnemyView {
  return { instanceId, x, y, structure, shield, maxStructure, maxShield, cost };
}

/** Doctrine with a scalar targeting mode + vulnerableWeight, balanced stance. */
function vulnDoctrine(
  mode: "nearest" | "weakest" | "strongest" | "highestCost",
  vulnerableWeight: number,
): Doctrine {
  return {
    base: {
      stance: "balanced",
      targeting: { mode: { kind: mode }, vulnerableWeight, focusFire: false },
    },
    rules: [],
  };
}

/** Populate `ship.awareness` with a live contact per enemy, at the enemy's real
 *  position. Non-stealth targets are always detectable, so `visibleEnemyViews`
 *  admits every contact — letting `pickTarget` / `electFocusTarget` build the
 *  full candidate set the scorer normalises against. */
function setAwareness(ship: SimShip, enemies: readonly SimShip[]): void {
  const awareness = new Map<string, { enemyId: string; x: number; y: number; facing: number; threat: number; origin: string }>();
  for (const e of enemies) {
    awareness.set(e.instanceId, {
      enemyId: e.instanceId,
      x: e.x,
      y: e.y,
      facing: e.facing,
      threat: 0,
      origin: ship.instanceId,
    });
  }
  ship.awareness = awareness;
}

/**
 * For every enemy in `living`, assert the optimised score (memoised extrema via
 * `scanExtrema`) equals the reference score (per-candidate scan) bit-for-bit.
 * `toBe` (not `toBeCloseTo`) is deliberate: the extrema are the same min/max
 * reduction either way, so the floats must be identical. Builds the optimised
 * resolver the same way `pickTarget` does — one `scanExtrema` reused for every
 * candidate — so this proves the precompute mirrors the per-call scan exactly.
 */
function expectScoresEqual(
  ship: SimShip,
  living: readonly EnemyView[],
  formationCtx?: FormationTargetingContext,
): void {
  const extrema = scanExtrema(ship, living);
  for (const enemy of living) {
    const opt = scoreEnemy(ship, enemy, () => extrema, formationCtx);
    const ref = scoreEnemyReference(ship, enemy, living, formationCtx);
    expect(opt, `score for ${enemy.instanceId}`).toBe(ref);
  }
}

describe("engine.targeting — reference vs optimised equivalence", () => {
  // -------------------------------------------------------------------------
  // scoreEnemy: vulnerability weight (nearest priority).
  //
  // vulnerableWeight 0.5 with a balanced stance (stanceBias 0) and no formation
  // context (pdBias 0) fires the slow path purely via w > 0. The four enemies
  // span a range of distances AND a range of damage (structure / maxStructure),
  // so both normalisation terms (priority and vulnerability) are exercised and
  // the blend is non-trivial. Sanity: every blended score lies in [0, 1]
  // (normPriority and vulnerability are both in [0, 1], so their convex blend
  // is too), whereas the raw `nearest` score is a large negative -distSq —
  // proving the slow path actually fired.
  // -------------------------------------------------------------------------
  it("vulnerability weight (nearest): identical per-enemy scores", () => {
    const ship = firstShip(
      resolveToSim([combatShip("a", "attacker", { x: 0, y: 0 }, vulnDoctrine("nearest", 0.5))]),
    );
    const living: EnemyView[] = [
      view("e1", 60, 0, 90, 0, 100, 0, 100),
      view("e2", 200, 0, 10, 0, 100, 0, 100),
      view("e3", 120, 50, 50, 0, 100, 0, 100),
      view("e4", 400, 0, 100, 0, 100, 0, 100),
    ];
    expectScoresEqual(ship, living);

    // Sanity: the slow path fired — blended scores are in [0, 1] (raw nearest
    // scores would be large negatives).
    const extrema = scanExtrema(ship, living);
    for (const enemy of living) {
      const s = scoreEnemy(ship, enemy, () => extrema);
      expect(s, `${enemy.instanceId} blended score in [0,1]`).toBeGreaterThanOrEqual(0);
      expect(s, `${enemy.instanceId} blended score in [0,1]`).toBeLessThanOrEqual(1);
    }
  });

  // -------------------------------------------------------------------------
  // scoreEnemy: vulnerability weight (highestCost priority).
  //
  // A different scalar priority exercises a different `rawPriorityScore` branch
  // inside `scanExtrema` (cost, not -distSq). The enemies share equal distance
  // but differ in cost, so the raw extrema are cost-driven and the scan's
  // highestCost branch is the one reduced. Sanity: the highest-cost enemy (e2,
  // cost 500) normalises to priority 1, so its blended score exceeds the
  // lowest-cost enemy's (e3, cost 50).
  // -------------------------------------------------------------------------
  it("vulnerability weight (highestCost): identical per-enemy scores", () => {
    const ship = firstShip(
      resolveToSim([combatShip("a", "attacker", { x: 0, y: 0 }, vulnDoctrine("highestCost", 0.5))]),
    );
    const living: EnemyView[] = [
      view("e1", 100, 0, 50, 0, 100, 0, 200),
      view("e2", 100, 0, 50, 0, 100, 0, 500),
      view("e3", 100, 0, 50, 0, 100, 0, 50),
    ];
    expectScoresEqual(ship, living);

    const extrema = scanExtrema(ship, living);
    const top = scoreEnemy(ship, living[1]!, () => extrema);
    const bottom = scoreEnemy(ship, living[2]!, () => extrema);
    expect(top, "highest-cost enemy outscores lowest-cost").toBeGreaterThan(bottom);
  });

  // -------------------------------------------------------------------------
  // scoreEnemy: stance bias (aggressive).
  //
  // An aggressive stance contributes stanceTargetDistanceBias["aggressive"] =
  // +0.4 (near preference), with vulnerableWeight 0 and no formation context.
  // The slow path fires purely via stanceBias !== 0. The enemies span a range of
  // distances so the distance-normalisation term is exercised. Sanity: the
  // blended score exceeds 0 (raw nearest would be a large negative; the
  // doctrineScore in [0,1] plus the +0.4 near term lands it above 0).
  // -------------------------------------------------------------------------
  it("stance bias (aggressive): identical per-enemy scores", () => {
    const doctrine: Doctrine = {
      base: {
        stance: "aggressive",
        targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: false },
      },
      rules: [],
    };
    const ship = firstShip(
      resolveToSim([combatShip("a", "attacker", { x: 0, y: 0 }, doctrine)]),
    );
    const living: EnemyView[] = [
      view("e1", 50, 0, 100, 0, 100, 0, 100),
      view("e2", 300, 0, 100, 0, 100, 0, 100),
      view("e3", 150, 80, 100, 0, 100, 0, 100),
    ];
    expectScoresEqual(ship, living);

    // Sanity: the slow path fired (every blended score differs from the raw
    // fast-path -distSq), and the aggressive near-preference ranks the nearest
    // enemy (e1) above the farthest (e2).
    const extrema = scanExtrema(ship, living);
    for (const enemy of living) {
      const s = scoreEnemy(ship, enemy, () => extrema);
      const distSq = (enemy.x - ship.x) ** 2 + (enemy.y - ship.y) ** 2;
      expect(s, `${enemy.instanceId} slow path fired (blended, not raw -distSq)`).not.toBe(-distSq);
    }
    const near = scoreEnemy(ship, living[0]!, () => extrema);
    const far = scoreEnemy(ship, living[1]!, () => extrema);
    expect(near, "aggressive stance prefers the nearest enemy").toBeGreaterThan(far);
  });

  // -------------------------------------------------------------------------
  // scoreEnemy: PD (point-defence) bias.
  //
  // A ship with an `aiTargeting: pdPriority` override scores phantom (drone/
  // decoy) candidates with a +1 bias via `pointDefenseBias`, which needs a
  // formation-targeting context (its `byId` index identifies phantoms). Real
  // enemies take the fast path (pdBias 0, w 0, stanceBias 0 → raw score); the
  // phantom alone takes the slow path. The optimised resolver is invoked exactly
  // once (for the phantom); real enemies never trigger it. Sanity: the phantom's
  // blended score exceeds 1 (the +1 bias surfaces it above the [0,1] doctrine
  // band), proving the PD slow path fired. The `byId` map carries the phantom
  // SimShip so `pointDefenseBias` sees `phantom !== undefined`.
  // -------------------------------------------------------------------------
  it("PD bias (pdPriority): identical per-enemy scores", () => {
    const doctrine: Doctrine = {
      base: {
        stance: "balanced",
        targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: false },
      },
      rules: [],
    };
    const ships = resolveToSim([
      combatShip("a", "attacker", { x: 0, y: 0 }, doctrine),
      combatShip("drone", "defender", { x: 80, y: 0 }, { base: {}, rules: [] }),
      combatShip("real", "defender", { x: 80, y: 0 }, { base: {}, rules: [] }),
    ]);
    const ship = ships.find((s) => s.instanceId === "a");
    const drone = ships.find((s) => s.instanceId === "drone");
    if (ship === undefined || drone === undefined) throw new Error("fixture ship missing");
    // Activate the pdPriority override and mark the drone as a phantom.
    const pdMode: TargetingMode = { kind: "pdPriority" };
    ship.aiTargeting = pdMode;
    drone.phantom = {
      kind: "drone",
      ownerId: "real",
      ticksLeft: 1000,
      damage: 0,
      range: 0,
      speed: 0,
    };
    const byId = new Map<string, SimShip>(ships.map((s) => [s.instanceId, s]));
    const formationCtx: FormationTargetingContext = {
      enemies: ships,
      byId,
      sortedById: [...ships].sort((p, q) =>
        p.instanceId < q.instanceId ? -1 : p.instanceId > q.instanceId ? 1 : 0,
      ),
    };
    const living: EnemyView[] = [
      view("drone", 80, 0, 100, 0, 100, 0, 100),
      view("real", 80, 0, 100, 0, 100, 0, 100),
    ];
    expectScoresEqual(ship, living, formationCtx);

    // Sanity: the phantom's PD-biased score exceeds 1; the real enemy is on the
    // fast path (raw -distSq, a negative number).
    const extrema = scanExtrema(ship, living);
    const droneScore = scoreEnemy(ship, living[0]!, () => extrema, formationCtx);
    const realScore = scoreEnemy(ship, living[1]!, () => extrema, formationCtx);
    expect(droneScore, "phantom PD-biased score > 1").toBeGreaterThan(1);
    expect(realScore, "real enemy on fast path (raw -distSq < 0)").toBeLessThan(0);
  });

  // -------------------------------------------------------------------------
  // pickTarget: full pick equivalence under the slow path.
  //
  // An attacker with vulnerableWeight 0.5 (slow path) and three defenders in its
  // awareness. `pickTarget` memoises the extrema scan once; `pickTargetReference`
  // re-scans per candidate. Both build the candidate set identically (shared
  // `visibleCandidates`) and score with equivalent scorers, so the picked
  // target's instanceId must match. Sanity: both pick the same enemy and the
  // pick is non-undefined (the candidate set is non-empty).
  // -------------------------------------------------------------------------
  it("pickTarget: identical pick under vulnerability weight", () => {
    const ships = resolveToSim([
      combatShip("a", "attacker", { x: 0, y: 0 }, vulnDoctrine("nearest", 0.5)),
      combatShip("d1", "defender", { x: 60, y: 0 }, { base: {}, rules: [] }),
      combatShip("d2", "defender", { x: 200, y: 0 }, { base: {}, rules: [] }),
      combatShip("d3", "defender", { x: 120, y: 50 }, { base: {}, rules: [] }),
    ]);
    const attacker = ships.find((s) => s.instanceId === "a");
    if (attacker === undefined) throw new Error("attacker missing");
    const defenders = ships.filter((s) => s.side === "defender");
    setAwareness(attacker, defenders);

    const opt = pickTarget(attacker, defenders, undefined, 0);
    const ref = pickTargetReference(attacker, defenders, undefined, 0);
    expect(opt, "optimised pick must be defined").toBeDefined();
    expect(opt?.instanceId, "pick instanceId must match").toBe(ref?.instanceId);
  });

  // -------------------------------------------------------------------------
  // electFocusTarget: full election equivalence under the slow path.
  //
  // Two focus-fire voters with an aggressive stance (slow path via stanceBias)
  // and three defenders. Each voter scores its visible set; the enemy with the
  // highest aggregate vote wins. `electFocusTarget` memoises the extrema scan
  // once per voter; `electFocusTargetReference` re-scans per candidate. Both
  // share the voter/candidate derivation and tie-break, so the elected id must
  // match. Sanity: both elect the same non-undefined id.
  // -------------------------------------------------------------------------
  it("electFocusTarget: identical election under stance bias", () => {
    const voterDoctrine: Doctrine = {
      base: {
        stance: "aggressive",
        targeting: { mode: { kind: "nearest" }, vulnerableWeight: 0, focusFire: true },
      },
      rules: [],
    };
    const ships = resolveToSim([
      combatShip("v1", "attacker", { x: 0, y: 0 }, voterDoctrine),
      combatShip("v2", "attacker", { x: 0, y: 40 }, voterDoctrine),
      combatShip("d1", "defender", { x: 100, y: 0 }, { base: {}, rules: [] }),
      combatShip("d2", "defender", { x: 250, y: 0 }, { base: {}, rules: [] }),
      combatShip("d3", "defender", { x: 150, y: 60 }, { base: {}, rules: [] }),
    ]);
    const voters = ships.filter((s) => s.side === "attacker");
    const defenders = ships.filter((s) => s.side === "defender");
    for (const v of voters) setAwareness(v, defenders);

    const opt = electFocusTarget("attacker", ships, defenders, 0);
    const ref = electFocusTargetReference("attacker", ships, defenders, 0);
    expect(opt, "optimised election must be defined").toBeDefined();
    expect(opt, "elected focus id must match").toBe(ref);
  });

  // -------------------------------------------------------------------------
  // Fast path: a default-doctrine ship (no vulnerableWeight, balanced stance,
  // no formation context) takes the fast path for every candidate — scoreEnemy
  // returns the raw score and never resolves the extrema. Both paths must still
  // agree (they share the fast path), and the optimised path must not compute
  // any extrema. Guards against a refactor that accidentally runs the scan on
  // the fast path (which would regress the preset case the gate protects).
  // -------------------------------------------------------------------------
  it("fast path (default doctrine): identical scores, no extrema resolved", () => {
    const ship = firstShip(
      resolveToSim([combatShip("a", "attacker", { x: 0, y: 0 }, { base: {}, rules: [] })]),
    );
    const living: EnemyView[] = [
      view("e1", 60, 0, 100, 0, 100, 0, 100),
      view("e2", 200, 0, 100, 0, 100, 0, 100),
    ];
    // The resolver must never be called on the fast path; if it is, throw.
    let resolved = false;
    const getExtrema = (): never => {
      resolved = true;
      throw new Error("extrema resolver must not be called on the fast path");
    };
    for (const enemy of living) {
      const opt = scoreEnemy(ship, enemy, getExtrema);
      const ref = scoreEnemyReference(ship, enemy, living);
      expect(opt, `fast-path score for ${enemy.instanceId}`).toBe(ref);
    }
    expect(resolved, "optimised path must not resolve extrema on the fast path").toBe(false);
  });
});
