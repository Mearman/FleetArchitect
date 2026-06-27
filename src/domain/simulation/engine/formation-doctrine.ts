/**
 * The formation-doctrine pass — the engine's "step 0d", run once per tick after
 * the AI interpreter (`stepAi`) and before the targeting pass. It evaluates the
 * unified {@link Doctrine} rules whose conditions are formation / spatial /
 * temporal / boolean-combo kinds (the kinds `stepAi`'s `effectiveDoctrineAi`
 * leaves unsatisfied) and writes the resolved spatial / targeting / fire axes
 * onto the ship's transient `aiSpatial` / `aiTargeting` / `aiFire` fields, which
 * the Phase D movement and targeting consumers will read.
 *
 * GATED to a complete no-op (zero CPU, zero field writes) for any fleet whose
 * ships' doctrine.rules contain no formation / spatial / temporal / boolean
 * condition. Every preset fleet's doctrines compile to ship-self-only rules (or
 * none), so preset battles are byte-identical — the pinned frame hashes do not
 * move. The gate is the load-bearing correctness invariant for determinism.
 *
 * Determinism: all aggregates and per-ship iteration proceed in instanceId-sorted
 * order (see `sortedById`). Pure predicates over the live frame state; no RNG,
 * no clock, no Map-insertion-order dependence (only sorted arrays are iterated).
 */

import { shipSelfSatisfied, type TriggerContext } from "@/domain/simulation/engine/ai";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { DeploymentReference } from "@/domain/simulation/engine/movement";
import type {
  Condition,
  DoctrineAction,
  FormationReference,
  ModuleKind,
} from "@/schema/ai";
import type { ShipClassification } from "@/schema/armor";

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** The ship-self condition kinds `stepAi` already evaluates via
 *  `effectiveDoctrineAi`. The formation pass needs to handle every OTHER kind
 *  (formation state, spatial-between-refs, temporal, boolean combos). Kept as a
 *  plain array + predicate so the gate scan is a single pass over a ship's
 *  rules. If a new ship-self kind is added to {@link Condition}, add it here too
 *  — the `ai.unit.test.ts` Phase 10 sync assertion covers the legacy Trigger
 *  set, and this array is the parallel list for the unified Condition. */
const SHIP_SELF_CONDITION_KINDS = new Set<Condition["kind"]>([
  "shieldBelow",
  "structureBelow",
  "targetInRange",
  "targetClass",
  "moduleDestroyed",
  "outclassed",
]);

/** Whether a condition is a formation / spatial / temporal / boolean kind — one
 *  the formation pass must evaluate (rather than `stepAi`). Pure. */
function isFormationCondition(condition: Condition): boolean {
  return !SHIP_SELF_CONDITION_KINDS.has(condition.kind);
}

/**
 * Whether ANY rule across ANY ship carries a formation / spatial / temporal /
 * boolean condition — i.e. whether the gate should open at all. If every rule's
 * condition is a ship-self kind (or ships have no rules), the pass returns
 * immediately without building aggregates or writing fields, so a preset fleet
 * pays nothing and its frame output is byte-identical. Pure.
 */
