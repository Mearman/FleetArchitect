import { describe, expect, it } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import {
  ShareDecodeError,
  SHARE_VERSION,
  decodeShareable,
  encodeShareable,
  type BattleShare,
} from "@/sharing/data-url";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import { flatFormation, flattenShipLeaves } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import { presetDesigns, presetFleets } from "@/data/presets";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattle } from "@/domain/simulation/engine";
import { catalog } from "@/data/catalog";

function sampleDesign(): ShipDesign {
  return {
    id: createId("design"),
    name: "Shared Fighter",
    faction: "Terran",
    grid: {
      cols: 3,
      rows: 1,
      cells: [
        { kind: "solid", substrate: true, surface: "deck", edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} }, equipment: { moduleId: "mod-pulse-laser", facing: 0 } },
        { kind: "solid", substrate: true, surface: "deck", edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} }, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
        { kind: "solid", substrate: true, surface: "armor", edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} } },
      ],
      connections: [],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
  };
}

describe("sharing round-trip (replay-relevant data)", () => {
  it("round-trips a ship design's grid, name, faction and AI posture", () => {
    const original = sampleDesign();
    const encoded = encodeShareable({ kind: "shipDesign", value: original });
    expect(typeof encoded).toBe("string");
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "shipDesign") {
      throw new Error("expected a shipDesign share");
    }
    // Replay-relevant fields are lossless; persistence metadata is dropped.
    expect(decoded.value.name).toBe(original.name);
    expect(decoded.value.faction).toBe(original.faction);
    expect(decoded.value.grid).toEqual(original.grid);
    expect(decoded.value.shipStance).toBe(original.shipStance);
    expect(decoded.value.crewPriority).toBe(original.crewPriority);
    expect(decoded.value.rules).toEqual(original.rules);
  });

  it("round-trips a fleet's composition and orders", () => {
    const fleet: Fleet = {
      id: createId("fleet"),
      name: "Strike Wing",
      faction: "Terran",
      formation: flatFormation([
        {
          designId: "preset-ship-gunship",
          position: { x: 10, y: 20 },
          facing: 1.25,
          orders: {
            ...defaultOrders,
            stance: "aggressive",
            focusFire: true,
            retreatThreshold: 0.4,
          },
        },
      ]),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    const originalShips = flattenShipLeaves(fleet.formation);
    const encoded = encodeShareable({ kind: "fleet", value: fleet });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "fleet") {
      throw new Error("expected a fleet share");
    }
    expect(decoded.value.name).toBe(fleet.name);
    expect(decoded.value.faction).toBe(fleet.faction);
    const decodedShips = flattenShipLeaves(decoded.value.formation);
    expect(decodedShips).toHaveLength(1);
    const ship = decodedShips[0];
    if (ship === undefined) throw new Error("expected a fleet ship");
    // A standalone fleet share keeps the original design id string.
    expect(ship.designId).toBe("preset-ship-gunship");
    expect(ship.position).toEqual({ x: 10, y: 20 });
    expect(ship.facing).toBe(1.25);
    expect(ship.orders).toEqual(originalShips[0]?.orders);
  });

  it("round-trips a whole battle's grids, factions, composition, orders, anomalies and seed", () => {
    const design = sampleDesign();
    const makeFleet = (name: string): Fleet => ({
      id: createId("fleet"),
      name,
      faction: "Terran",
      formation: flatFormation([
        {
          designId: design.id,
          position: { x: -100, y: 0 },
          facing: 0,
          orders: { ...defaultOrders, engageRange: "long" },
        },
      ]),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    });
    const battle: BattleShare = {
      attacker: makeFleet("Attacker"),
      defender: makeFleet("Defender"),
      designs: [design],
      anomalies: ["asteroidField"],
      seed: 42,
    };
    const encoded = encodeShareable({ kind: "battle", value: battle });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "battle") {
      throw new Error("expected a battle share");
    }
    const { value } = decoded;
    expect(value.anomalies).toEqual(["asteroidField"]);
    expect(value.seed).toBe(42);
    expect(value.designs).toHaveLength(1);
    expect(value.designs[0]?.grid).toEqual(design.grid);
    expect(value.designs[0]?.faction).toBe(design.faction);
    expect(value.attacker.faction).toBe("Terran");
    expect(value.defender.faction).toBe("Terran");
    // The single design is remapped to index 0 -> synthesised id "d0", and
    // every fleet ship's designId rewritten to match.
    expect(flattenShipLeaves(value.attacker.formation)[0]?.designId).toBe(
      value.designs[0]?.id,
    );
    expect(flattenShipLeaves(value.defender.formation)[0]?.designId).toBe(
      value.designs[0]?.id,
    );
    expect(flattenShipLeaves(value.attacker.formation)[0]?.orders.engageRange).toBe(
      "long",
    );
  });

  it("rejects an older share version with ShareDecodeError", () => {
    const legacy = { v: SHARE_VERSION - 1, type: "shipDesign", data: {} };
    const encoded = compressToEncodedURIComponent(JSON.stringify(legacy));
    expect(() => decodeShareable(encoded)).toThrow(ShareDecodeError);
  });

  it("throws ShareDecodeError on a corrupt payload", () => {
    expect(() => decodeShareable("!!!not-a-valid-payload!!!")).toThrow(
      ShareDecodeError,
    );
  });
});

