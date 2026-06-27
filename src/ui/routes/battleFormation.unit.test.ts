import { describe, expect, it } from "vitest";
import type { ShipDescriptor } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import {
  buildFormationColourByInstance,
  formationCentroids,
  formationColour,
} from "./battleFormation";

/**
 * Phase E renderer grouping helpers: the formation colour is a pure
 * deterministic function of the formation id, the per-battle instance → colour
 * map covers only ships that carry a formation id, and the centroid grouping
 * averages each formation's alive ships and skips dead ships and ships without
 * a formation identity.
 */

interface ShipRow {
  instanceId: string;
  x: number;
  y: number;
  alive: boolean;
}

function descriptor(
  over: Partial<ShipDescriptor> & Pick<ShipDescriptor, "instanceId">,
): ShipDescriptor {
  const { instanceId, ...rest } = over;
  return { instanceId, side: "attacker", ...rest };
}

function row(over: Partial<ShipRow> & Pick<ShipRow, "instanceId">): ShipRow {
  const { instanceId, ...rest } = over;
  return { instanceId, x: 0, y: 0, alive: true, ...rest };
}

describe("formationColour", () => {
  it("is deterministic: the same id always yields the same colour", () => {
    expect(formationColour("form-vanguard")).toBe(formationColour("form-vanguard"));
  });

  it("returns a non-empty hex colour string", () => {
    expect(formationColour("any-id")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("distributes distinct formation ids across the palette", () => {
    // Eight curated entries; eight well-spread ids should hit more than one of
    // them, confirming the hash isn't collapsing everything onto one colour.
    const colours = new Set(
      ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].map(
        formationColour,
      ),
    );
    expect(colours.size).toBeGreaterThan(1);
  });
});

describe("buildFormationColourByInstance", () => {
  it("includes only ships whose descriptor carries a formationId", () => {
    const descriptors: DescriptorMap = new Map<string, ShipDescriptor>([
      ["a1", descriptor({ instanceId: "a1", formationId: "form-a" })],
      ["a2", descriptor({ instanceId: "a2" })],
      ["d1", descriptor({ instanceId: "d1", formationId: "form-d", side: "defender" })],
    ]);

    const map = buildFormationColourByInstance(descriptors);

    expect(map.size).toBe(2);
    expect(map.has("a1")).toBe(true);
    expect(map.has("d1")).toBe(true);
    expect(map.has("a2")).toBe(false);
    expect(map.get("a1")).toBe(formationColour("form-a"));
    expect(map.get("d1")).toBe(formationColour("form-d"));
  });

  it("is empty when no ship carries a formationId (pre-formation battle)", () => {
    const descriptors: DescriptorMap = new Map<string, ShipDescriptor>([
      ["a1", descriptor({ instanceId: "a1" })],
      ["d1", descriptor({ instanceId: "d1", side: "defender" })],
    ]);
    expect(buildFormationColourByInstance(descriptors).size).toBe(0);
  });
});

describe("formationCentroids", () => {
  it("draws one centroid per formation at the mean of its alive ships", () => {
    const descriptors: DescriptorMap = new Map<string, ShipDescriptor>([
      // Two alive attackers in form-a, plus a dead one (excluded), plus a
      // no-formation ship (excluded), and one defender in form-b.
      ["a1", descriptor({ instanceId: "a1", formationId: "form-a", role: "vanguard" })],
      ["a2", descriptor({ instanceId: "a2", formationId: "form-a", role: "vanguard" })],
      ["a3", descriptor({ instanceId: "a3", formationId: "form-a", role: "vanguard" })],
      ["a4", descriptor({ instanceId: "a4" })],
      ["d1", descriptor({ instanceId: "d1", formationId: "form-b", role: "screen", side: "defender" })],
    ]);
    const ships: ShipRow[] = [
      row({ instanceId: "a1", x: 0, y: 0 }),
      row({ instanceId: "a2", x: 10, y: 20 }),
      row({ instanceId: "a3", x: 100, y: 100, alive: false }),
      row({ instanceId: "a4", x: 5, y: 5 }),
      row({ instanceId: "d1", x: 50, y: -50 }),
    ];

    const centroids = formationCentroids(ships, descriptors);
    const byFormation = new Map(centroids.map((c) => [c.formationId, c]));

    expect(centroids).toHaveLength(2);

    // form-a centroid = mean of a1 (0,0) and a2 (10,20); a3 is dead, a4 ignored.
    const formA = byFormation.get("form-a");
    expect(formA).toBeDefined();
    if (formA === undefined) return;
    expect(formA.x).toBe(5);
    expect(formA.y).toBe(10);
    expect(formA.role).toBe("vanguard");

    // form-b centroid = d1 (50, -50).
    const formB = byFormation.get("form-b");
    expect(formB?.x).toBe(50);
    expect(formB?.y).toBe(-50);
    expect(formB?.role).toBe("screen");
  });

  it("is empty when no alive ship carries a formationId (pre-formation battle)", () => {
    const descriptors: DescriptorMap = new Map<string, ShipDescriptor>([
      ["a1", descriptor({ instanceId: "a1" })],
    ]);
    const ships: ShipRow[] = [row({ instanceId: "a1", x: 0, y: 0 })];

    expect(formationCentroids(ships, descriptors)).toEqual([]);
  });

  it("carries an undefined role when the formation has no authored role", () => {
    const descriptors: DescriptorMap = new Map<string, ShipDescriptor>([
      ["a1", descriptor({ instanceId: "a1", formationId: "form-anon" })],
    ]);
    const ships: ShipRow[] = [row({ instanceId: "a1", x: 0, y: 0 })];

    const centroids = formationCentroids(ships, descriptors);
    expect(centroids).toHaveLength(1);
    const only = centroids[0];
    if (only === undefined) return;
    expect(only.role).toBeUndefined();
  });
});
