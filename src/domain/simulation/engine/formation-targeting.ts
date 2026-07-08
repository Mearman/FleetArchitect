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
import { anyFormationCondition } from "./formation-doctrine";
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

/** Whether any non-phantom ship carries a relational base targeting mode — one
 *  the filter resolves via `sortedById` (membersOf / threatsTo / sameAs / class
 *  / inZone / none / pdPriority). Such a mode activates the filter even with no
 *  formation condition (the formation pass is a no-op, but `baseRelationalMode`
 *  is read directly from doctrine). Used with {@link anyFormationCondition} to
 *  gate the per-tick context build. Pure. */
function anyRelationalBaseTargeting(ships: readonly SimShip[]): boolean {
  for (const ship of ships) {
    if (ship.phantom !== undefined) continue;
    if (baseRelationalMode(ship) !== undefined) return true;
  }
  return false;
}

/** Context the relational filter closes over: the live enemy list (for set
 *  membership lookups), the byId index, and the instanceId-sorted ship list
 *  (for `threatsTo` / `membersOf` / `sameAs` membership scans). The filter
 *  resolves relational references ITSELF via `sortedById` — it does not call a
 *  resolver closure — so no aggregate map or resolver is held here. Built once
 *  per tick by the engine and threaded through.
 *
 *  `referenceSets` memoises the resolved relational Sets (`membersOf` /
 *  `threatsTo` / `sameAs`) for the lifetime of this tick. Every resolver is a
 *  pure function of the frozen `ctx` plus the (ship, reference) pair, so two
 *  calls that resolve the same reference produce the identical Set — caching
 *  changes no value and no iteration order (the cache is only `.get`/`.set`,
 *  never iterated). Lazily created on first relational resolution, so the gated
 *  no-relational-modes case (where the filter never runs) pays nothing. */
export interface FormationTargetingContext {
  enemies: readonly SimShip[];
  byId: ReadonlyMap<string, SimShip>;
  sortedById: readonly SimShip[];
  referenceSets?: Map<string, Set<string>>;
}

/** Build the formation-targeting context once per tick. The filter needs only
 *  the instanceId-sorted ship list, the byId index, and the live enemy list; it
 *  no longer mirrors the formation pass's aggregates/resolver (it never read
 *  them — relational references are resolved in-place via `sortedById`), so
 *  those are not built here.
 *
 *  GATED: when no ship carries a formation condition AND no ship has a
 *  relational base targeting mode, every ship's effective targeting mode is
 *  undefined (`aiTargeting` is never written — the formation pass is itself
 *  gated to a no-op; `baseRelationalMode` is undefined for scalar base modes).
 *  `filterVisibleByTargeting` then returns `visible` unchanged and
 *  `pointDefenseBias` returns 0, so `sortedById` is never read. The per-tick
 *  sort is skipped and the inputs are returned directly — byte-identical, zero
 *  allocation. This is the common preset case (ship-self-only or empty rules,
 *  scalar base targeting). Pure. */
export function buildFormationTargetingContext(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
): FormationTargetingContext {
  if (!anyFormationCondition(ships) && !anyRelationalBaseTargeting(ships)) {
    // `sortedById` is unread in this branch (every mode is undefined), so the
    // unsorted input is passed through without an O(n log n) copy.
    return { enemies: ships, byId, sortedById: ships };
  }
  const sortedById = ships
    .slice()
    .sort((a, b) =>
      a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
    );
  return { enemies: ships, byId, sortedById };
}

/** Lazily create the per-tick relational-Set memo on the context. The context
 *  is rebuilt fresh every tick, so this is invalidated for free; it is only
 *  touched when a relational filter actually resolves (never in the gated
 *  scalar/preset case). */
function referenceSetCache(
  ctx: FormationTargetingContext,
): Map<string, Set<string>> {
  const existing = ctx.referenceSets;
  if (existing !== undefined) return existing;
  const created: Map<string, Set<string>> = new Map();
  ctx.referenceSets = created;
  return created;
}

/** Canonical, side-identity-free string for a reference's own fields. Two
 *  references that resolve to the same formation membership produce the same
 *  key; distinct references key apart. The relational filters only ever act on
 *  `friendly` / `enemy` / `enemyArchetype` / `self` (every other kind resolves
 *  to an empty Set), but all variants are keyed so the cache never collides. */
