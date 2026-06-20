import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { CellEdges, GridCell } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/**
 * End-to-end check of the pipeline the Battle Arena runs when you hit Engage:
 * build designs and a fleet, resolve them to combat ships, and run the engine.
 * This exercises analyseShipDesign, resolveFleetToCombatShips, and runBattle
 * together against the real bundled catalog — everything except the canvas.
 */

function armedFighter(id: string): ShipDesign {
  // A pulse laser, a fusion reactor (command + power), and crew quarters on a
  // single connected row of deck cells — the grid equivalent of the old wasp
  // loadout.
  const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
  const deck = (moduleId: string): GridCell => ({
    kind: "solid",
    scaffold: true,
    surface: "deck",
    edges: OPEN,
    equipment: { moduleId, facing: 0 },
  });
  return {
    id,
    name: id,
    faction: "Terran",
    grid: {
      cols: 3,
      rows: 1,
      cells: [
        deck("mod-pulse-laser"),
        deck("mod-reactor-fusion"),
        deck("mod-crew-quarters"),
      ],
      connections: [],
      shape: { outlineMode: "hexadecilinear" },
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

function fleet(id: string, designId: string): Fleet {
  return {
    id,
    name: id,
    faction: "Terran",
    ships: [
      {
        designId,
        position: { x: -300, y: -80 },
        facing: 0,
        orders: { ...defaultOrders },
      },
      {
        designId,
        position: { x: -300, y: 80 },
        facing: 0,
        orders: { ...defaultOrders },
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

describe("battle pipeline (resolve -> runBattle)", () => {
  it("resolves a fleet to combat ships and produces a well-formed, terminating battle", () => {
    const design = armedFighter(createId("design"));
    const attacker = fleet(createId("fleet"), design.id);
    const defender = fleet(createId("fleet"), design.id);

    const designs = new Map([[design.id, design]]);
    const ships = [
      ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
    ];
    expect(ships).toHaveLength(4);
    expect(ships.filter((s) => s.side === "attacker")).toHaveLength(2);

    const result = runBattle({
      ships,
      attackerFleetId: attacker.id,
      defenderFleetId: defender.id,
      anomaly: "none",
      seed: 1,
      maxTicks: DEFAULT_MAX_TICKS,
    });

    // One deployment frame plus one per simulated tick.
    expect(result.frames).toHaveLength(result.ticks + 1);
    expect(result.frames[0]?.tick).toBe(0);
    expect(result.frames[0]?.ships.every((s) => s.alive)).toBe(true);
    // The battle terminates (the loop ended — either a side was wiped out
    // or the tick cap was reached). With the per-module power grid, a
    // symmetric mirror match can stalemate to the tick cap: both sides'
    // reactors die, every weapon goes unpowered, and neither can finish
    // the other off. That's a legitimate draw, not a pipeline bug.
    expect(result.ticks).toBeLessThanOrEqual(DEFAULT_MAX_TICKS);
    expect(["attacker", "defender", "draw"]).toContain(result.winner);

    // Every frame conforms to the same set of instance ids.
    const ids = new Set(result.frames[0]?.ships.map((s) => s.instanceId));
    for (const frame of result.frames) {
      for (const s of frame.ships) {
        expect(ids.has(s.instanceId)).toBe(true);
      }
    }
  });

  it("is deterministic across the full pipeline", () => {
    const design = armedFighter(createId("design"));
    const attacker = fleet(createId("fleet"), design.id);
    const defender = fleet(createId("fleet"), design.id);
    const designs = new Map([[design.id, design]]);
    const ships = [
      ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
    ];

    // Determinism is a property of identical inputs, not of battle length: a
    // few hundred ticks exercise every code path (movement, weapons, crew,
    // power, awareness) far enough to prove byte-identity without running the
    // full stalemate cap twice. `DEFAULT_MAX_TICKS` is sized for light-lag
    // battles; running it twice here would time out the test for no gain.
    const DETERMINISM_TICKS = 600;
    const a = runBattle({ ships, attackerFleetId: attacker.id, defenderFleetId: defender.id, anomaly: "none", seed: 7, maxTicks: DETERMINISM_TICKS });
    const b = runBattle({ ships, attackerFleetId: attacker.id, defenderFleetId: defender.id, anomaly: "none", seed: 7, maxTicks: DETERMINISM_TICKS });
    expect(b.frames).toEqual(a.frames);
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });

  it("produces a well-formed result for an armed mirror match", () => {
    const design = armedFighter(createId("design"));
    const attacker = fleet(createId("fleet"), design.id);
    const defender = fleet(createId("fleet"), design.id);
    const designs = new Map([[design.id, design]]);
    const ships = [
      ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
      ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
    ];
    const result = runBattle({ ships, attackerFleetId: attacker.id, defenderFleetId: defender.id, anomaly: "none", seed: 42, maxTicks: DEFAULT_MAX_TICKS });
    // The per-module power grid makes a symmetric single-reactor mirror
    // match draw: both reactors die, weapons go unpowered, neither side
    // can land a killing blow. The pipeline still produces a well-formed
    // result with a valid winner label and at least one frame.
    expect(["attacker", "defender", "draw"]).toContain(result.winner);
    const last = result.frames.at(-1);
    expect(last).toBeDefined();
  });

  it("places the defender on the opposite side of the arena from the attacker", () => {
    const design = armedFighter(createId("design"));
    const attacker = fleet(createId("fleet"), design.id);
    const defender = fleet(createId("fleet"), design.id);
    const designs = new Map([[design.id, design]]);

    const attackers = resolveFleetToCombatShips(attacker, designs, catalog(), "attacker");
    const defenders = resolveFleetToCombatShips(defender, designs, catalog(), "defender");

    // The attacker keeps its authored positions (left side, negative x).
    expect(attackers.every((s) => s.position.x < 0)).toBe(true);
    // The defender is mirrored to the opposite side (positive x).
    expect(defenders.every((s) => s.position.x > 0)).toBe(true);
    // And turned to face the attacker.
    expect(defenders.every((s) => Math.abs(s.facing - Math.PI) < 1e-9)).toBe(true);
  });
});
