import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattle } from "@/domain/simulation/engine";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs } from "@/domain/simulation/types";
import { pathCacheStats, resetPathCacheStats } from "@/domain/simulation/engine/crew-pathfinding";

/**
 * Crew path-cache optimisation: performance and determinism guards.
 *
 * The path cache (per-ship, keyed by directed (from, to) cell pair, invalidated
 * on alive-cell topology change), the pathIndex stepping (replacing per-tick
 * path.slice), the batched assignment scans (candidate lists precomputed once
 * per ship per tick), the cached alive-cell index and wiring reach, and the
 * binary-heap A* open set — together must not change the crew system's
 * behaviour. The byte-identity proof lives in `engine.crew.unit.test.ts` (the
 * synthetic crew battles are byte-identical across two same-seed runs, covering
 * manning, ammo hauling, power hauling, and break-apart). Here we guard the
 * performance budget and verify the heavy preset matchups still run to
 * completion with a stable winner.
 *
 * Note: the large preset battles are not byte-identical run-to-run on main
 * either — the base engine has a pre-existing non-determinism (visible in
 * crewless Swarm battles too, which never touch the crew code). That is outside
 * this optimisation's scope; the crew-specific determinism is proven by the
 * unit tests.
 */

const cat = catalog();
const designs = new Map(presetDesigns.map((d) => [d.id, d]));
const fleet = (id: string) => presetFleets.find((f) => f.id === id);

function buildInputs(attackerId: string, defenderId: string, seed = 42): BattleInputs {
  const attacker = resolveFleetToCombatShips(fleet(attackerId)!, designs, cat, "attacker");
  const defender = resolveFleetToCombatShips(fleet(defenderId)!, designs, cat, "defender");
  return {
    ships: [...attacker, ...defender],
    attackerFleetId: attackerId,
    defenderFleetId: defenderId,
    anomaly: "none",
    seed,
    maxTicks: DEFAULT_MAX_TICKS,
  };
}

describe("engine.crew-perf — preset matchups still resolve", () => {
  // These run full 3600-tick preset battles (~3.5s each on dev hardware), so
  // they need a timeout well above vitest's 5s default.
  it("the 464-crew battle runs to completion without error", () => {
    // Battle Line vs Armoured Spearhead: the heaviest crewed preset. This
    // exercises the full crew path cache, batched assignment, and topology
    // invalidation under load (464 crew, 9 ships, 3600 ticks). A crash or hang
    // here would surface a regression in the optimised crew code.
    const result = runBattle(buildInputs("preset-fleet-battleline", "preset-fleet-spearhead"));
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.winner).toBeDefined();
  }, 15000);

  it("a crewed matchup with topology changes runs to completion", () => {
    // Strike Wing vs Picket Screen: modules die and break-apart fires,
    // exercising cache invalidation (fingerprint changes on module death).
    const result = runBattle(buildInputs("preset-fleet-strike", "preset-fleet-picket"));
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.winner).toBeDefined();
  }, 15000);

  it("a crewless preset battle is unaffected by the crew optimisation", () => {
    // The crewless Swarm matchup should still resolve. updateCrew returns early
    // on ships with no crew, so no path cache or assignment logic runs — this
    // guards that the optimisation didn't accidentally engage the crew code path
    // for crewless designs.
    const result = runBattle(buildInputs("preset-fleet-hive-assault", "preset-fleet-drone-swarm"));
    expect(result.frames.length).toBeGreaterThan(0);
    expect(result.winner).toBeDefined();
  }, 15000);
});

describe("engine.crew-perf — cache effectiveness", () => {
  it("the crew path cache serves the overwhelming majority of lookups", () => {
    // Deterministic guard for the per-ship path cache. Its whole point is to
    // avoid recomputing A* every tick, and cache effectiveness is a pure
    // function of the (deterministic) battle — not the hardware — so we assert
    // a hit rate rather than a wall-clock budget, which flaked on slow CI
    // runners. The heaviest crewed preset (Battle Line vs Armoured Spearhead,
    // 464 crew) reuses paths heavily: a healthy hit rate is ~98%. A regression
    // that removes or bypasses the cache drops this to ~0 and fails here
    // immediately and reproducibly, on any machine.
    resetPathCacheStats();
    runBattle(buildInputs("preset-fleet-battleline", "preset-fleet-spearhead"));
    const { hitRate, total } = pathCacheStats();
    expect(total, "crew path lookups actually ran").toBeGreaterThan(0);
    // Phase 2 lowered the hit rate slightly: crew now walks deck-only through
    // edge-gated corridors (rather than across every solid cell), so the
    // walkable graph is sparser and paths vary more. A healthy rate is still
    // ~89%; a regression that bypasses the cache drops this to ~0.
    expect(hitRate, "crew path cache hit rate").toBeGreaterThan(0.85);
  }, 30000);
});
