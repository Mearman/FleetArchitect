import { describe, expect, it } from "vitest";
import { catalog, hulls } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { HullDefinition } from "@/schema/hull";
import type { ModulePlacement, ShipDesign } from "@/schema/ship";

function requireHull(id: string): HullDefinition {
  const hull = hulls.find((h) => h.id === id);
  if (hull === undefined) throw new Error(`fixture: ${id} missing from catalog`);
  return hull;
}

const wasp = requireHull("hull-wasp");

function design(placements: ModulePlacement[]): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    hullId: wasp.id,
    faction: "Terran",
    placements,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function place(slotId: string, moduleId: string): ModulePlacement {
  return { slotId, moduleId };
}

describe("analyseShipDesign", () => {
  it("treats an empty hull as valid with base stats", () => {
    const { stats, faults, valid } = analyseShipDesign(design([]), wasp, catalog());
    expect(valid).toBe(true);
    expect(faults).toEqual([]);
    expect(stats.structure).toBe(wasp.baseStructure);
    expect(stats.cost).toBe(wasp.baseCost);
    expect(stats.weapons).toHaveLength(0);
  });

  it("flags power and crew deficits for an under-supplied weapon", () => {
    const { valid, faults } = analyseShipDesign(
      design([place("wasp-weapon-1", "mod-pulse-laser")]),
      wasp,
      catalog(),
    );
    expect(valid).toBe(false);
    const kinds = faults.map((f) => f.kind);
    expect(kinds).toContain("powerDeficit");
    expect(kinds).toContain("crewDeficit");
  });

  it("validates a fully supplied armed fighter and sums cost", () => {
    const { valid, stats } = analyseShipDesign(
      design([
        place("wasp-weapon-1", "mod-pulse-laser"),
        place("wasp-system-1", "mod-reactor-fusion"),
        place("wasp-general-1", "mod-crew-quarters"),
      ]),
      wasp,
      catalog(),
    );
    expect(valid).toBe(true);
    expect(stats.weapons).toHaveLength(1);
    expect(stats.powerNet).toBeGreaterThanOrEqual(0);
    expect(stats.crewNet).toBeGreaterThanOrEqual(0);
    // base + pulse laser(40) + fusion reactor(80) + crew quarters(30)
    expect(stats.cost).toBe(wasp.baseCost + 40 + 80 + 30);
  });

  it("flags a module placed in the wrong slot type", () => {
    const { valid, faults } = analyseShipDesign(
      design([place("wasp-general-1", "mod-pulse-laser")]),
      wasp,
      catalog(),
    );
    expect(valid).toBe(false);
    expect(faults.some((f) => f.kind === "slotTypeMismatch")).toBe(true);
  });
});
