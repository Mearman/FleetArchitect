import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { cellToLocal } from "@/domain/grid";
import { catalog } from "@/data/catalog";
import { nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/** A two-cell ship: a pulse laser facing aft (π) at (col 0, row 0) and a
 *  fusion reactor at (col 1, row 0). */
function design(): ShipDesign {
  const grid: TileGrid = {
    cols: 2,
    rows: 1,
    cells: [
      { kind: "module", moduleId: "mod-pulse-laser", facing: Math.PI },
      { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
    ],
  };
  return {
    id: "d-1",
    name: "Probe",
    faction: "Terran",
    grid,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function fleet(): Fleet {
  return {
    id: "f-1",
    name: "F",
    faction: "Terran",
    ships: [
      { designId: "d-1", position: { x: -100, y: 20 }, facing: 0, orders: { ...defaultOrders } },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

describe("resolveFleetToCombatShips (grid)", () => {
  it("resolves each occupied cell to a module with grid-exact position", () => {
    const designs = new Map([["d-1", design()]]);
    const [ship] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    expect(ship).toBeDefined();
    if (ship === undefined) return;
    const modules = ship.modules ?? [];
    expect(modules).toHaveLength(2);

    const grid = design().grid;
    const laser = modules.find((m) => m.moduleId === "mod-pulse-laser");
    expect(laser).toBeDefined();
    if (laser === undefined) return;
    expect(laser.col).toBe(0);
    expect(laser.row).toBe(0);
    expect(laser.x).toBeCloseTo(cellToLocal(0, 0, grid).x, 6);
    expect(laser.y).toBeCloseTo(cellToLocal(0, 0, grid).y, 6);
    // A weapon's cell facing flows through to weaponFacing.
    expect(laser.weaponFacing).toBeCloseTo(Math.PI, 6);
  });

  it("derives classification from the occupied-cell count", () => {
    const designs = new Map([["d-1", design()]]);
    const [ship] = resolveFleetToCombatShips(fleet(), designs, catalog(), "attacker");
    expect(ship?.classification).toBe("fighter");
  });

  it("resolves hull cells to kind 'hull' carrying the tile's mass and hp", () => {
    const d: ShipDesign = {
      ...design(),
      grid: {
        cols: 2,
        rows: 1,
        cells: [
          { kind: "hull", tile: "block" },
          { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
        ],
      },
    };
    const [ship] = resolveFleetToCombatShips(
      { ...fleet() },
      new Map([["d-1", d]]),
      catalog(),
      "attacker",
    );
    const hull = (ship?.modules ?? []).find((m) => m.kind === "hull");
    const tile = catalog().hullTile("block");
    expect(hull).toBeDefined();
    expect(tile).toBeDefined();
    if (hull === undefined || tile === undefined) return;
    expect(hull.mass).toBe(tile.mass);
    expect(hull.maxHp).toBe(tile.hp);
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
});
