/**
 * Tick-invariant formation-reference index for the formation-doctrine pass. The
 * (side, role) -> formation-id list and (side, archetype) -> first formation-id
 * mappings that friendly/enemy/enemyArchetype references resolve against.
 *
 * Historically `formationsOfRole` / `formationOfArchetype` rebuilt these via a
 * fresh O(ships) scan + Set/Map allocation on every reference resolution. They
 * are in fact tick-invariant (a single pass over the same instanceId-sorted ship
 * list the pass already builds), so they are computed once here and consumed by
 * O(1) lookup from `makeResolver` (formation-doctrine + movement call sites) and
 * `aggregateForReference`.
 *
 * Determinism: a single pass over the sorted ship list reproduces the prior
 * per-call encounter order and the strict-`>` heaviest tie-break exactly. No
 * floating-point arithmetic is involved — this is purely an allocation/rescan
 * elimination, byte-identical to the per-call scans it replaces.
 */

import type { SimShip } from "./types";
import type { ShipClassification } from "@/schema/armor";

/** The tick-invariant reference index. Built once per tick from the
 *  instanceId-sorted ship list; read-only after build. */
export interface FormationReferenceIndex {
  /** side -> role -> formation ids in instanceId-sorted encounter order of their
   *  first matching member (deduped by formationId). Absent key = no formation
   *  of that (side, role) exists. */
  readonly byRole: ReadonlyMap<
    "attacker" | "defender",
    ReadonlyMap<string, readonly string[]>
  >;
  /** side -> archetype -> first formation id (instanceId-sorted encounter order)
   *  whose heaviest ALIVE member's classification matches. Absent key = no match.
   *  Reproduces the prior `formationOfArchetype` strict-`>` heaviest +
   *  first-in-encounter-order selection exactly. */
  readonly byArchetype: ReadonlyMap<
    "attacker" | "defender",
    ReadonlyMap<ShipClassification, string>
  >;
}

/** Shared empty list returned when a (side, role) lookup misses, so the lookups
 *  never allocate. Read-only; consumers only ever read `[0]`. */
const EMPTY_ROLE_LIST: readonly string[] = [];

/**
 * Build the index from the instanceId-sorted ship list. A single pass
 * reproduces exactly what the prior per-call scans produced:
 * - `formationsOfRole` iterated sortedById filtering (side, role, formationId
 *   defined), deduping by formationId in encounter order — the `byRole` lists
 *   are accumulated the same way (ships with no role are skipped: the query role
 *   is always a defined string, and `undefined !== string` filtered them out).
 * - `formationOfArchetype` tracked the heaviest ALIVE member per formation
 *   (strict `>`, so the first heaviest wins ties) then returned the first
 *   formation in encounter order whose classification matched — `byArchetype`
 *   records that first-match per (side, archetype) from the same heaviest map
 *   (Map insertion order = first encounter of each formationId among alive
 *   members). Pure.
 */
export function buildFormationReferenceIndex(
  sortedById: readonly SimShip[],
): FormationReferenceIndex {
  const byRole = new Map<"attacker" | "defender", Map<string, string[]>>();
  // Per-(side, role) dedup sets, used only during build.
  const byRoleSeen = new Map<"attacker" | "defender", Map<string, Set<string>>>();
  const heaviestByFormation = new Map<
    "attacker" | "defender",
    Map<string, { mass: number; classification: ShipClassification }>
  >();

  for (const ship of sortedById) {
    if (ship.phantom !== undefined) continue;
    if (ship.formationId === undefined) continue;
    const side = ship.side;
    const role = ship.role;

    // Role index (no alive filter — formationsOfRole never filtered on alive).
    if (role !== undefined) {
      let roleMap = byRole.get(side);
      if (roleMap === undefined) {
        roleMap = new Map();
        byRole.set(side, roleMap);
      }
      let seenMap = byRoleSeen.get(side);
      if (seenMap === undefined) {
        seenMap = new Map();
        byRoleSeen.set(side, seenMap);
      }
      let list = roleMap.get(role);
      if (list === undefined) {
        list = [];
        roleMap.set(role, list);
      }
      let seen = seenMap.get(role);
      if (seen === undefined) {
        seen = new Set();
        seenMap.set(role, seen);
      }
      if (!seen.has(ship.formationId)) {
        seen.add(ship.formationId);
        list.push(ship.formationId);
      }
    }

    // Archetype index (alive members only — formationOfArchetype filtered alive).
    if (ship.alive) {
      let heavyMap = heaviestByFormation.get(side);
      if (heavyMap === undefined) {
        heavyMap = new Map();
        heaviestByFormation.set(side, heavyMap);
      }
      const prev = heavyMap.get(ship.formationId);
      if (prev === undefined || ship.mass > prev.mass) {
        heavyMap.set(ship.formationId, {
          mass: ship.mass,
          classification: ship.classification,
        });
      }
    }
  }

  // Derive per-(side, archetype) first-match in encounter (= insertion) order,
  // so the first formation recorded for a classification is the encounter-order
  // first match formationOfArchetype returned.
  const byArchetype = new Map<
    "attacker" | "defender",
    Map<ShipClassification, string>
  >();
  for (const [side, heavyMap] of heaviestByFormation) {
    const archMap = new Map<ShipClassification, string>();
    for (const [formationId, info] of heavyMap) {
      if (!archMap.has(info.classification)) {
        archMap.set(info.classification, formationId);
      }
    }
    byArchetype.set(side, archMap);
  }

  return { byRole, byArchetype };
}

/** Resolve the formation(s) on a side matching a role. Returns the formation ids
 *  in instanceId-sorted encounter order of their first member. O(1) lookup
 *  against the tick-invariant index; the returned list is the index's stored
 *  list (do not mutate). Pure. */
export function formationsOfRole(
  side: "attacker" | "defender",
  role: string,
  index: FormationReferenceIndex,
): readonly string[] {
  const roleMap = index.byRole.get(side);
  if (roleMap === undefined) return EMPTY_ROLE_LIST;
  const list = roleMap.get(role);
  if (list === undefined) return EMPTY_ROLE_LIST;
  return list;
}

/** Resolve the formation on the enemy side whose heaviest member's
 *  classification matches `archetype`. "Heaviest" = greatest current mass among
 *  alive members (deterministic: instanceId tie-break via the sorted input).
 *  Returns the first such formation id, or undefined. O(1) lookup against the
 *  tick-invariant index. Pure. */
export function formationOfArchetype(
  ownerSide: "attacker" | "defender",
  archetype: ShipClassification,
  index: FormationReferenceIndex,
): string | undefined {
  const enemySide: "attacker" | "defender" =
    ownerSide === "attacker" ? "defender" : "attacker";
  return index.byArchetype.get(enemySide)?.get(archetype);
}
