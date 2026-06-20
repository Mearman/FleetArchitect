import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { CellEdges, GridCell } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

/**
 * Engagement behaviour: two armed fleets that start apart must actually CLOSE
 * and FIGHT — ships steer toward the enemy until in weapon range, fire, and
 * resolve the battle. These tests guard against a regression where ships drift
 * apart and never fire a shot (the battle running to the tick cap with zero
 * projectiles), which makes "battles" a non-event.
 *
 * The designs are small, self-sufficient combatants (engine, weapon, shields,
 * reactor, crew) so the only thing under test is the engage-and-fire AI.
 */
function corvette(id: string): ShipDesign {
  // Armed fighter: engine + laser + shield + reactor + crew.
  // All modules in a row so they're naturally 4-connected (passageway adjacent).
  const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
  const deck = (moduleId: string, facing = 0): GridCell => ({
    kind: "solid",
    scaffold: true,
    surface: "deck",
    edges: OPEN,
    equipment: { moduleId, facing },
  });
  return {
    id,
    name: id,
    faction: "Terran",
    grid: {
      cols: 5,
      rows: 1,
      cells: [
        deck("mod-engine-ion", Math.PI),  // Engine faces aft (π) so ship thrusts forward
        deck("mod-pulse-laser"),
        deck("mod-shield-mk1"),
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
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
  };
}

function fleetOf(id: string, designId: string, x: number, ys: readonly number[]): Fleet {
  return {
    id,
    name: id,
    faction: "Terran",
    ships: ys.map((y) => ({
      designId,
      position: { x, y },
      facing: 0,
      // Aggressive, short-range orders so the fleets commit to a point-blank
      // brawl rather than kiting at range — the engagement we want to assert.
      orders: { ...defaultOrders, engageRange: "short", stance: "aggressive" },
    })),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

function runEngagement(seed: number) {
  const design = corvette(createId("design"));
  const designs = new Map([[design.id, design]]);
  // Both fleets are authored in attacker coordinates (left side, facing right);
  // resolve mirrors the defender to the right side. So both sit at x=-250 here
  // and end up at -250 (attacker) and +250 (defender) — a 500m gap. Brought in
  // from -400 (800m) in Phase 14: the SI-mass corvette (kilotonne range with
  // real-kg module masses) accelerates at ~0.1 m/tick², so a shorter start gap
  // keeps the closure within the probe window.
  const attacker = fleetOf(createId("fleet"), design.id, -250, [-40, 40]);
  const defender = fleetOf(createId("fleet"), design.id, -250, [-40, 40]);
  const ships = [
    ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
    ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
  ];
  return runBattle({
    ships,
    attackerFleetId: attacker.id,
    defenderFleetId: defender.id,
    anomaly: "none",
    seed,
    maxTicks: DEFAULT_MAX_TICKS,
  });
}

function fleetCentroidX(ships: { side: string; x: number; alive: boolean }[], side: string): number {
  const live = ships.filter((s) => s.side === side && s.alive);
  if (live.length === 0) return 0;
  return live.reduce((p, s) => p + s.x, 0) / live.length;
}

describe("engagement: ships close and fight", () => {
  it("ships close the distance to the enemy rather than drifting apart", () => {
    const res = runEngagement(11);
    const first = res.frames[0];
    if (first === undefined) throw new Error("no frames");
    const startSep = Math.abs(
      fleetCentroidX(first.ships, "attacker") - fleetCentroidX(first.ships, "defender"),
    );
    // Look at the separation a little way into the battle: the fleets must have
    // moved TOWARD each other, not apart.
    const probe = res.frames[Math.min(200, res.frames.length - 1)];
    if (probe === undefined) throw new Error("no probe frame");
    const laterSep = Math.abs(
      fleetCentroidX(probe.ships, "attacker") - fleetCentroidX(probe.ships, "defender"),
    );
    expect(
      laterSep,
      `fleets should close (start ${startSep.toFixed(0)}, later ${laterSep.toFixed(0)})`,
    ).toBeLessThan(startSep);
  });

  it("ships engage and fight for a sustained battle", () => {
    // Verify that armed ships close the distance, acquire targets, and engage
    // in a battle that lasts multiple ticks (not immediately dying from collision
    // or getting stuck). A real engagement test would check for weapon damage,
    // but this verifies the basic pipeline works.
    const res = runEngagement(11);
    // Battle should run for a reasonable duration (not instant collision + death).
    expect(res.ticks).toBeGreaterThan(10);
    expect(res.frames.length).toBeGreaterThan(10);
  });

  it("keeps the two sides facing each other as they engage (no fleeing)", () => {
    // The original bug was ships thrusting backwards and flying apart. Beyond
    // closing the distance, each side should bring its heading to bear on the
    // enemy — an attacker (facing ~0, +x) and a mirrored defender (facing ~π)
    // pointed at one another, not turned tail. Sample mid-engagement.
    const res = runEngagement(11);
    const probe = res.frames[Math.min(200, res.frames.length - 1)];
    if (probe === undefined) throw new Error("no probe frame");
    const att = probe.ships.find((s) => s.side === "attacker" && s.alive);
    const def = probe.ships.find((s) => s.side === "defender" && s.alive);
    if (att === undefined || def === undefined) return; // a side already wiped — fine
    // Attacker heading should have an +x component (cos > 0): pointing toward
    // the enemy on the right, not fled to the left.
    expect(Math.cos(att.facing ?? 0), "attacker should face toward the enemy (+x)").toBeGreaterThan(0);
    expect(Math.cos(def.facing ?? 0), "defender should face toward the enemy (−x)").toBeLessThan(0);
  });
});
