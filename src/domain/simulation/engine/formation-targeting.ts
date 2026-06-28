/**
 * Phase D targeting consumer for the formation-doctrine pass: applies the
 * relational targeting modes (`threatsTo` / `membersOf` / `class` / `inZone` /
 * `sameAs` / `pdPriority` / `none`) as a FILTER on the visible-enemy candidate
 * set, GATED on the ship carrying an `aiTargeting` override. When `aiTargeting`
 * is undefined (every preset ship — the pass is a gated no-op for presets), the
 * existing scalar scoring runs unchanged and preset battles are byte-identical.
 *
 * Determinism: every relational set is built in instanceId-sorted order; the
 * filter is a pure predicate over each candidate's identity. No RNG, no clock,
 * no Map iteration for summation.
 */

import type { EnemyView } from "./targeting";
import type { SimShip } from "./types";
import { buildAggregates, makeResolver, type Point, type ResolveReference } from "./formation-doctrine";
import type { DeploymentReference } from "./movement";
import type { TargetingMode, FormationReference } from "@/schema/ai";

/**
 * Return the ship's base.targeting.mode when it is a RELATIONAL kind (not one of
 * the four scalar kinds the existing scoring path already handles). Scalar modes
 * return undefined so presets (which use nearest/weakest/strongest/highestCost)
 * stay byte-identical — the filter is skipped and targetPriorityOf scores them.
 */
function baseRelationalMode(ship: SimShip): TargetingMode | undefined {
  const mode = ship.doctrine.base.targeting?.mode;
  if (mode === undefined) return undefined;
  switch (mode.kind) {
    case "nearest":
    case "weakest":
    case "strongest":
    case "highestCost":
      return undefined;
    default:
      return mode;
  }
}

/** Context the relational filter closes over: the live enemy list (for set
 *  membership lookups), the byId index, the sorted ship list, and the
 *  reference resolver (for `threatsTo`/`membersOf`/`sameAs` formation
 *  resolution). Built once per tick by the engine and threaded through. */
export interface FormationTargetingContext {
  enemies: readonly SimShip[];
  byId: ReadonlyMap<string, SimShip>;
  sortedById: readonly SimShip[];
  resolve: ResolveReference;
}

/** Build the formation-targeting context once per tick. Mirrors the structures
 *  the formation-doctrine pass itself builds (instanceId-sorted ships,
 *  per-formation aggregates, the reference resolver) so a ship's `aiTargeting`
 *  override resolves against the same world state the pass used. Pure; harmless
 *  for a preset fleet (every `aiTargeting` is undefined → the filter is the
 *  identity and the PD bias is zero — byte-identical). */
export function buildFormationTargetingContext(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
  deployment: DeploymentReference,
  points: ReadonlyMap<string, Point>,
): FormationTargetingContext {
  const sortedById = ships
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );
  const aggregates = buildAggregates(sortedById);
  const resolve = makeResolver(sortedById, byId, aggregates, deployment, points);
  return { enemies: ships, byId, sortedById, resolve };
}

/**
 * The set of enemy instanceIds that ARE members of the formation a reference
 * resolves to. Used by `membersOf` (shoot the referenced formation) and
 * `sameAs` (shoot what the referenced formation's members target). Returns the
 * empty set when the reference does not resolve to a known formation. Pure;
 * the set is built in instanceId-sorted order.
 */
function enemyMembersOfReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
  // A formation on the enemy side. Resolve it the same way the formation-doctrine
  // pass does: by role (friendly/enemy) or archetype. Only enemy-side formations
  // are valid targets, so resolve against the enemy side.
  const enemySide: "attacker" | "defender" =
    ship.side === "attacker" ? "defender" : "attacker";
  const ids: string[] = [];
  const seen = new Set<string>();
  // Collect enemy formation ids matching the reference's role/archetype.
  const roleOf = (r: FormationReference): string | undefined => {
    if (r.kind === "enemy") return r.role;
    return undefined;
  };
  const role = roleOf(ref);
  if (role !== undefined) {
    for (const s of ctx.sortedById) {
      if (s.phantom !== undefined) continue;
      if (s.side !== enemySide) continue;
      if (s.role !== role) continue;
      if (s.formationId === undefined) continue;
      if (seen.has(s.formationId)) continue;
      seen.add(s.formationId);
      ids.push(s.formationId);
    }
  } else if (ref.kind === "enemyArchetype") {
    // Heaviest-member classification per formation (mirrors the pass).
    const heaviest = new Map<
      string,
      { mass: number; classification: SimShip["classification"] }
    >();
    for (const s of ctx.sortedById) {
      if (s.phantom !== undefined) continue;
      if (s.side !== enemySide) continue;
      if (!s.alive) continue;
      if (s.formationId === undefined) continue;
      const prev = heaviest.get(s.formationId);
      if (prev === undefined || s.mass > prev.mass) {
        heaviest.set(s.formationId, {
          mass: s.mass,
          classification: s.classification,
        });
      }
    }
    for (const [formationId, info] of heaviest) {
      if (info.classification === ref.archetype) ids.push(formationId);
    }
  }
  // Now collect every alive enemy whose formationId is in `ids`.
  const members = new Set<string>();
  if (ids.length === 0) return members;
  const idSet = new Set(ids);
  for (const s of ctx.enemies) {
    if (!s.alive) continue;
    if (s.formationId !== undefined && idSet.has(s.formationId)) {
      members.add(s.instanceId);
    }
  }
  return members;
}

/**
 * The set of enemy instanceIds whose current target is a member of the friendly
 * formation a reference resolves to — i.e. the enemies attacking that formation.
 * Used by `threatsTo` (protect). Returns the empty set when the reference does
 * not resolve to a known friendly formation. Pure.
 */
function enemyThreatsToReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
  // The friendly formation being protected. Resolve it to its member set on the
  // ship's own side.
  const roleOf = (r: FormationReference): string | undefined => {
    if (r.kind === "friendly") return r.role;
    if (r.kind === "self") return ship.role;
    return undefined;
  };
  const role = roleOf(ref);
  const protectIds = new Set<string>();
  if (role !== undefined) {
    for (const s of ctx.sortedById) {
      if (s.phantom !== undefined) continue;
      if (s.side !== ship.side) continue;
      if (s.role !== role) continue;
      if (s.formationId !== undefined) protectIds.add(s.formationId);
      protectIds.add(s.instanceId);
    }
  }
  if (ref.kind === "self") {
    // Protect the ship's own formation: include its own members.
    if (ship.formationId !== undefined) protectIds.add(ship.formationId);
    protectIds.add(ship.instanceId);
  }
  if (protectIds.size === 0) return new Set();
  // An enemy is a threat if its current target is in protectIds.
  const threats = new Set<string>();
  for (const e of ctx.enemies) {
    if (!e.alive) continue;
    if (e.target !== undefined && protectIds.has(e.target)) {
      threats.add(e.instanceId);
    }
  }
  return threats;
}

/**
 * Filter the visible-enemy candidate set by the ship's relational targeting
 * mode. Returns the filtered list (a subset of `visible`), or `visible` itself
 * when the ship has no `aiTargeting` override (the gate — preset ships are
 * unchanged). `none` returns an empty list (hold fire vs ships; PD may still
 * fire). `pdPriority` is handled as a bias in scoring, not a filter, so it
 * returns `visible` here. Relational modes that resolve to no set return the
 * empty list (no candidates — the rule is unsatisfiable this tick).
 *
 * Pure: a filter predicate over each candidate's identity, built from
 * instanceId-sorted scans.
 */
