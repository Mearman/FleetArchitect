import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
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
