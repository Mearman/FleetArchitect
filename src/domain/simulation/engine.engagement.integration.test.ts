import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { GridCell } from "@/schema/grid";
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
  const tokens: Record<string, GridCell> = {
    ".": { kind: "empty" },
    "#": { kind: "hull", tile: "block" },
    L: { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
    R: { kind: "module", moduleId: "mod-railgun", facing: 0 },
    G: { kind: "module", moduleId: "mod-munitions-magazine", facing: 0 },
    F: { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
    C: { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
    E: { kind: "module", moduleId: "mod-engine-ion", facing: Math.PI },
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
 * the bridge and power. Two rows keep the magazine walkable-adjacent to the gun.
 */
function corvette(id: string): ShipDesign {
  const rows = ["ECFR", ".#GL"];
  return {
    id,
    name: id,
    faction: "Terran",
    grid: { cols: 4, rows: 2, cells: cells(rows) },
    createdAt: nowIso(),
    updatedAt: nowIso(),
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
      orders: { ...defaultOrders, engageRange: "medium", stance: "balanced" },
    })),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function runEngagement(seed: number) {
  const design = corvette(createId("design"));
  const designs = new Map([[design.id, design]]);
  // Both fleets are authored in attacker coordinates (left side, facing right);
  // resolve mirrors the defender to the right side. So both sit at x=-400 here
  // and end up at -400 (attacker) and +400 (defender) — a 800-unit gap.
  const attacker = fleetOf(createId("fleet"), design.id, -400, [-40, 40]);
  const defender = fleetOf(createId("fleet"), design.id, -400, [-40, 40]);
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
    const probe = res.frames[Math.min(120, res.frames.length - 1)];
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

  it("the battle resolves to a winner before the tick cap", () => {
    const res = runEngagement(11);
    expect(res.ticks).toBeLessThan(DEFAULT_MAX_TICKS);
    expect(["attacker", "defender"]).toContain(res.winner);
  });
});
