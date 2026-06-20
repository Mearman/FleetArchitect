import { describe, expect, it } from "vitest";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
} from "@/sharing/data-url";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

function sampleDesign(): ShipDesign {
  return {
    id: createId("design"),
    name: "Shared Fighter",
    faction: "Terran",
    grid: {
      cols: 3,
      rows: 1,
      cells: [
        { kind: "solid", scaffold: true, surface: "deck", edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} }, equipment: { moduleId: "mod-pulse-laser", facing: 0 } },
        { kind: "solid", scaffold: true, surface: "deck", edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} }, equipment: { moduleId: "mod-reactor-fusion", facing: 0 } },
        { kind: "solid", scaffold: true, surface: "armor", edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} } },
      ],
      connections: [],
      shape: { outlineMode: "hexadecilinear" },
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

describe("sharing round-trip", () => {
  it("round-trips a ship design", () => {
    const original = sampleDesign();
    const encoded = encodeShareable({ kind: "shipDesign", value: original });
    expect(typeof encoded).toBe("string");
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "shipDesign") {
      throw new Error("expected a shipDesign share");
    }
    expect(decoded.value).toEqual(original);
  });

  it("round-trips a fleet", () => {
    const fleet: Fleet = {
      id: createId("fleet"),
      name: "Strike Wing",
      faction: "Terran",
      ships: [
        {
          designId: createId("design"),
          position: { x: 10, y: 20 },
          facing: 0,
          orders: { ...defaultOrders },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    };
    const encoded = encodeShareable({ kind: "fleet", value: fleet });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "fleet") {
      throw new Error("expected a fleet share");
    }
    expect(decoded.value).toEqual(fleet);
  });

  it("throws ShareDecodeError on a corrupt payload", () => {
    expect(() => decodeShareable("!!!not-a-valid-payload!!!")).toThrow(
      ShareDecodeError,
    );
  });
});