export function filterVisibleByTargeting(
  ship: SimShip,
  visible: EnemyView[],
  ctx: FormationTargetingContext,
): EnemyView[] {
  // Fall back to base.targeting.mode for relational kinds (threatsTo/membersOf/
  // etc.) — the scalar kinds (nearest/weakest/strongest/highestCost) are handled
  // by targetPriorityOf in the existing scoring path, so only relational modes
  // need the filter here.
  const mode: TargetingMode | undefined = ship.aiTargeting ?? baseRelationalMode(ship);
  if (mode === undefined) {
    // GATE: no override. Return the input list (the existing scalar scoring
    // path runs unchanged). Callers do not mutate, so no copy is needed.
    return visible;
  }
  switch (mode.kind) {
    case "none":
      return [];
    case "nearest":
    case "weakest":
    case "strongest":
    case "highestCost":
      // Scalar modes: the existing scoreEnemy handles priority. No filter.
      return visible;
    case "pdPriority":
      // Defensive fire prefers missiles/drones. Handled as a bias in scoreEnemy,
      // not a filter, so PD-priority ships still pick the best of the visible
      // set (which includes phantoms — drones/decoys — when they are in
      // awareness). No filter here.
      return visible;
    case "class": {
      const cls = mode.classification;
      return visible.filter((v) => {
        const enemy = ctx.byId.get(v.instanceId);
        return enemy !== undefined && enemy.classification === cls;
      });
    }
    case "membersOf": {
      const members = enemyMembersOfReference(ship, mode.reference, ctx);
      return visible.filter((v) => members.has(v.instanceId));
    }
    case "threatsTo": {
      const threats = enemyThreatsToReference(ship, mode.reference, ctx);
      return visible.filter((v) => threats.has(v.instanceId));
    }
    case "sameAs": {
      // Shoot what the referenced formation's members target. Collect the
      // targets held by the referenced formation's members, then filter visible
      // to those.
      const ref = mode.reference;
      // Resolve the friendly formation whose members' targets we follow.
      const roleOf = (r: FormationReference): string | undefined => {
        if (r.kind === "friendly") return r.role;
        if (r.kind === "self") return ship.role;
        return undefined;
      };
      const role = roleOf(ref);
      const followFormationIds = new Set<string>();
      if (role !== undefined) {
        for (const s of ctx.sortedById) {
          if (s.phantom !== undefined) continue;
          if (s.side !== ship.side) continue;
          if (s.role !== role) continue;
          if (s.formationId !== undefined) followFormationIds.add(s.formationId);
        }
      }
      if (ref.kind === "self" && ship.formationId !== undefined) {
        followFormationIds.add(ship.formationId);
      }
      const targets = new Set<string>();
      for (const s of ctx.sortedById) {
        if (s.side !== ship.side) continue;
        if (
          s.formationId !== undefined &&
          followFormationIds.has(s.formationId) &&
          s.target !== undefined
        ) {
          targets.add(s.target);
        }
      }
      return visible.filter((v) => targets.has(v.instanceId));
    }
    case "inZone":
      // Waypoints/zones are not yet authored. A condition using inZone is
      // unsatisfiable — no candidates — rather than erroring.
      return [];
  }
}

/**
 * The defensive-fire bias for `pdPriority`: a positive additive term for
 * phantom (drone/decoy) candidates, zero otherwise. Applied in scoreEnemy as a
 * bias, not a filter, so a PD-priority ship still ranks real ships below
 * phantoms when no phantom is visible. Returns 0 when the ship has no
 * `pdPriority` override (the gate). Pure.
 */
export function pointDefenseBias(ship: SimShip, enemyId: string, byId: ReadonlyMap<string, SimShip>): number {
  const mode = ship.aiTargeting ?? baseRelationalMode(ship);
  if (mode?.kind !== "pdPriority") return 0;
  const enemy = byId.get(enemyId);
  // A phantom (drone or decoy) is the missile-like thing in the ship candidate
  // set; prefer it. The bias magnitude is 1 (the same scale as the normalised
  // priority score), enough to surface a phantom above any real ship.
  return enemy?.phantom !== undefined ? 1 : 0;
}
