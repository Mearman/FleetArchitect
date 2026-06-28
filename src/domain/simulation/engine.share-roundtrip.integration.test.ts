import { describe, expect, it } from "vitest";

import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import { flattenShipLeaves } from "@/schema/formation";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { CombatShip } from "@/domain/simulation/types";
import {
  decodeShareable,
  encodeShareable,
  referencedTemplates,
} from "@/sharing/data-url";
import type { BattleShare, Shareable } from "@/sharing/data-url";

/**
 * End-to-end guard for the sharing codec: a fleet (or whole battle) encoded to
 * a share string and decoded back must resolve and simulate byte-identically to
 * its un-encoded original. Because the simulation is deterministic, any drift
 * between the original and the round-tripped entity — a dropped doctrine, a
 * altered formation slot, a remapped design that shifts the column order —
 * surfaces as a frame-stream mismatch here.
 *
 * Two paths are covered:
 *  - BATTLE share: both preset fleets + their referenced designs bundled and
 *    remapped to synthesised ids (`d0`, `d1`, …). The frame stream carries no
 *    designId, so the remap is invisible to the comparison.
 *  - FLEET share: a single fleet with no design bundle. Leaf design ids survive
 *    verbatim, so the resolved CombatShips (designId included) match exactly.
 */

const MAX_TICKS = 30;
const SEED = 42;

/** Find a preset fleet by id, narrowing the readonly array to a single Fleet. */
function findFleet(id: string): Fleet {
  const fleet = presetFleets.find((f) => f.id === id);
  if (fleet === undefined) throw new Error(`preset fleet ${id} not found`);
  return fleet;
}

/**
 * The designs referenced by a set of fleets, keyed by id. Mirrors the
 * `referencedDesigns` helper in `useBattleUrlSync`: walks each fleet's formation
 * leaves, collects their designIds, and filters the preset catalogue. The map
 * shape is what `resolveFleetToCombatShips` consumes.
 */
function referencedDesignMap(fleets: readonly Fleet[]): Map<string, ShipDesign> {
  const ids = new Set<string>();
  for (const fleet of fleets) {
    for (const leaf of flattenShipLeaves(fleet.formation)) {
      ids.add(leaf.designId);
    }
  }
  const map = new Map<string, ShipDesign>();
  for (const design of presetDesigns) {
    if (ids.has(design.id)) map.set(design.id, design);
  }
  return map;
}

/**
 * Resolve both sides of a matchup into a single CombatShip array ready for
 * `runBattle`. The same catalog instance is reused across both resolutions so
 * the per-cell module clones come from identical catalogue data.
 */
function resolveMatchup(
  attacker: Fleet,
  defender: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  cat: ReturnType<typeof catalog>,
): CombatShip[] {
  return [
    ...resolveFleetToCombatShips(attacker, designs, cat, "attacker"),
    ...resolveFleetToCombatShips(defender, designs, cat, "defender"),
  ];
}

// ---------------------------------------------------------------------------
// Battle share: encode -> decode must replay byte-identically.
// ---------------------------------------------------------------------------

describe("share round-trip: battle", () => {
  it("a shared battle (attacker + defender + designs) replays byte-identical frames and winner", () => {
    const originalAttacker = findFleet("preset-fleet-carrier-group");
    const originalDefender = findFleet("preset-fleet-drone-swarm");

    // The self-contained battle payload: both fleets, every design either
    // references, the templates either references (none here, but the closure
    // follows the canonical pattern so it stays correct if one is added), and
    // the seed.
    const battle: BattleShare = {
      attacker: originalAttacker,
      defender: originalDefender,
      designs: [...referencedDesignMap([originalAttacker, originalDefender]).values()],
      templates: referencedTemplates([originalAttacker, originalDefender], []),
      anomalies: [],
      seed: SEED,
    };

    const encoded = encodeShareable({ kind: "battle", value: battle });
    const decoded: Shareable = decodeShareable(encoded);
    expect(decoded.kind).toBe("battle");
    if (decoded.kind !== "battle") return;

    // Original resolves against the preset designs (keyed by their original
    // ids); the decoded battle resolves against its rebuilt designs, whose ids
    // the codec remapped to `d0`, `d1`, … The decoded fleets' leaf designId
    // references were remapped in lockstep, so each side resolves completely.
    const cat = catalog();
    const originalShips = resolveMatchup(
      originalAttacker,
      originalDefender,
      referencedDesignMap([originalAttacker, originalDefender]),
      cat,
    );
    const decodedDesigns = new Map<string, ShipDesign>(
      decoded.value.designs.map((d) => [d.id, d]),
    );
    const decodedShips = resolveMatchup(
      decoded.value.attacker,
      decoded.value.defender,
      decodedDesigns,
      cat,
    );

    const originalResult = runBattle({
      ships: originalShips,
      attackerFleetId: "fa",
      defenderFleetId: "fd",
      anomalies: [],
      seed: SEED,
      maxTicks: MAX_TICKS,
    });
    const decodedResult = runBattle({
      ships: decodedShips,
      attackerFleetId: "fa",
      defenderFleetId: "fd",
      anomalies: [],
      seed: SEED,
      maxTicks: MAX_TICKS,
    });

    // Byte-identity of the frame stream is the load-bearing assertion: every
    // ship snapshot, beam, projectile, and debris record must match exactly.
    // `runBattle` stamps a non-deterministic `id` / `playedAt`, so the whole
    // BattleResult is not compared — frames and winner are the replay contract.
    expect(JSON.stringify(decodedResult.frames)).toBe(
      JSON.stringify(originalResult.frames),
    );
    expect(decodedResult.winner).toBe(originalResult.winner);
  });
});

// ---------------------------------------------------------------------------
// Fleet share: a standalone fleet round-trips and resolves identically.
// ---------------------------------------------------------------------------

describe("share round-trip: fleet", () => {
  // Each preset exercises a different formation shape: the carrier group is a
  // nested tree (root line of carrier + escort sub-formations, each with its
  // own pattern layout and leaf doctrines); the drone swarm is a flat column.
  const fleetIds: string[] = [
    "preset-fleet-carrier-group",
    "preset-fleet-drone-swarm",
  ];

  it.each(fleetIds)(
    "a shared standalone fleet (%s) resolves to identical CombatShips",
    (fleetId) => {
      const original = findFleet(fleetId);

      // A fleet share carries no designs — the recipient looks them up from
      // their own catalogue. Leaf designId strings therefore survive verbatim
      // (no battle-style remap), so the resolved ships match designId-and-all.
      const encoded = encodeShareable({
        kind: "fleet",
        value: { fleet: original, templates: [] },
      });
      const decoded = decodeShareable(encoded);
      expect(decoded.kind).toBe("fleet");
      if (decoded.kind !== "fleet") return;

      // Both original and decoded resolve against the SAME preset design map:
      // the decoded fleet's leaf designIds are the original strings.
      const designs = referencedDesignMap([original]);
      const cat = catalog();
      const originalShips = resolveFleetToCombatShips(
        original,
        designs,
        cat,
        "attacker",
      );
      const decodedShips = resolveFleetToCombatShips(
        decoded.value.fleet,
        designs,
        cat,
        "attacker",
      );

      expect(JSON.stringify(decodedShips)).toBe(JSON.stringify(originalShips));
    },
  );
});
