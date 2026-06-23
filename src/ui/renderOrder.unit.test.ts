import { describe, expect, it } from "vitest";
import { type ShipSnapshot } from "@/schema/battle";
import { orderShipsForRender } from "@/ui/renderOrder";

function ship(instanceId: string, y: number, side: ShipSnapshot["side"] = "attacker"): ShipSnapshot {
  return { instanceId, side, x: 0, y, structure: 1, shield: 0, alive: true };
}

function shipAt(instanceId: string, x: number, y: number): ShipSnapshot {
  return { instanceId, side: "attacker", x, y, structure: 1, shield: 0, alive: true };
}

describe("orderShipsForRender", () => {
  it("orders ships back-to-front by ascending world-y", () => {
    const ships = [ship("a", 150), ship("b", 50), ship("c", 100)];
    expect(orderShipsForRender(ships).map((s) => s.instanceId)).toEqual(["b", "c", "a"]);
  });

  it("orders by screen depth, not snapshot or side order", () => {
    // The snapshot is attackers-then-defenders. A defender higher up (smaller
    // y) must render behind an attacker lower down, so it has to come first in
    // the draw order — the regression this guards against is painting in raw
    // array order, which would put att-1 (y=200) under def-1 (y=100).
    const ships = [ship("att-1", 200, "attacker"), ship("def-1", 100, "defender")];
    expect(orderShipsForRender(ships).map((s) => s.instanceId)).toEqual(["def-1", "att-1"]);
  });

  it("breaks y ties by instanceId for a deterministic order", () => {
    const ships = [ship("zeta", 100), ship("alpha", 100), ship("mid", 100)];
    expect(orderShipsForRender(ships).map((s) => s.instanceId)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("does not mutate the input array", () => {
    const ships = [ship("a", 3), ship("b", 1), ship("c", 2)];
    const idsBefore = ships.map((s) => s.instanceId);
    orderShipsForRender(ships);
    expect(ships.map((s) => s.instanceId)).toEqual(idsBefore);
  });

  it("returns a new array containing every ship", () => {
    const ships = [ship("a", 1), ship("b", 2)];
    const result = orderShipsForRender(ships);
    expect(result).not.toBe(ships);
    expect(result).toHaveLength(2);
  });

  it("orders by an isometric depth key (x + y) when supplied", () => {
    // Flat depth (y) would order by y alone; the iso depth x+y must reorder
    // these so the ship with the largest x+y paints last (nearest the viewer).
    const isoDepth = (x: number, y: number) => x + y;
    const ships = [
      shipAt("near", 200, 200), // x+y = 400 -> front
      shipAt("far", 10, 10), // x+y = 20 -> back
      shipAt("mid", 100, 50), // x+y = 150 -> middle
    ];
    expect(orderShipsForRender(ships, isoDepth).map((s) => s.instanceId)).toEqual([
      "far",
      "mid",
      "near",
    ]);
  });

  it("breaks iso-depth ties by instanceId", () => {
    const isoDepth = (x: number, y: number) => x + y;
    // Both sum to 100; deterministic tie-break on instanceId.
    const ships = [shipAt("zeta", 60, 40), shipAt("alpha", 30, 70)];
    expect(orderShipsForRender(ships, isoDepth).map((s) => s.instanceId)).toEqual([
      "alpha",
      "zeta",
    ]);
  });

  it("handles a single ship and an empty list", () => {
    expect(orderShipsForRender([ship("solo", 5)]).map((s) => s.instanceId)).toEqual(["solo"]);
    expect(orderShipsForRender([])).toEqual([]);
  });
});