function anyFormationCondition(ships: readonly SimShip[]): boolean {
  for (const ship of ships) {
    if (ship.phantom !== undefined) continue;
    for (const rule of ship.doctrine.rules) {
      if (isFormationCondition(rule.condition)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * Per-formation aggregate state, derived each tick the gate opens. Centroid is
 * the unweighted mean of alive members' positions; `strengthFraction` is the
 * alive members' combined (structure + shield) over the formation's initial
 * combined (structure + shield). The "initial" denominator is approximated from
 * the ships present THIS TICK — see {@link buildAggregates} for the documented
 * choice. `engaged` is true when any alive member holds a target this tick.
 */
interface FormationAggregate {
  centroidX: number;
  centroidY: number;
  /** Alive (structure + shield) / initial (structure + shield), in [0, 1]. */
  strengthFraction: number;
  memberCount: number;
  /** Whether any alive member has a target this tick. */
  engaged: boolean;
  /** InstanceId of the formation's first (flagship) member, instanceId-sorted.
   *  Undefined when the formation has no members at all. */
  flagshipId: string | undefined;
  /** Whether the flagship (first instanceId-sorted member) is alive this tick. */
  flagshipAlive: boolean;
}

/**
 * Build the per-formation aggregate map. DETERMINISM INVARIANT: every ship is
 * iterated in instanceId-sorted order (`sortedById`), so the summations that
 * feed `centroidX`/`centroidY`/`strengthFraction` accumulate in the same order
 * across runs. Floating-point summation order is the only thing that could make
 * these totals differ run-to-run; sorting the ships once and iterating only the
 * sorted array fixes the order. The aggregate Map itself is keyed by formationId
 * (a stable string), never iterated for summation — only point-looked-up — so
 * its insertion order is irrelevant.
 *
 * `initialStrength` choice: a true initial (tick-0) strength is not carried on
 * SimShip (it would have to be captured by the checkpoint). We approximate it as
 * the SUM OF `maxStructure + maxShield` over every member present this tick —
 * alive OR dead. A dead member still carries its maxes (they are fixed for
 * life), so this is a stable per-formation denominator that does not drift as
 * members die, and it equals the tick-0 strength exactly when no member has
 * been removed from the `ships` array (members are never removed mid-battle;
 * they flip `alive` to false). This is the deterministic, checkpoint-free
 * approximation; the numerator is the sum of CURRENT `structure + shield` over
 * alive members only.
 */
function buildAggregates(
  sortedById: readonly SimShip[],
): Map<string, FormationAggregate> {
  // First pass: collect members per formation id. A ship with no formationId is
  // its own singleton (so a formation-using rule on a lone ship still resolves).
  // Membership covers every formation id in the ship's formationChain (the
  // inclusive ancestor path) plus the ship's own formationId.
  const membersByFormation = new Map<string, SimShip[]>();
  for (const ship of sortedById) {
    if (ship.phantom !== undefined) continue;
    const ids = new Set<string>();
    if (ship.formationId !== undefined) ids.add(ship.formationId);
    if (ship.formationChain !== undefined) {
      for (const id of ship.formationChain) ids.add(id);
    }
    if (ids.size === 0) ids.add(ship.instanceId);
    for (const id of ids) {
      let list = membersByFormation.get(id);
      if (list === undefined) {
        list = [];
        membersByFormation.set(id, list);
      }
      list.push(ship);
    }
  }

  const aggregates = new Map<string, FormationAggregate>();
  for (const [formationId, members] of membersByFormation) {
    // members is already instanceId-sorted (it is a filter of sortedById, and
    // sortedById was built once at the top).
    let aliveCount = 0;
    let cx = 0;
    let cy = 0;
    let aliveStrength = 0;
    let initialStrength = 0;
    let engaged = false;
    for (const m of members) {
      initialStrength += m.maxStructure + m.maxShield;
      if (!m.alive) continue;
      aliveCount += 1;
      cx += m.x;
      cy += m.y;
      aliveStrength += m.structure + m.shield;
      if (m.target !== undefined) engaged = true;
    }
    const flagship = members[0];
    const strengthFraction =
      initialStrength > 0 ? aliveStrength / initialStrength : 0;
    aggregates.set(formationId, {
      centroidX: aliveCount > 0 ? cx / aliveCount : 0,
      centroidY: aliveCount > 0 ? cy / aliveCount : 0,
      strengthFraction,
      memberCount: aliveCount,
      engaged,
      flagshipId: flagship?.instanceId,
      flagshipAlive: flagship?.alive ?? false,
    });
  }
  return aggregates;
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

/** A resolved world point, or undefined when the reference cannot be resolved
 *  (e.g. an enemy formation of a role that does not exist). Undefined makes any
 *  condition that uses it unsatisfied — references are total, never errors. */
interface Point {
  x: number;
  y: number;
}

/** Resolve the formation(s) on a side matching a role. Returns the formation ids
 *  in instanceId-sorted order of their first member. Pure. */
function formationsOfRole(
  side: "attacker" | "defender",
  role: string,
  sortedById: readonly SimShip[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const ship of sortedById) {
    if (ship.phantom !== undefined) continue;
    if (ship.side !== side) continue;
    if (ship.role !== role) continue;
    if (ship.formationId === undefined) continue;
    if (seen.has(ship.formationId)) continue;
    seen.add(ship.formationId);
    ids.push(ship.formationId);
  }
  return ids;
}

/** Resolve the formation on the enemy side whose heaviest member's
 *  classification matches `archetype`. "Heaviest" = greatest current mass among
 *  alive members (deterministic: instanceId tie-break via the sorted input).
 *  Returns the first such formation id, or undefined. Pure. */
function formationOfArchetype(
  ownerSide: "attacker" | "defender",
  archetype: ShipClassification,
  sortedById: readonly SimShip[],
): string | undefined {
  const enemySide: "attacker" | "defender" = ownerSide === "attacker" ? "defender" : "attacker";
  // Group enemy ships by formationId, tracking each formation's heaviest member.
  const heaviestByFormation = new Map<string, { mass: number; classification: ShipClassification }>();
  for (const ship of sortedById) {
    if (ship.phantom !== undefined) continue;
    if (ship.side !== enemySide) continue;
    if (!ship.alive) continue;
    if (ship.formationId === undefined) continue;
    const prev = heaviestByFormation.get(ship.formationId);
    if (prev === undefined || ship.mass > prev.mass) {
      heaviestByFormation.set(ship.formationId, {
        mass: ship.mass,
        classification: ship.classification,
      });
    }
  }
  for (const [formationId, info] of heaviestByFormation) {
    if (info.classification === archetype) return formationId;
  }
  return undefined;
}

/** A pure resolver closure: given a FormationReference and the ship it is being
 *  resolved for, return the world point or undefined. Closes over the sorted
 *  ship list, the aggregate map, the id index, and the deployment reference. */
interface ResolveReference {
  (ref: FormationReference, ship: SimShip): Point | undefined;
}

function makeResolver(
  sortedById: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
  aggregates: ReadonlyMap<string, FormationAggregate>,
  deployment: DeploymentReference,
): ResolveReference {
  const resolve: ResolveReference = (ref, ship) => {
    switch (ref.kind) {
      case "self":
        return { x: ship.x, y: ship.y };
      case "friendly": {
        const ids = formationsOfRole(ship.side, ref.role, sortedById);
        const id = ids[0];
        if (id === undefined) return undefined;
        const agg = aggregates.get(id);
        return agg !== undefined && agg.memberCount > 0
          ? { x: agg.centroidX, y: agg.centroidY }
          : undefined;
      }
      case "enemy": {
        const enemySide: "attacker" | "defender" =
          ship.side === "attacker" ? "defender" : "attacker";
        const ids = formationsOfRole(enemySide, ref.role, sortedById);
        const id = ids[0];
        if (id === undefined) return undefined;
        const agg = aggregates.get(id);
        return agg !== undefined && agg.memberCount > 0
          ? { x: agg.centroidX, y: agg.centroidY }
          : undefined;
      }
      case "enemyArchetype": {
        const id = formationOfArchetype(ship.side, ref.archetype, sortedById);
        if (id === undefined) return undefined;
        const agg = aggregates.get(id);
        return agg !== undefined && agg.memberCount > 0
          ? { x: agg.centroidX, y: agg.centroidY }
          : undefined;
      }
      case "point":
        // Waypoints are not yet authored. A condition using a point reference is
        // unsatisfied until they exist — return undefined rather than erroring.
        return undefined;
      case "deployment": {
        const d = ship.side === "attacker" ? deployment.attacker : deployment.defender;
        return d !== undefined ? { x: d.x, y: d.y } : undefined;
      }
      case "target": {
        if (ship.target === undefined) return undefined;
        const t = byId.get(ship.target);
        return t !== undefined ? { x: t.x, y: t.y } : undefined;
      }
      case "between": {
        const a = resolve(ref.a, ship);
        const b = resolve(ref.b, ship);
        if (a === undefined || b === undefined) return undefined;
        const alpha = ref.alpha;
        return { x: a.x + alpha * (b.x - a.x), y: a.y + alpha * (b.y - a.y) };
      }
    }
  };
  return resolve;
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

/** Context the formation predicates close over. Pure values; no mutation. */
interface FormationContext {
  tick: number;
  aggregates: ReadonlyMap<string, FormationAggregate>;
  resolve: ResolveReference;
  /** The ship-self trigger context (shield/structure fractions, target, etc.),
   *  built once per ship by the caller so ship-self conditions inside an
   *  `all`/`any` combo reuse it. */
  self: TriggerContext;
  byId: ReadonlyMap<string, SimShip>;
  sortedById: readonly SimShip[];
}

/** Look up the aggregate for a formation reference, or undefined when the
 *  reference does not resolve to a known formation. Used by the formation-state
 *  conditions (formationStrength / Loss / Engaged / Destroyed / flagshipLost). */
function aggregateForReference(
  ref: FormationReference,
  ship: SimShip,
  ctx: FormationContext,
): FormationAggregate | undefined {
  // The reference must resolve to a point that came from a formation centroid.
  // Re-resolve through the same path and match by centroid coordinates is
  // fragile; instead, resolve the formation id directly by inspecting the
  // reference's shape. Only references that name a formation (friendly/enemy/
  // enemyArchetype) — or `self`/`target`/`deployment`/`between` reduced to a
  // formation centroid — can yield an aggregate. For simplicity and because the
  // schema's formation-state conditions are authored against formation
  // references, we resolve the formation id by replaying the same role/archetype
  // lookup the resolver uses, then read its aggregate.
  switch (ref.kind) {
    case "friendly": {
      const ids = formationsOfRole(ship.side, ref.role, ctx.sortedById);
      const id = ids[0];
      return id !== undefined ? ctx.aggregates.get(id) : undefined;
    }
    case "enemy": {
      const enemySide: "attacker" | "defender" =
        ship.side === "attacker" ? "defender" : "attacker";
      const ids = formationsOfRole(enemySide, ref.role, ctx.sortedById);
      const id = ids[0];
      return id !== undefined ? ctx.aggregates.get(id) : undefined;
    }
    case "enemyArchetype": {
      const id = formationOfArchetype(ship.side, ref.archetype, ctx.sortedById);
      return id !== undefined ? ctx.aggregates.get(id) : undefined;
    }
    case "self": {
      // A ship's own formation. If the ship has no formationId it is its own
      // singleton aggregate (keyed by instanceId in buildAggregates).
      const id = ship.formationId ?? ship.instanceId;
      return ctx.aggregates.get(id);
    }
    default:
      // point / deployment / target / between do not name a formation directly.
      return undefined;
  }
}

/**
 * Derive a coarse battle phase from the global aggregate state. Heuristic, kept
 * simple and documented:
 * - `opening`   — fewer than half of any side's formations are engaged (fleets
 *                 still closing).
 * - `contact`   — at least one formation per side is engaged but neither side
 *                 has lost substantial strength (both sides > 50% strength).
 * - `closing`   — one side has dropped below 50% strength (the fight is winding
 *                 down toward a decision).
 * - `mopUp`     — one side has dropped below 25% strength (mopping up).
 *
 * The phase is the WEAKEST side's status: the side closest to defeat governs
 * the label. Derived purely from the aggregate map; deterministic.
 */
function derivePhase(
  ship: SimShip,
  ctx: FormationContext,
): "opening" | "contact" | "closing" | "mopUp" {
  let friendlyStrength = 0;
  let friendlyFormationCount = 0;
  let friendlyEngaged = 0;
  let enemyStrength = 0;
  let enemyFormationCount = 0;
  let enemyEngaged = 0;
  // Iterate the aggregate map's entries in formationId-sorted order so the
  // sums are deterministic. The aggregate map is keyed by formationId; we sort
  // its keys here once. (Aggregates are point-looked-up elsewhere; this is the
  // only place the map is iterated for summation, and it is sorted.)
  const formationIds = [...ctx.aggregates.keys()].sort();
  // To attribute a formation to a side we need a member; look it up via byId on
  // the flagship id recorded in the aggregate.
  for (const id of formationIds) {
    const agg = ctx.aggregates.get(id);
    if (agg === undefined) continue;
    if (agg.flagshipId === undefined) continue;
    const flagship = ctx.byId.get(agg.flagshipId);
    if (flagship === undefined) continue;
    const sideMatch = flagship.side === ship.side;
    if (sideMatch) {
      friendlyStrength += agg.strengthFraction;
      friendlyFormationCount += 1;
      if (agg.engaged) friendlyEngaged += 1;
    } else {
      enemyStrength += agg.strengthFraction;
      enemyFormationCount += 1;
      if (agg.engaged) enemyEngaged += 1;
    }
  }
  const friendlyAvg =
    friendlyFormationCount > 0 ? friendlyStrength / friendlyFormationCount : 1;
  const enemyAvg =
    enemyFormationCount > 0 ? enemyStrength / enemyFormationCount : 1;
  const weaker = Math.min(friendlyAvg, enemyAvg);
  const engagedRatio =
    friendlyFormationCount + enemyFormationCount > 0
      ? (friendlyEngaged + enemyEngaged) /
        (friendlyFormationCount + enemyFormationCount)
      : 0;
  if (weaker < 0.25) return "mopUp";
  if (weaker < 0.5) return "closing";
  if (engagedRatio >= 0.5) return "contact";
  return "opening";
}

/**
 * Whether a formation / spatial / temporal / boolean condition holds for the
 * ship. Pure. Ship-self conditions are delegated to {@link shipSelfSatisfied}
 * via the pre-built `ctx.self` so the same predicate that drives `stepAi` drives
 * a ship-self leaf inside an `all`/`any` combo here. Undefined-resolving
 * references make their condition unsatisfied (return false), never error.
 */
function formationConditionSatisfied(
  condition: Condition,
  ship: SimShip,
  ctx: FormationContext,
): boolean {
  // Ship-self kinds: reuse the legacy predicate for parity with stepAi.
  const self = shipSelfSatisfied(condition, ctx.self);
  if (self !== undefined) return self;

  switch (condition.kind) {
    case "formationStrength": {
      const agg = aggregateForReference(condition.reference, ship, ctx);
      if (agg === undefined) return false;
      return condition.direction === "below"
        ? agg.strengthFraction < condition.threshold
        : agg.strengthFraction > condition.threshold;
    }
    case "formationLoss": {
      const agg = aggregateForReference(condition.reference, ship, ctx);
      if (agg === undefined) return false;
      // Lost fraction: strength has dropped by more than `lostFraction`.
      // strengthFraction = 1 - lostFraction at the threshold.
      return agg.strengthFraction < 1 - condition.lostFraction;
    }
    case "formationEngaged": {
      const agg = aggregateForReference(condition.reference, ship, ctx);
      return agg !== undefined && agg.engaged;
    }
    case "formationDestroyed": {
      const agg = aggregateForReference(condition.reference, ship, ctx);
      return agg !== undefined && agg.memberCount === 0;
    }
    case "flagshipLost": {
      const agg = aggregateForReference(condition.reference, ship, ctx);
      return agg !== undefined && !agg.flagshipAlive;
    }
    case "range": {
      const a = ctx.resolve(condition.a, ship);
      const b = ctx.resolve(condition.b, ship);
      if (a === undefined || b === undefined) return false;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      return dist >= condition.min && dist <= condition.max;
    }
    case "crossingLine": {
      // The ship (reference) has crossed the line from lineA to lineB. Computed
      // by the sign of the 2D cross product of (lineB - lineA) × (ship - lineA):
      // "crossing" is satisfied when the ship is on the far side of the line
      // relative to its own deployment centroid (a simple, documented heuristic
      // — the line's normal points away from the owner's deployment). A more
      // rigorous crossing (tracking the prior tick's side) lands with Phase D.
      const lineA = ctx.resolve(condition.lineA, ship);
      const lineB = ctx.resolve(condition.lineB, ship);
      const ref = ctx.resolve(condition.reference, ship);
      if (lineA === undefined || lineB === undefined || ref === undefined) {
        return false;
      }
      const deployment = ctx.resolve({ kind: "deployment" }, ship);
      if (deployment === undefined) return false;
      const lineDx = lineB.x - lineA.x;
      const lineDy = lineB.y - lineA.y;
      const shipCross = lineDx * (ref.y - lineA.y) - lineDy * (ref.x - lineA.x);
      const depCross = lineDx * (deployment.y - lineA.y) - lineDy * (deployment.x - lineA.x);
      // Crossed = ship is on the opposite side of the line from its deployment.
      return Math.sign(shipCross) !== Math.sign(depCross) && shipCross !== 0;
    }
    case "flanking": {
      // A simple flanking test: the ship is closer to the enemy formation's
      // centroid than the friendly formation's centroid is — i.e. the ship has
      // pushed past its own line toward the enemy. Kept deliberately simple;
      // a true flanking geometry (angle relative to the enemy's facing) lands
      // with Phase D.
      const ref = ctx.resolve(condition.reference, ship);
      if (ref === undefined) return false;
      const friendly = ctx.resolve({ kind: "friendly", role: ship.role ?? "" }, ship);
      // Without a friendly centroid of the ship's own role, flanking is
      // unsatisfied (we have no "line" to be past).
      if (friendly === undefined) return false;
      // Find the nearest enemy centroid for the distance comparison.
      let nearestEnemy: Point | undefined;
      let nearestDist = Infinity;
      for (const s of ctx.sortedById) {
        if (s.phantom !== undefined) continue;
        if (s.side === ship.side) continue;
        if (!s.alive) continue;
        const p = { x: s.x, y: s.y };
        const d = Math.hypot(p.x - ref.x, p.y - ref.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemy = p;
        }
      }
      if (nearestEnemy === undefined) return false;
      const distToEnemy = Math.hypot(nearestEnemy.x - ref.x, nearestEnemy.y - ref.y);
      const distToFriendly = Math.hypot(friendly.x - ref.x, friendly.y - ref.y);
      return distToEnemy < distToFriendly;
    }
    case "localSuperiority": {
      // Local superiority: within a local band (the ship's own radius scaled),
      // friendly strength exceeds enemy strength by at least `minRatio`. Kept
      // simple: compare the ship's formation's strengthFraction against the
      // enemy's nearest formation's strengthFraction.
      const ref = ctx.resolve(condition.reference, ship);
      if (ref === undefined) return false;
      const friendlyAgg = aggregateForReference(
        { kind: "self" },
        ship,
        ctx,
      );
      if (friendlyAgg === undefined) return false;
      // Nearest enemy formation by centroid.
      let nearestEnemyAgg: FormationAggregate | undefined;
      let nearestDist = Infinity;
      for (const [id, agg] of ctx.aggregates) {
        void id;
        const flagshipId = agg.flagshipId;
        if (flagshipId === undefined) continue;
        const flagship = ctx.byId.get(flagshipId);
        if (flagship === undefined || flagship.side === ship.side) continue;
        const d = Math.hypot(agg.centroidX - ref.x, agg.centroidY - ref.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestEnemyAgg = agg;
        }
      }
      if (nearestEnemyAgg === undefined) return false;
      return friendlyAgg.strengthFraction >= nearestEnemyAgg.strengthFraction * condition.minRatio;
    }
    case "phase": {
      return derivePhase(ship, ctx) === condition.phase;
    }
    case "tickAfter": {
      return ctx.tick >= condition.tick;
    }
    case "all": {
      for (const sub of condition.of) {
        if (!formationConditionSatisfied(sub, ship, ctx)) return false;
      }
      return true;
    }
    case "any": {
      for (const sub of condition.of) {
        if (formationConditionSatisfied(sub, ship, ctx)) return true;
      }
      return false;
    }
    default: {
      // Exhaustiveness: any unhandled ship-self kind is caught above; reaching
      // here means a future condition kind this pass does not yet evaluate.
      // Return false (condition unsatisfied) rather than erroring, so an
      // unimplemented kind never crashes the simulation.
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-ship application
// ---------------------------------------------------------------------------

/**
 * Apply a fired rule's {@link DoctrineAction} to the ship's transient formation
 * fields. ONLY the spatial / targeting.mode / fire axes are written here — the
 * stance / crew / cohesion / retreat axes are already handled by `stepAi`'s
 * `effectiveDoctrineAi` (which reads the same doctrine and writes `aiStance` /
 * `aiFocusFire` / etc.). Writing them here too would double-apply; the
 * formation pass fills precisely the axes `stepAi` cannot (the spatial /
 * targeting / fire axes that have no static read yet). Mutates `ship`.
 */
function applyDoctrineAxes(ship: SimShip, action: DoctrineAction): void {
  if (action.spatial !== undefined) ship.aiSpatial = action.spatial;
  if (action.targeting !== undefined) ship.aiTargeting = action.targeting.mode;
  if (action.fire !== undefined) ship.aiFire = action.fire;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the formation-doctrine pass for every ship. Called once per tick AFTER
 * `stepAi` and BEFORE the targeting pass. For each ship with a doctrine, the
 * rules are evaluated first-match-wins; the fired rule's `then` action writes
 * the spatial / targeting / fire axes onto the ship's transient `ai*` fields.
 *
 * GATE: if no ship's doctrine carries a formation / spatial / temporal / boolean
 * condition, the pass returns immediately — no aggregates, no writes — so a
 * preset fleet (ship-self-only or empty rules) is byte-identical and pays zero
 * cost. The transient fields stay at their construction-time `undefined`.
 *
 * The pass RESETS every ship's `aiSpatial` / `aiTargeting` / `aiFire` to
 * undefined at the top (when the gate opens) so a rule that fired last tick but
 * not this tick clears its override — a one-tick override does not stick. This
 * reset is the only mutation performed for ships whose doctrine fires no rule
 * this tick; it keeps the fields in lockstep with the current tick's evaluation.
 */
export function stepFormationDoctrine(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
  tick: number,
  deployment: DeploymentReference,
): void {
  // GATE: zero cost + zero writes for fleets with no formation conditions.
  if (!anyFormationCondition(ships)) return;

  // Sort ships once by instanceId; every iteration below uses this sorted array
  // so all summations and membership scans are deterministic across runs.
  const sortedById = ships
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );

  const aggregates = buildAggregates(sortedById);
  const resolve = makeResolver(sortedById, byId, aggregates, deployment);

  for (const ship of sortedById) {
    // Reset this tick's transient fields regardless of phantom status / doctrine
    // content, so a stale override from the prior tick never survives.
    ship.aiSpatial = undefined;
    ship.aiTargeting = undefined;
    ship.aiFire = undefined;
    // Phantoms carry no doctrine of their own.
    if (ship.phantom !== undefined) continue;
    if (!ship.alive) continue;

    // Build the ship-self context once per ship so ship-self leaves inside an
    // all/any combo reuse it. Mirrors stepAi's buildContext, kept local so this
    // module stays self-contained.
    const target =
      ship.target !== undefined ? byId.get(ship.target) : undefined;
    const targetRange =
      target !== undefined
        ? Math.hypot(target.x - ship.x, target.y - ship.y)
        : undefined;
    const destroyed = new Set<ModuleKind>();
    if (ship.modules !== undefined) {
      for (const m of ship.modules) {
        if (!m.alive) destroyed.add(m.kind);
      }
    }
    const self: TriggerContext = {
      shieldFraction: ship.maxShield > 0 ? ship.shield / ship.maxShield : 0,
      structureFraction:
        ship.maxStructure > 0 ? ship.structure / ship.maxStructure : 0,
      targetRange,
      targetClassification: target?.classification,
      destroyedModuleKinds: destroyed,
      outclassed: false,
    };

    const ctx: FormationContext = {
      tick,
      aggregates,
      resolve,
      self,
      byId,
      sortedById,
    };

    for (const rule of ship.doctrine.rules) {
      if (formationConditionSatisfied(rule.condition, ship, ctx)) {
        applyDoctrineAxes(ship, rule.then);
        break;
      }
    }
  }
}
