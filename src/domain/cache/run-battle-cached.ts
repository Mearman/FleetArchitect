/**
 * Test-only read-through cache wrapper around {@link runBattle}. Deterministic
 * battles are computed once then reused across test runs: the first call
 * simulates and persists the result to disk, and every subsequent call with the
 * same determinants returns the cached frames instantly. For the heavy
 * integration suites (the 306-matchup faction matrix is the headline) this turns
 * a cold minute-scale run into a warm near-instant one, and the key
 * self-invalidates on engine changes because it incorporates the algorithm
 * signature — no manual cache-busting step.
 *
 * Test-only by design: {@link DiskSimCache} lazy-imports `node:fs` only inside
 * its methods, so this module tree-shakes out of the browser bundle, and only
 * test files import it. The production read-through cache lives at the UI edge
 * in `CachingBattleRunner` (memory + IndexedDB tiers); this is the node/disk
 * mirror for the test environment, where the filesystem is the natural durable
 * store.
 *
 * The cache key mirrors `CachingBattleRunner` exactly: the resolved ships, the
 * anomaly set, the seed, the effective maxTicks, the SimConfig snapshot, and the
 * refactor-stable algorithm signature. Fleet ids and result metadata (id,
 * playedAt) are excluded by the key derivation, so two matchups that differ only
 * in fleet naming hit the same entry. The engine mutates its inputs in place,
 * so a miss clones the ships before running — the cached result is independent
 * of the caller's objects.
 */

import { DiskSimCache } from "@/domain/cache/disk-cache";
import { deriveCacheKey } from "@/domain/cache/key";
import { engineAlgorithmSignature } from "@/domain/cache/algorithm-signature";
import { getSimConfig } from "@/domain/cache/sim-config";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import type { Catalog } from "@/domain/catalog";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/** Module-level cache so every call in a test run shares one disk tier. */
const cache = new DiskSimCache();

/**
 * Run a deterministic battle, returning the cached result for these inputs when
 * one exists and simulating + persisting otherwise. The result's frames are
 * byte-identical whether the call hit the cache or simulated fresh — the
 * determinism regression suite pins that contract.
 */
export async function runBattleCached(
  inputs: BattleInputs,
): Promise<BattleResult> {
  const signature = await engineAlgorithmSignature();
  const key = await deriveCacheKey(inputs, getSimConfig(), signature);

  const hit = await cache.get(key);
  if (hit !== undefined) return hit;

  const result = runBattle({
    ...inputs,
    ships: structuredClone(inputs.ships),
  });
  await cache.set(key, result);
  return result;
}

/**
 * Resolved-ship template store keyed by fleet object then side.
 * `resolveFleetToCombatShips` is pure (no `Math.random` / `Date`) and the
 * `designs` / `catalog` are constant per test run, so the resolved template is
 * reused across battles that deploy the same fleet on the same side. Every
 * caller gets a `structuredClone` of the template, so each owns a fresh copy
 * (safe even for direct-`runBattle` byte-identity tests); a clone is
 * value-identical to a fresh resolve, so frames are unchanged.
 */
const resolveTemplates = new WeakMap<
  Fleet,
  Map<"attacker" | "defender", CombatShip[]>
>();

/**
 * Cross-call resolve cache for tests: returns the resolved combat ships for a
 * fleet/side, reusing a stored template and cloning it on every call. Mirrors
 * {@link resolveFleetToCombatShips} exactly on a miss; the only difference
 * across calls is that the work is done once per (fleet, side).
 */
export function resolveFleetToCombatShipsCached(
  fleet: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  catalog: Catalog,
  side: "attacker" | "defender",
): CombatShip[] {
  let sideMap = resolveTemplates.get(fleet);
  if (sideMap === undefined) {
    sideMap = new Map<"attacker" | "defender", CombatShip[]>();
    resolveTemplates.set(fleet, sideMap);
  }
  let template = sideMap.get(side);
  if (template === undefined) {
    template = resolveFleetToCombatShips(fleet, designs, catalog, side);
    sideMap.set(side, template);
  }
  return structuredClone(template);
}
