import { describe, expect, it } from "vitest";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
} from "@/sharing/data-url";
import { createId, nowIso } from "@/domain/id";
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
        { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
        { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
        { kind: "hull", tile: "block" },
      ],
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
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
          orders: {
            stance: "balanced",
            targetPriority: "nearest",
            engageRange: "medium",
            retreatThreshold: 0,
          },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
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
