import { describe, expect, it } from "vitest";
import { analyseShipDesign } from "@/domain/stats";
import { DEFAULT_FLEET_BUDGET } from "@/domain/points";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";

describe("bundled presets", () => {
  it("ships every preset design as a valid build with no faults", () => {
    for (const design of presetDesigns) {
      const { valid, faults } = analyseShipDesign(design, catalog());
      expect(valid, `${design.name} (${design.id}) has faults: ${JSON.stringify(faults)}`).toBe(true);
    }
  });

  it("uses unique ids for designs and fleets", () => {
    const designIds = presetDesigns.map((d) => d.id);
    const fleetIds = presetFleets.map((f) => f.id);
    expect(new Set(designIds).size).toBe(designIds.length);
    expect(new Set(fleetIds).size).toBe(fleetIds.length);
  });

  it("gives every preset fleet at least one weapon-bearing ship", () => {
    for (const fleet of presetFleets) {
      const armed = fleet.ships.some((ship) => {
        const design = presetDesigns.find((d) => d.id === ship.designId);
        if (design === undefined) return false;
        return analyseShipDesign(design, catalog()).stats.weapons.length > 0;
      });
      expect(armed, `${fleet.name} has no armed ships`).toBe(true);
    }
  });

  it("keeps every preset fleet within the point budget", () => {
    const costOf = (designId: string): number => {
      const design = presetDesigns.find((d) => d.id === designId);
      if (design === undefined) return 0;
      return analyseShipDesign(design, catalog()).stats.cost;
    };

    for (const fleet of presetFleets) {
      const total = fleet.ships.reduce((sum, ship) => sum + costOf(ship.designId), 0);
      expect(total, `${fleet.name} exceeds the budget`).toBeLessThanOrEqual(DEFAULT_FLEET_BUDGET);
    }
  });

  it("references only preset designs in every fleet ship", () => {
    const designIds = new Set(presetDesigns.map((d) => d.id));
    for (const fleet of presetFleets) {
      for (const ship of fleet.ships) {
        expect(designIds.has(ship.designId), `${fleet.name} references ${ship.designId}`).toBe(true);
      }
    }
  });
});
