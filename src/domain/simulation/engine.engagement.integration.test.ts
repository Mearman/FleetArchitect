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
 * The designs are small, self-sufficient combatants (a beam weapon that needs
 * no ammo resupply, a reactor that is also the bridge, and crew quarters to man
 * the gun) so the only thing under test is the engage-and-fire AI, not supply.
 */

function cells(rows: readonly string[]): GridCell[] {
  const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
  const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };
  const deck = (moduleId: string, facing = 0): GridCell => ({
    kind: "solid",
    scaffold: true,
    surface: "deck",
    edges: OPEN,
    equipment: { moduleId, facing },
  });
  const tokens: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
    L: deck("mod-pulse-laser"),
    R: deck("mod-railgun"),
    G: deck("mod-munitions-magazine"),
    F: deck("mod-reactor-fusion"),
    C: deck("mod-crew-quarters"),
    E: deck("mod-engine-ion", Math.PI),
    S: deck("mod-sensor-passive"),
    W: deck("mod-rcs-thrusters"),
  };
  const out: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = tokens[ch];
      if (cell === undefined) throw new Error(`bad token ${ch}`);
      out.push(cell);
    }
  }
  return out;
}

/**
 * A small armed corvette with a projectile weapon (a railgun, fed by a
 * magazine) so a fired shot is observable as a projectile in the frame — the
 * pulse laser is hitscan and spawns no projectile. Engine faces aft (π) so the
 * ship drives forward; crew man the gun, a magazine supplies it, a reactor is
 * the bridge and power. RCS thrusters (W) provide commandable attitude control
 * so the ship can steer toward the enemy and bring the railgun to bear.
 */
function corvette(id: string): ShipDesign {
  // RCS thrusters (W) give commandable attitude control so the ship can steer
  // toward the enemy and bring the railgun to bear; a passive sensor array (S)
  // fills the formerly-hull cell so the corvette detects the enemy at weapon
  // range and engages rather than fighting blind at the short visual radius.
  // Both are 4-connected to the spine (W under the engine, S between W and the
  // magazine).
  const rows = ["ECFR", "WSGL"];
  return {
    id,
    name: id,
    faction: "Terran",
    grid: {
      cols: 4,
      rows: 2,
      cells: cells(rows),
      // Hardwires for power, manning, and ammo supply:
      // - Power flows from reactor (2,0) to all other modules
      // - Manning flows from crew (1,0) to the railgun (3,0)
      // - Ammo flows from magazine (2,1) to railgun (3,0)
      connections: [
        // Power: reactor (2,0) → engine (0,0)
        { from: { col: 2, row: 0 }, to: { col: 0, row: 0 }, resource: "power" },
        // Power: reactor (2,0) → crew (1,0)
        { from: { col: 2, row: 0 }, to: { col: 1, row: 0 }, resource: "power" },
        // Power: reactor (2,0) → railgun (3,0)
        { from: { col: 2, row: 0 }, to: { col: 3, row: 0 }, resource: "power" },
        // Power: reactor (2,0) → RCS (0,1)
        { from: { col: 2, row: 0 }, to: { col: 0, row: 1 }, resource: "power" },
        // Power: reactor (2,0) → sensor (1,1)
        { from: { col: 2, row: 0 }, to: { col: 1, row: 1 }, resource: "power" },
        // Power: reactor (2,0) → magazine (2,1)
        { from: { col: 2, row: 0 }, to: { col: 2, row: 1 }, resource: "power" },
        // Manning: crew (1,0) → railgun (3,0)
        { from: { col: 1, row: 0 }, to: { col: 3, row: 0 }, resource: "manning" },
        // Ammo: magazine (2,1) → railgun (3,0)
        { from: { col: 2, row: 1 }, to: { col: 3, row: 0 }, resource: "ammo" },
      ],
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

  it("ships actually fire — projectiles appear during the battle", () => {
    const res = runEngagement(11);
    const everFired = res.frames.some((f) => f.projectiles.length > 0);
    expect(everFired, "at least one projectile should be fired").toBe(true);
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
