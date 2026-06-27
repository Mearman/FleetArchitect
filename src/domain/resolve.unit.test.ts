import { describe, expect, it } from "vitest";
import { resolveFleetPoints, resolveFleetToCombatShips } from "@/domain/resolve";
import { cellToLocal } from "@/domain/grid";
import { growArmourHull, padGrid } from "@/domain/hull-armour";
import { catalog } from "@/data/catalog";
import { nowIso } from "@/domain/id";
import type { Fleet } from "@/schema/fleet";
import { flatFormation } from "@/schema/formation";
import type { Formation } from "@/schema/formation";
import type { CellEdges, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

/** A two-cell ship: a pulse laser facing aft (π) at (col 0, row 0) and a
 *  fusion reactor at (col 1, row 0). */
function design(): ShipDesign {
  const grid: TileGrid = {
    cols: 2,
    rows: 1,
    cells: [
      { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-pulse-laser", facing: Math.PI } },
      { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
    ],
    connections: [],
  };
  return {
    id: "d-1",
    name: "Probe",
    faction: "Terran",
    grid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    doctrine: { base: {}, rules: [] },
  };
}

function fleet(): Fleet {
  return {
    id: "f-1",
    name: "F",
    faction: "Terran",
    formation: flatFormation([
      { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 },
    ]),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

describe("resolveFleetToCombatShips (grid)", () => {
  it("resolves each occupied cell to a module with grid-exact position", () => {
    const designs = new Map([["d-1", design()]]);
    const [ship] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    expect(ship).toBeDefined();
    if (ship === undefined) return;
    const modules = ship.modules ?? [];
    // The 2-cell design (pulse laser + reactor) is deck/equipment with no
    // armour, so the armour grow adds nothing — only padGrid runs, shifting the
    // cells by +1 on each axis (it does not change the module count).
    expect(modules).toHaveLength(2);

    // The grown grid is the reference for cell coordinates: padGrid shifts every
    // authored cell by +1 on each axis, so the laser moves from (0,0) to (1,1).
    const grownGrid = growArmourHull(padGrid(design().grid, 1));
    const laser = modules.find((m) => m.moduleId === "mod-pulse-laser");
    expect(laser).toBeDefined();
    if (laser === undefined) return;
    expect(laser.col).toBe(1);
    expect(laser.row).toBe(1);
    expect(laser.x).toBeCloseTo(cellToLocal(1, 1, grownGrid).x, 6);
    expect(laser.y).toBeCloseTo(cellToLocal(1, 1, grownGrid).y, 6);
    // A weapon's cell facing flows through to weaponFacing.
    expect(laser.weaponFacing).toBeCloseTo(Math.PI, 6);
  });

  it("derives classification from the occupied-cell count", () => {
    const designs = new Map([["d-1", design()]]);
    const [ship] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    expect(ship?.classification).toBe("fighter");
  });

  it("resolves armor cells to a 'hull'-effect module carrying the armor layer material's mass + surface HP", () => {
    // The armour cell sits at the centre of a 3x3 of deck so it is INTERIOR
    // (every 8-neighbour solid): the bevel never clips it, so it carries the
    // armour material's full HP — the clean expression of the material→HP map.
    // (Boundary cells carry material HP scaled by their outline coverage, exercised
    // by hull-outline / hull-armour integration tests.)
    const d: ShipDesign = {
      ...design(),
      grid: {
        cols: 3,
        rows: 3,
        cells: [
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "armor", edges: WALL },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
          { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
        ],
        connections: [],
      },
    };
    const [ship] = resolveFleetToCombatShips(
      { ...fleet() },
      new Map([["d-1", d]]),
      catalog(),
      "attacker",
    );
    const armor = (ship?.modules ?? []).find((m) => m.surface === "armor");
    const armorMaterial = catalog().armorMaterial("Terran");
    expect(armor).toBeDefined();
    expect(armorMaterial).toBeDefined();
    if (armor === undefined || armorMaterial === undefined) return;
    // Mass sums the armor + substrate material masses.
    const substrate = catalog().substrateMaterial("Terran");
    expect(armor.mass).toBe(armorMaterial.mass + (substrate?.mass ?? 0));
    expect(armor.maxSurfaceHp).toBe(armorMaterial.hp);
  });

  it("deploys the attacker left of the midline facing right and the defender mirrored", () => {
    // Deployment is edge-relative and auto-spaced (it ignores the authored
    // position, which rots as ship sizes change): attackers form up on the
    // left (x < 0) facing +x (0), defenders mirror to the right (x > 0)
    // facing −x (π), so the two sides meet across the arena.
    const designs = new Map([["d-1", design()]]);
    const [att] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    const [def] = resolveFleetToCombatShips(fleet(), designs, catalog(), "defender");
    expect(att?.position.x).toBeLessThan(0);
    expect(att?.facing).toBeCloseTo(0, 6);
    expect(def?.position.x).toBeGreaterThan(0);
    expect(def?.facing).toBeCloseTo(Math.PI, 6);
    // The two sides are mirror images across x = 0.
    expect(def?.position.x).toBeCloseTo(-(att?.position.x ?? 0), 6);
  });

  it("caps the edge inset at mutual sight when weapon reach out-ranges it (km combat)", () => {
    // Phase 3 (km combat): the deployment edge inset is the SMALLEST of three
    // terms — `maxRadius + maxWeaponRange`, the kinematic closing budget, and the
    // SIGHT CAP `maxRadius + sightReach / 2`. The probe design carries a pulse
    // laser (a beam reaching ~52 km) but NO engine, so its closing budget is 0,
    // and no sensor, so its sight reach is the innate ~5 km visual radius. With
    // weapon reach (~52 km) far exceeding sight, the sight cap binds: the fleet
    // forms up at `radius + visualLosRadius / 2`, placing the two lines exactly
    // one visual radius apart so they can SEE one another and engage (a fleet
    // deployed beyond its own sight would never acquire a target and stalemate).
    // This is the deliberate km-combat consequence: a myopic fleet fights close,
    // inside its long-reach guns, rather than spawning a hand-set step outside a
    // weapon range it cannot see across.
    const designs = new Map([["d-1", design()]]);
    const [att] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    const [def] = resolveFleetToCombatShips(fleet(), designs, catalog(), "defender");
    if (att === undefined || def === undefined) return;
    const pulseLaser = catalog().module("mod-pulse-laser");
    if (pulseLaser === undefined || pulseLaser.effect.kind !== "weapon") {
      throw new Error("test fixture: mod-pulse-laser must be a weapon");
    }
    const weaponRange = pulseLaser.effect.range;
    // The innate visual radius (metres) every sensorless ship has — the same
    // VISUAL_LOS_REFERENCE_M anchor `SIM.visualLosRadius` and the resolve sight
    // cap derive from (~5 km at the km combat scale).
    const visualLosRadius = 5_000;
    // Attacker forms up at `radius + visualLosRadius / 2` from the midline; its
    // centre sits `visualLosRadius / 2` inside the line (the `edgeInset - radius`
    // placement cancels the radius term against the sight cap's `radius`).
    expect(Math.abs(att.position.x)).toBeCloseTo(visualLosRadius / 2, 6);
    // The two sides sit symmetric about the midline.
    expect(att.position.x).toBeCloseTo(-def.position.x, 6);
    // The line-to-line gap equals the visual radius — within mutual sight, so the
    // fleets can detect and engage — and is far INSIDE the (much longer) weapon
    // reach, the inversion km combat introduces.
    const gap = def.position.x - att.position.x;
    expect(gap).toBeCloseTo(visualLosRadius, 6);
    expect(gap).toBeLessThan(weaponRange);
  });
});

describe("resolveFleetToCombatShips (formation identity)", () => {
  // A flat fleet and a nested fleet that deploy the SAME ships in the SAME DFS
  // order must produce byte-identical columns (positions, facings, instanceIds)
  // — the formation structure changes only the stamped formationId/chain/role,
  // never the deployment geometry. This is the byte-identical column invariant
  // the formation overhaul must hold.

  function flatFleet(): Fleet {
    return {
      ...fleet(),
      formation: flatFormation([
        { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 },
        { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 },
      ]),
    };
  }

  /** A nested fleet whose ship-leaf DFS order matches the flat fleet above:
   *  root(div) -> [ship, formation(squad, role "vanguard") -> [ship, ship]].
   *  The first ship is a direct child of root; the next two sit in a "squad"
   *  sub-formation carrying a role. Pre-order DFS yields the same three-ship
   *  sequence as the flat fleet. */
  function nestedFleet(): Fleet {
    const squad: Formation = {
      id: "squad",
      role: "vanguard",
      doctrine: { base: {}, rules: [] },
      children: [
        { kind: "ship", ship: { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 } },
        { kind: "ship", ship: { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 } },
      ],
    };
    const root: Formation = {
      id: "root",
      role: "line",
      doctrine: { base: {}, rules: [] },
      children: [
        { kind: "ship", ship: { designId: "d-1", position: { x: -100, y: 20 }, facing: 0 } },
        { kind: "formation", formation: squad },
      ],
    };
    return { ...fleet(), formation: root };
  }

  it("stamps formationId=root.id and formationChain=[root.id] on every ship of a flat fleet", () => {
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(flatFleet(), designs, catalog(), "attacker");
    expect(ships).toHaveLength(2);
    for (const ship of ships) {
      expect(ship.formationId).toBe("root");
      expect(ship.formationChain).toEqual(["root"]);
      // flatFormation authors no role, so role is undefined.
      expect(ship.role).toBeUndefined();
    }
  });

  it("stamps the correct formationId/chain/role for a nested fleet", () => {
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(nestedFleet(), designs, catalog(), "attacker");
    expect(ships).toHaveLength(3);
    // Ship 0 is a direct child of root: formationId=root, chain=[root], role=line.
    expect(ships[0]?.formationId).toBe("root");
    expect(ships[0]?.formationChain).toEqual(["root"]);
    expect(ships[0]?.role).toBe("line");
    // Ships 1 and 2 are children of squad: formationId=squad, chain=[root, squad],
    // role=vanguard.
    for (const ship of [ships[1], ships[2]]) {
      if (ship === undefined) continue;
      expect(ship.formationId).toBe("squad");
      expect(ship.formationChain).toEqual(["root", "squad"]);
      expect(ship.role).toBe("vanguard");
    }
  });

  it("assigns instanceIds and positions by DFS leaf order regardless of nesting (byte-identical column)", () => {
    // The deployment column depends only on the per-ship radius/weapon set and
    // the DFS leaf order — NOT on the formation structure. So a nested fleet
    // whose pre-order DFS leaf sequence matches a flat fleet's produces the
    // same per-index instanceId and the same x facing. (The y-positions differ
    // only because the two fleets have different total ship counts, which
    // recentres the column; the per-ship geometry is otherwise identical, and
    // the full byte-identical guard for real fleets is the preset-determinism
    // regression test.)
    const designs = new Map([["d-1", design()]]);
    const flat = resolveFleetToCombatShips(flatFleet(), designs, catalog(), "attacker");
    const nested = resolveFleetToCombatShips(nestedFleet(), designs, catalog(), "attacker");
    // The first two leaves of both fleets deploy in the same order, so their
    // instanceIds and facing match index-for-index.
    expect(flat[0]?.instanceId).toBe("ship_attacker_0");
    expect(nested[0]?.instanceId).toBe("ship_attacker_0");
    expect(nested[1]?.instanceId).toBe("ship_attacker_1");
    expect(nested[2]?.instanceId).toBe("ship_attacker_2");
    // x is a function of (edgeInset, radius) — identical for every ship of the
    // same design — so every ship in both fleets shares the same x.
    const x = flat[0]?.position.x;
    expect(x).toBeDefined();
    for (const ship of [...flat, ...nested]) {
      expect(ship.position.x).toBeCloseTo(x ?? 0, 6);
      expect(ship.facing).toBeCloseTo(0, 6);
    }
    // The nested fleet's y-positions are a strictly increasing column (the
    // deployment column order is the DFS leaf order, top to bottom).
    for (let i = 1; i < nested.length; i += 1) {
      const prev = nested[i - 1];
      const curr = nested[i];
      if (prev === undefined || curr === undefined) continue;
      expect(curr.position.y).toBeGreaterThan(prev.position.y);
    }
  });
});

describe("resolveFleetToCombatShips (pattern layout)", () => {
  // A pattern-layout fleet deploys in its authored geometry rather than the
  // legacy radius-spaced column. The pattern formulas live in
  // `formation-layout.ts` (shared with the fleet-builder preview); these tests
  // pin the resolver's consumption of them so the engine and the preview never
  // drift apart.

  /** Three ships under a root carrying the given pattern layout. */
  function patternFleet(
    pattern: "column" | "line" | "wedge" | "ring" | "screen" | "echelon",
    spacing: number,
  ): Fleet {
    const ship = () => ({
      designId: "d-1",
      position: { x: 0, y: 0 },
      facing: 0,
    });
    return {
      ...fleet(),
      formation: {
        id: "root",
        doctrine: { base: {}, rules: [] },
        layout: { kind: "pattern", pattern, spacing, facingAligned: true },
        children: [
          { kind: "ship", ship: ship() },
          { kind: "ship", ship: ship() },
          { kind: "ship", ship: ship() },
        ],
      },
    };
  }

  it("places a `line` pattern as a forward trail centred on the anchor", () => {
    // `line` is a forward stack (ships in trail, one behind another along the
    // facing axis), centred on the anchor so the middle ship sits at the
    // deployment edge. For 3 ships at spacing 100 the forward offsets (from
    // patternOffset in formation-layout.ts) are -100, 0, +100 — and with the
    // attacker facing 0 the rotation is identity, so world x = anchor.x +
    // forward, world y = anchor.y + lateral (0 for a line).
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(
      patternFleet("line", 100),
      designs,
      catalog(),
      "attacker",
    );
    expect(ships).toHaveLength(3);
    // All three share lateral = 0 (no lateral spread in a line) → identical y.
    const y = ships[0]?.position.y;
    expect(y).toBeDefined();
    for (const ship of ships) {
      expect(ship.position.y).toBeCloseTo(y ?? 0, 6);
    }
    // Forward offsets -100, 0, +100 centred on the anchor. The ships are in
    // increasing x order: ship 0 is farthest back (most negative x), ship 2 is
    // farthest forward (closest to the midline).
    expect(ships[0]?.position.x).toBeLessThan(ships[1]?.position.x ?? NaN);
    expect(ships[1]?.position.x).toBeLessThan(ships[2]?.position.x ?? NaN);
    // The stride between adjacent ships is exactly the authored spacing.
    const stride = (ships[1]?.position.x ?? 0) - (ships[0]?.position.x ?? 0);
    expect(stride).toBeCloseTo(100, 6);
    // The middle ship sits at the anchor x (forward offset 0) — the deployment
    // edge inset, which is negative for an attacker.
    expect(ships[1]?.position.x).toBeLessThan(0);
  });

  it("places a `column` pattern as a lateral abreast line, distinct from the legacy column", () => {
    // `column` is a lateral line (ships abreast across the facing axis), NOT
    // the legacy radius-spaced deployment column. For 3 ships at spacing 100
    // the lateral offsets are -100, 0, +100 — all at the same forward (the
    // anchor x), so the ships line up abreast across y.
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(
      patternFleet("column", 100),
      designs,
      catalog(),
      "attacker",
    );
    expect(ships).toHaveLength(3);
    // All three share the anchor x (forward = 0 for every child of a column
    // pattern) — distinct from the legacy column, which would also share x but
    // derive y from ship radius rather than the authored spacing.
    const x = ships[0]?.position.x;
    expect(x).toBeDefined();
    for (const ship of ships) {
      expect(ship.position.x).toBeCloseTo(x ?? 0, 6);
    }
    // The lateral offsets place ships at y = -100, 0, +100 centred on the
    // anchor (y = 0). The legacy column would instead place them at
    // y = -totalHeight/2 + radius, 0, +totalHeight/2 - radius (radius-spaced),
    // so asserting the exact authored spacing here is what proves the pattern
    // branch ran rather than the legacy column.
    expect(ships[0]?.position.y).toBeCloseTo(-100, 6);
    expect(ships[1]?.position.y).toBeCloseTo(0, 6);
    expect(ships[2]?.position.y).toBeCloseTo(100, 6);
  });

  it("mirrors the pattern for the defender side (facing π flips both axes)", () => {
    // A defender fleet is the mirror image: base facing π rotates both the
    // forward and lateral axes by 180°, so a `line` pattern's forward stack
    // runs the opposite way in world x and the lateral abreast `column` runs
    // the opposite way in world y. Verifying the mirror proves the rotation
    // composes correctly for the defender rather than being special-cased.
    const designs = new Map([["d-1", design()]]);
    const attacker = resolveFleetToCombatShips(
      patternFleet("column", 100),
      designs,
      catalog(),
      "attacker",
    );
    const defender = resolveFleetToCombatShips(
      patternFleet("column", 100),
      designs,
      catalog(),
      "defender",
    );
    expect(defender).toHaveLength(3);
    // The anchor x is mirrored: defender anchor is +edgeInset (right of
    // midline) vs attacker -edgeInset.
    expect(defender[1]?.position.x).toBeGreaterThan(0);
    expect(attacker[1]?.position.x).toBeLessThan(0);
    // The lateral order flips: attacker ship 0 is at y = -100, defender ship 0
    // is at y = +100 (the π rotation negates lateral).
    expect(attacker[0]?.position.y).toBeCloseTo(-100, 6);
    expect(defender[0]?.position.y).toBeCloseTo(100, 6);
    expect(defender[2]?.position.y).toBeCloseTo(-100, 6);
  });

  it("honours an explicit slot override on a pattern formation's child", () => {
    // An explicit `slot` on a child overrides the pattern formula for that
    // child only — the other children still follow the pattern. Here the
    // middle ship of a column pattern carries a slot pushing it forward of the
    // abreast line, so ships 0 and 2 stay on the line at lateral ∓100 while
    // ship 1 is at (forward=50, lateral=0).
    const ship = () => ({
      designId: "d-1",
      position: { x: 0, y: 0 },
      facing: 0,
    });
    const slotFleet: Fleet = {
      ...fleet(),
      formation: {
        id: "root",
        doctrine: { base: {}, rules: [] },
        layout: {
          kind: "pattern",
          pattern: "column",
          spacing: 100,
          facingAligned: true,
        },
        children: [
          { kind: "ship", ship: ship() },
          {
            kind: "ship",
            ship: ship(),
            slot: { forward: 50, lateral: 0 },
          },
          { kind: "ship", ship: ship() },
        ],
      },
    };
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(slotFleet, designs, catalog(), "attacker");
    expect(ships).toHaveLength(3);
    // Ships 0 and 2 follow the column pattern: lateral ∓100, forward 0.
    expect(ships[0]?.position.y).toBeCloseTo(-100, 6);
    expect(ships[2]?.position.y).toBeCloseTo(100, 6);
    // Ship 1 honours its explicit slot: lateral 0 (y = anchor.y = 0), and
    // forward 50 places it 50 m closer to the midline than the abreast line.
    expect(ships[1]?.position.y).toBeCloseTo(0, 6);
    const dx = (ships[1]?.position.x ?? 0) - (ships[0]?.position.x ?? 0);
    expect(dx).toBeCloseTo(50, 6);
  });

  it("places a nested sub-formation by the parent's pattern, then its own", () => {
    // A fleet whose root has a pattern layout AND contains a sub-formation
    // with its own pattern composes the two: the sub-formation is offset by
    // the root pattern (one position in the root's frame), and its children
    // are arranged inside that offset by the sub-formation's pattern. This is
    // the recursive composition the engine must get right.
    const ship = () => ({
      designId: "d-1",
      position: { x: 0, y: 0 },
      facing: 0,
    });
    const squad: Formation = {
      id: "squad",
      doctrine: { base: {}, rules: [] },
      layout: {
        kind: "pattern",
        pattern: "line",
        spacing: 40,
        facingAligned: true,
      },
      children: [
        { kind: "ship", ship: ship() },
        { kind: "ship", ship: ship() },
      ],
    };
    const nestedFleet: Fleet = {
      ...fleet(),
      formation: {
        id: "root",
        doctrine: { base: {}, rules: [] },
        layout: {
          kind: "pattern",
          pattern: "line",
          spacing: 200,
          facingAligned: true,
        },
        children: [
          { kind: "ship", ship: ship() },
          { kind: "formation", formation: squad },
        ],
      },
    };
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(nestedFleet, designs, catalog(), "attacker");
    expect(ships).toHaveLength(3);
    // Root `line` with 2 children at spacing 200 → forward offsets -100 (ship)
    // and +100 (squad). Squad `line` with 2 children at spacing 40 → relative
    // forward offsets -20 and +20 inside the squad's frame.
    //
    // Ship 0 (root child 0): forward -100 from the anchor.
    // Ship 1 (squad child 0): squad at +100, then -20 inside → forward +80.
    // Ship 2 (squad child 1): squad at +100, then +20 inside → forward +120.
    const anchor = ships[1] !== undefined && ships[2] !== undefined
      ? (ships[1].position.x + ships[2].position.x) / 2 - 100
      : NaN;
    expect(ships[0]?.position.x).toBeCloseTo(anchor - 100, 6);
    expect(ships[1]?.position.x).toBeCloseTo(anchor + 80, 6);
    expect(ships[2]?.position.x).toBeCloseTo(anchor + 120, 6);
    // The squad's two ships are 40 m apart (the squad's spacing) along the
    // forward axis.
    const squadStride = (ships[2]?.position.x ?? 0) - (ships[1]?.position.x ?? 0);
    expect(squadStride).toBeCloseTo(40, 6);
    // All three ships share lateral = 0 (both patterns are forward lines).
    for (const s of ships) {
      expect(s.position.y).toBeCloseTo(0, 6);
    }
  });
});

describe("resolveFleetPoints (named waypoints)", () => {
  // A fleet's authored `points` are fleet-local metres relative to its
  // deployment centroid. The resolver translates each to a world position by
  // the centroid + facing rotation: identity for an attacker, π for a defender
  // (so the defender's local +x points toward the midline). A point authored at
  // (0, 0) lands on the centroid; a fleet with no points yields an empty map.

  /** A fleet that authors two named waypoints in fleet-local metres, deployed
   *  as a flat column (so the centroid is the mean of the resolved ship
   *  positions). The authored positions are arbitrary offsets; what matters is
   *  the centroid-anchored + facing-rotated transform. */
  function fleetWithPoints(): Fleet {
    return {
      ...fleet(),
      points: {
        "wp-origin": { x: 0, y: 0 },
        "wp-near": { x: 100, y: -50 },
      },
    };
  }

  it("translates fleet-local points to world by the deployment centroid + facing (attacker)", () => {
    // Attacker: facing 0, so world = centroid + local (identity rotation).
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(fleetWithPoints(), designs, catalog(), "attacker");
    const points = resolveFleetPoints(fleetWithPoints(), ships, "attacker");
    // The centroid is the mean of the resolved ship positions (one ship here).
    const cx = ships[0]?.position.x ?? NaN;
    const cy = ships[0]?.position.y ?? NaN;
    expect(points.get("wp-origin")).toEqual({ x: cx, y: cy });
    expect(points.get("wp-near")).toEqual({ x: cx + 100, y: cy - 50 });
  });

  it("mirrors the local frame for the defender (facing π negates both axes)", () => {
    // Defender: facing π, so world = centroid + (-local.x, -local.y). A
    // defender's local +x (its "forward") points toward the midline, matching
    // the deployment mirror.
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(fleetWithPoints(), designs, catalog(), "defender");
    const points = resolveFleetPoints(fleetWithPoints(), ships, "defender");
    const cx = ships[0]?.position.x ?? NaN;
    const cy = ships[0]?.position.y ?? NaN;
    expect(points.get("wp-origin")).toEqual({ x: cx, y: cy });
    // Local (100, -50) → world (cx - 100, cy + 50) under the π rotation.
    expect(points.get("wp-near")).toEqual({ x: cx - 100, y: cy + 50 });
  });

  it("returns an empty map when the fleet authors no points", () => {
    // A fleet with no `points` field (every preset fleet) yields an empty map,
    // so point references stay unresolvable and preset battles are byte-identical.
    const designs = new Map([["d-1", design()]]);
    const ships = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    const points = resolveFleetPoints(fleet(), ships, "attacker");
    expect(points.size).toBe(0);
  });
});