/**
 * Build the preset 5-v-7 battle the way the Battle Arena does: the first two
 * preset fleets, every preset design, a fixed anomalies and seed.
 */
function presetBattle(): BattleShare {
  const attacker = presetFleets[0];
  const defender = presetFleets[1];
  if (attacker === undefined || defender === undefined) {
    throw new Error("expected at least two preset fleets");
  }
  // Only the designs the two fleets actually reference — exactly what the Battle
  // Arena encodes (see useBattleUrlSync's referencedDesigns). Encoding the whole
  // 25-design preset library here would be unrepresentative of a real share.
  const referenced = new Set(
    [
      ...flattenShipLeaves(attacker.formation),
      ...flattenShipLeaves(defender.formation),
    ].map((s) => s.designId),
  );
  return {
    attacker,
    defender,
    designs: presetDesigns.filter((d) => referenced.has(d.id)),
    anomalies: ["asteroidField"],
    seed: 1234,
  };
}

/**
 * A fast 1-v-1 cut of the preset battle for the determinism guard: the first
 * ship of each preset fleet and only the designs they reference. The byte-
 * identical property holds for any battle, and grid-codec.unit.test.ts already
 * round-trips every preset grid exhaustively, so one small functional battle is
 * enough to prove the decoded inputs replay identically — without paying for a
 * full 12-ship, 3000-cell sim (which overruns the test timeout).
 */
function smallBattle(): BattleShare {
  const full = presetBattle();
  const attacker = {
    ...full.attacker,
    formation: flatFormation(
      flattenShipLeaves(full.attacker.formation).slice(0, 1),
    ),
  };
  const defender = {
    ...full.defender,
    formation: flatFormation(
      flattenShipLeaves(full.defender.formation).slice(0, 1),
    ),
  };
  const refIds = new Set(
    [
      ...flattenShipLeaves(attacker.formation),
      ...flattenShipLeaves(defender.formation),
    ].map((s) => s.designId),
  );
  return {
    ...full,
    attacker,
    defender,
    designs: full.designs.filter((d) => refIds.has(d.id)),
  };
}

/**
 * Enough ticks to exercise movement, targeting and firing on both sides; the
 * byte-identical property holds at any horizon, so a short run keeps the guard
 * fast without weakening it.
 */
const DETERMINISM_TICKS = 30;

function framesFor(battle: BattleShare) {
  const designs = new Map(battle.designs.map((d) => [d.id, d]));
  const ships = [
    ...resolveFleetToCombatShips(battle.attacker, designs, catalog(), "attacker"),
    ...resolveFleetToCombatShips(battle.defender, designs, catalog(), "defender"),
  ];
  return runBattle({
    ships,
    attackerFleetId: battle.attacker.id,
    defenderFleetId: battle.defender.id,
    anomalies: battle.anomalies,
    seed: battle.seed,
    maxTicks: DETERMINISM_TICKS,
  }).frames;
}

describe("sharing determinism and size", () => {
  it("encode -> decode of a preset battle replays byte-identical frames", () => {
    const original = smallBattle();
    const encoded = encodeShareable({ kind: "battle", value: original });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "battle") {
      throw new Error("expected a battle share");
    }

    const originalFrames = framesFor(original);
    const decodedFrames = framesFor(decoded.value);
    expect(JSON.stringify(decodedFrames)).toBe(JSON.stringify(originalFrames));
  });

  it("encodes a preset battle far smaller than the verbose-JSON baseline", () => {
    const battle = presetBattle();
    const encoded = encodeShareable({ kind: "battle", value: battle });
    // Baseline: the old verbose form (the whole battle as plain JSON) under the
    // SAME lz transport. Comparing against the actual baseline — not a raw
    // byte count — means the assertion tracks the real win and catches an
    // encoding regression (e.g. base64-of-binary defeating lz) that a loose
    // "< raw/10" bound would wave through.
    const verbose = compressToEncodedURIComponent(
      JSON.stringify({ v: 0, type: "battle", data: battle }),
    );
    // The binary codec must be a large, robust win: at least 5x smaller than the
    // verbose form (measured ~8.5x for this 6-design battle).
    expect(encoded.length * 5).toBeLessThan(verbose.length);
  });
});