function referenceKey(ref: FormationReference): string {
  switch (ref.kind) {
    case "self":
      return "self";
    case "friendly":
      return "friendly:" + ref.role;
    case "enemy":
      return "enemy:" + ref.role;
    case "enemyArchetype":
      return "enemyArchetype:" + ref.archetype;
    case "point":
      return "point:" + ref.pointId;
    case "deployment":
      return "deployment";
    case "target":
      return "target";
    case "between":
      // `between` never resolves to a non-empty Set in the filters (roleOf is
      // undefined for it); recurse for a stable, distinct key.
      return (
        "between:" +
        referenceKey(ref.a) +
        ":" +
        referenceKey(ref.b) +
        ":" +
        ref.alpha
      );
  }
}

/** Extra key disambiguator for `self` references. `self` is inherently
 *  per-ship (the ship's own role/formation/identity feed the resolution), so
 *  the ship-identity fields are folded into the key to prevent cross-contamination
 *  between distinct ships' self-references. Appended ONLY for `self` (never for
 *  `friendly`/`enemy`/`enemyArchetype`, where cross-ship sharing across a
 *  squadron sharing the same resolved reference is the whole point of the
 *  cache). Over-cautious by design: it may forgo a hit between two identical
 *  self-referencing ships, but can never merge two distinct ones. */
function selfReferenceSuffix(ship: SimShip): string {
  return (
    ":" +
    (ship.role ?? "") +
    ":" +
    (ship.formationId ?? "") +
    ":" +
    ship.instanceId
  );
}

/** Memoise a relational-Set resolver on the per-tick context. `resolve` is a
 *  pure function of the frozen `ctx`, so its result is identical across callers
 *  that share the cache key this tick; the cached Set is only ever read (`.has`)
 *  by the filter, never mutated. */
function memoisedReferenceSet(
  ctx: FormationTargetingContext,
  key: string,
  resolve: () => Set<string>,
): Set<string> {
  const cache = referenceSetCache(ctx);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const result = resolve();
  cache.set(key, result);
  return result;
}

/**
 * The set of enemy instanceIds that ARE members of the formation a reference
 * resolves to. Used by `membersOf` (shoot the referenced formation) and
 * `sameAs` (shoot what the referenced formation's members target). Returns the
 * empty set when the reference does not resolve to a known formation. Pure;
 * the set is built in instanceId-sorted order.
 *
 * Memoised per tick via {@link memoisedReferenceSet}: a pure function of the
 * frozen `ctx` plus `(ship.side, ref)`, so every ship on the same side sharing
 * the same enemy reference reuses one Set instead of each rebuilding it. The
 * key carries the resolved side and reference identity but no per-ship field
 * (`membersOf` reads only `ship.side` and `ref`), maximising cross-ship hits
 * across a squadron targeting the same enemy formation.
 */
function enemyMembersOfReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
  const key = "membersOf:" + ship.side + ":" + referenceKey(ref);
  return memoisedReferenceSet(ctx, key, () =>
    resolveEnemyMembersOfReference(ship, ref, ctx),
  );
}

function resolveEnemyMembersOfReference(
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
 *
 * Memoised per tick: a pure function of the frozen `ctx` plus `(ship.side, ref)`
 * for `friendly` references (read by every escort in a same-side squadron
 * sharing the protectee, so they reuse one Set), and plus the ship's own
 * role/formation/identity for `self` (inherently per-ship, so the
 * {@link selfReferenceSuffix} keeps distinct ships' self-references apart).
 */
function enemyThreatsToReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
  const key =
    "threatsTo:" +
    ship.side +
    ":" +
    referenceKey(ref) +
    (ref.kind === "self" ? selfReferenceSuffix(ship) : "");
  return memoisedReferenceSet(ctx, key, () =>
    resolveEnemyThreatsToReference(ship, ref, ctx),
  );
}

function resolveEnemyThreatsToReference(
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
 * The set of enemy instanceIds targeted by the members of the friendly
 * formation a reference resolves to — i.e. "shoot what they shoot". Used by
 * `sameAs`. Returns the empty set when the reference resolves to no friendly
 * formation. Pure; built in instanceId-sorted order.
 *
 * Memoised per tick on the same key shape as `enemyThreatsToReference`:
 * `(ship.side, ref)` for `friendly` references (shared across a same-side
 * squadron), plus the ship's own role/formation/identity for `self`.
 */
function enemySameAsReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
  const key =
    "sameAs:" +
    ship.side +
    ":" +
    referenceKey(ref) +
    (ref.kind === "self" ? selfReferenceSuffix(ship) : "");
  return memoisedReferenceSet(ctx, key, () =>
    resolveEnemySameAsReference(ship, ref, ctx),
  );
}

function resolveEnemySameAsReference(
  ship: SimShip,
  ref: FormationReference,
  ctx: FormationTargetingContext,
): Set<string> {
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
  return targets;
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
      // Shoot what the referenced formation's members target.
      const targets = enemySameAsReference(ship, mode.reference, ctx);
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
