import { describe, expect, it } from "vitest";
import {
  ShareDecodeError,
  decodeShareable,
  encodeShareable,
  type BattleShare,
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

  it("round-trips a whole battle (both fleets, designs, anomaly, seed)", () => {
    const design = sampleDesign();
    const makeFleet = (name: string): Fleet => ({
      id: createId("fleet"),
      name,
      faction: "Terran",
      ships: [
        {
          designId: design.id,
          position: { x: -100, y: 0 },
          facing: 0,
          orders: { ...defaultOrders },
        },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
    });
    const battle: BattleShare = {
      attacker: makeFleet("Attacker"),
      defender: makeFleet("Defender"),
      designs: [design],
      anomaly: "asteroidField",
      seed: 42,
    };
    const encoded = encodeShareable({ kind: "battle", value: battle });
    const decoded = decodeShareable(encoded);
    if (decoded.kind !== "battle") {
      throw new Error("expected a battle share");
    }
    expect(decoded.value).toEqual(battle);
  });

  it("throws ShareDecodeError on a corrupt payload", () => {
    expect(() => decodeShareable("!!!not-a-valid-payload!!!")).toThrow(
      ShareDecodeError,
    );
  });
});
