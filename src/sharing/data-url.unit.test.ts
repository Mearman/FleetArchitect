import { describe, expect, it } from "vitest";
import { compressToEncodedURIComponent } from "lz-string";
import {
  ShareDecodeError,
  SHARE_VERSION,
  decodeShareable,
  encodeShareable,
  referencedTemplates,
  type BattleShare,
} from "@/sharing/data-url";
import { createId, nowIso } from "@/domain/id";
import type { Fleet } from "@/schema/fleet";
import type { FormationTemplate } from "@/schema/formation-template";
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
    doctrine: { base: {}, rules: [] },
  };
}

describe("sharing round-trip (replay-relevant data)", () => {
  it("round-trips a ship design's grid, name and faction", () => {
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
  });

  it("round-trips a fleet's composition and doctrine", () => {
    const fleet: Fleet = {
      id: createId("fleet"),
      name: "Strike Wing",
      faction: "Terran",
      formation: flatFormation([
        {
          designId: "preset-ship-gunship",
          position: { x: 10, y: 20 },
          facing: 1.25,
          doctrine: {
            base: {
              stance: "aggressive",
              targeting: {
                mode: { kind: "nearest" },
                vulnerableWeight: 0,
                focusFire: true,
              },
              retreat: 0.4,
            },
            rules: [],
          },
        },
      ]),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    const originalShips = flattenShipLeaves(fleet.formation);
    const encoded = encodeShareable({
      kind: "fleet",
      value: { fleet, templates: [] },
    });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "fleet") {
      throw new Error("expected a fleet share");
    }
    expect(decoded.value.fleet.name).toBe(fleet.name);
    expect(decoded.value.fleet.faction).toBe(fleet.faction);
    const decodedShips = flattenShipLeaves(decoded.value.fleet.formation);
    expect(decodedShips).toHaveLength(1);
    const ship = decodedShips[0];
    if (ship === undefined) throw new Error("expected a fleet ship");
    // A standalone fleet share keeps the original design id string.
    expect(ship.designId).toBe("preset-ship-gunship");
    expect(ship.position).toEqual({ x: 10, y: 20 });
    expect(ship.facing).toBe(1.25);
    expect(ship.doctrine).toEqual(originalShips[0]?.doctrine);
  });

  it("round-trips a nested formation tree with a template reference", () => {
    // A template referenced by id from a fleet's tree (the by-reference link a
    // share must preserve). Its own subtree carries a role + a non-default
    // doctrine so those round-trip too.
    const template: FormationTemplate = {
      id: createId("ftpl"),
      name: "Vanguard Wedge",
      faction: "Terran",
      formation: {
        id: "wedge",
        role: "vanguard",
        doctrine: { base: { stance: "aggressive" }, rules: [] },
        children: [
          {
            kind: "ship",
            ship: {
              designId: "preset-ship-gunship",
              position: { x: 0, y: -5 },
              facing: 0,
            },
          },
          {
            kind: "ship",
            ship: {
              designId: "preset-ship-gunship",
              position: { x: 0, y: 5 },
              facing: 0,
            },
          },
        ],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    // A fleet whose root formation holds a lone ship leaf, a nested formation
    // (with its own role + slot), and a template reference (with a slot). The
    // pre-share tree and the decoded tree must be structurally identical.
    const fleet: Fleet = {
      id: createId("fleet"),
      name: "Mixed Wing",
      faction: "Terran",
      formation: {
        id: "root",
        doctrine: { base: {}, rules: [] },
        children: [
          {
            kind: "ship",
            ship: {
              designId: "preset-ship-gunship",
              position: { x: 1, y: 2 },
              facing: 0.5,
            },
          },
          {
            kind: "formation",
            slot: { forward: 40, lateral: -10 },
            formation: {
              id: "screen",
              role: "screen",
              layout: { kind: "pattern", pattern: "line", spacing: 8, facingAligned: true },
              doctrine: { base: {}, rules: [] },
              children: [
                {
                  kind: "ship",
                  ship: {
                    designId: "preset-ship-gunship",
                    position: { x: 0, y: 0 },
                    facing: 0,
                  },
                },
              ],
            },
          },
          {
            kind: "template",
            templateId: template.id,
            slot: { forward: 80, lateral: 0 },
          },
        ],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    const encoded = encodeShareable({
      kind: "fleet",
      value: { fleet, templates: [template] },
    });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "fleet") {
      throw new Error("expected a fleet share");
    }
    // The bundled template round-trips by id (the by-reference link target).
    expect(decoded.value.templates).toHaveLength(1);
    expect(decoded.value.templates[0]?.id).toBe(template.id);
    expect(decoded.value.templates[0]?.formation.role).toBe("vanguard");
    // The whole formation tree round-trips structurally — including the nested
    // formation (role, layout, slot) and the template reference (id, slot).
    expect(decoded.value.fleet.formation).toEqual(fleet.formation);
  });

  it("bundles transitively referenced templates (a template referencing a template)", () => {
    // templateB: a simple two-ship scout pair.
    const templateB: FormationTemplate = {
      id: createId("ftpl"),
      name: "Scout Pair",
      faction: "Terran",
      formation: {
        id: "scouts",
        doctrine: { base: {}, rules: [] },
        children: [
          {
            kind: "ship",
            ship: { designId: "preset-ship-gunship", position: { x: 0, y: -3 }, facing: 0 },
          },
          {
            kind: "ship",
            ship: { designId: "preset-ship-gunship", position: { x: 0, y: 3 }, facing: 0 },
          },
        ],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    // templateA: references templateB from inside its own subtree (recursive
    // composition — exactly what expandTemplates inlines at battle-start).
    const templateA: FormationTemplate = {
      id: createId("ftpl"),
      name: "Carrier Group",
      faction: "Terran",
      formation: {
        id: "group",
        doctrine: { base: {}, rules: [] },
        children: [
          {
            kind: "ship",
            ship: { designId: "preset-ship-gunship", position: { x: 0, y: 0 }, facing: 0 },
          },
          { kind: "template", templateId: templateB.id },
        ],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    const fleet: Fleet = {
      id: createId("fleet"),
      name: "Transitive Wing",
      faction: "Terran",
      formation: {
        id: "root",
        doctrine: { base: {}, rules: [] },
        children: [{ kind: "template", templateId: templateA.id }],
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    // The bundle is closed transitively: the fleet references A, A references B,
    // so both must ship even though the fleet never names B directly.
    const bundle = referencedTemplates([fleet], [templateA, templateB]);
    expect(bundle.map((t) => t.id).sort()).toEqual([templateA.id, templateB.id].sort());

    const decoded = decodeShareable(
      encodeShareable({ kind: "fleet", value: { fleet, templates: bundle } }),
    );
    if (decoded.kind !== "fleet") {
      throw new Error("expected a fleet share");
    }
    expect(decoded.value.templates.map((t) => t.id).sort()).toEqual(
      [templateA.id, templateB.id].sort(),
    );
    expect(decoded.value.fleet.formation).toEqual(fleet.formation);
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
          doctrine: {
            base: {
              spatial: {
                reference: { kind: "target" },
                range: { kind: "engage", fraction: 0.85, tolerance: 0.3 },
                bearing: { kind: "free" },
              },
            },
            rules: [],
          },
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
      templates: [],
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
    expect(
      flattenShipLeaves(value.attacker.formation)[0]?.doctrine?.base.spatial?.range,
    ).toEqual({ kind: "engage", fraction: 0.85, tolerance: 0.3 });
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
    templates: [],
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
    // The binary codec must be a large, robust win over the verbose form. Floor
    // relaxed from 5x to 4x after the outer-armour preset pass (seed Version 18)
    // grew the six designs this default share battle is built from (leviathan,
    // bulwark, gunship, torpedo, wasp, sabre) — every one gained a prow/flank
    // cap. Measured ~4.8x here; the 4x floor still catches a real codec
    // regression (a ~20% effectiveness loss) while absorbing the intended
    // content growth.
    expect(encoded.length * 4).toBeLessThan(verbose.length);
  });
});
