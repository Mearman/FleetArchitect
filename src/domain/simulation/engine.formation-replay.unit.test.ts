import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { Doctrine } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Phase E replay grouping: the per-battle ship descriptor and roster (carried
 * once on the BattleResult, never on a frame) must carry formation identity for
 * a resolved fleet that stamps it, and must keep the keys absent for one that
 * does not — so a pre-formation battle renders and serialises byte-identically
 * to before. These fields are once-per-battle cosmetic metadata; they are not
 * part of the frame stream and not part of the cache key (keyed over CombatShip).
 */

function weapon(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 10,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  formationId?: string;
  role?: string;
}): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 100,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [{ slotId: `slot-${opts.id}`, effect: weapon() }],
    compartments: 0,
    airtightCompartments: 0,
  };
  return {
    instanceId: opts.id,
    designId: `design-${opts.id}`,
    faction: "Terran",
    side: opts.side,
    stats,
    position: { x: opts.x, y: 0 },
    facing: 0,
    doctrine: { base: {}, rules: [] } satisfies Doctrine,
    classification: "frigate",
    ...(opts.formationId !== undefined
      ? { formationId: opts.formationId, role: opts.role }
      : {}),
  };
}

function byId<T extends { instanceId: string }>(rows: readonly T[] | undefined): Map<string, T> {
  // runBattle always emits descriptors and roster, but both are optional on the
  // BattleResult schema (legacy replays may omit them); fail loudly rather than
  // silently treating an absent table as empty.
  if (rows === undefined) throw new Error("expected rows are missing from the result");
  return new Map(rows.map((r) => [r.instanceId, r]));
}

describe("formation identity on the replay descriptor and roster", () => {
  it("carries formationId and role on the descriptor and roster when stamped", () => {
    const inputs: BattleInputs = {
      ships: [
        makeShip({ id: "a1", side: "attacker", x: -100, formationId: "form-vanguard", role: "vanguard" }),
        makeShip({ id: "d1", side: "defender", x: 100, formationId: "form-screen", role: "screen" }),
      ],
      attackerFleetId: "fleet-attacker",
      defenderFleetId: "fleet-defender",
      anomalies: [],
      seed: 42,
      maxTicks: DEFAULT_MAX_TICKS,
    };

    const result = runBattle(inputs);
    const descriptors = byId(result.descriptors);
    const roster = byId(result.roster);

    const a1d = descriptors.get("a1");
    const a1r = roster.get("a1");
    expect(a1d).toBeDefined();
    expect(a1r).toBeDefined();
    if (a1d === undefined || a1r === undefined) return;

    expect(a1d.formationId).toBe("form-vanguard");
    expect(a1d.role).toBe("vanguard");
    expect(a1r.formationId).toBe("form-vanguard");
    expect(a1r.role).toBe("vanguard");

    const d1d = descriptors.get("d1");
    expect(d1d?.formationId).toBe("form-screen");
    expect(d1d?.role).toBe("screen");
    expect(roster.get("d1")?.formationId).toBe("form-screen");
  });

  it("omits formationId and role keys entirely when a ship has no formation identity", () => {
    // A legacy/test ship with no formationId stamped must produce a descriptor
    // and roster entry byte-identical to the pre-formation shape: the keys are
    // absent, not present-as-undefined.
    const inputs: BattleInputs = {
      ships: [
        makeShip({ id: "a1", side: "attacker", x: -100 }),
        makeShip({ id: "d1", side: "defender", x: 100 }),
      ],
      attackerFleetId: "fleet-attacker",
      defenderFleetId: "fleet-defender",
      anomalies: [],
      seed: 42,
      maxTicks: DEFAULT_MAX_TICKS,
    };

    const result = runBattle(inputs);
    const descriptors = byId(result.descriptors);
    const roster = byId(result.roster);

    const a1d = descriptors.get("a1");
    const a1r = roster.get("a1");
    expect(a1d).toBeDefined();
    expect(a1r).toBeDefined();
    if (a1d === undefined || a1r === undefined) return;

    // Absent, not undefined-valued: locks the conditional-spread contract.
    expect("formationId" in a1d).toBe(false);
    expect("role" in a1d).toBe(false);
    expect("formationId" in a1r).toBe(false);
    expect("role" in a1r).toBe(false);
  });

  it("handles a mixed fleet: stamped ships carry identity, unstamped ships omit it", () => {
    const inputs: BattleInputs = {
      ships: [
        makeShip({ id: "a1", side: "attacker", x: -100, formationId: "form-a", role: "vanguard" }),
        makeShip({ id: "a2", side: "attacker", x: -80 }),
        makeShip({ id: "d1", side: "defender", x: 100 }),
      ],
      attackerFleetId: "fleet-attacker",
      defenderFleetId: "fleet-defender",
      anomalies: [],
      seed: 7,
      maxTicks: DEFAULT_MAX_TICKS,
    };

    const result = runBattle(inputs);
    const descriptors = byId(result.descriptors);
    const roster = byId(result.roster);

    expect(descriptors.get("a1")?.formationId).toBe("form-a");
    expect(roster.get("a1")?.formationId).toBe("form-a");
    expect(descriptors.get("a1")?.role).toBe("vanguard");

    expect("formationId" in (descriptors.get("a2") ?? {})).toBe(false);
    expect("formationId" in (roster.get("a2") ?? {})).toBe(false);
    expect("formationId" in (descriptors.get("d1") ?? {})).toBe(false);
  });

  it("does not leak formation identity into the frame stream", () => {
    // The descriptor/roster fields are once-per-battle metadata. The per-tick
    // BattleFrame ship snapshots must continue to carry no formationId, so the
    // frame bytes (and thus the cache key's frame hash) are unchanged.
    const inputs: BattleInputs = {
      ships: [
        makeShip({ id: "a1", side: "attacker", x: -100, formationId: "form-a", role: "vanguard" }),
        makeShip({ id: "d1", side: "defender", x: 100, formationId: "form-d", role: "screen" }),
      ],
      attackerFleetId: "fleet-attacker",
      defenderFleetId: "fleet-defender",
      anomalies: [],
      seed: 42,
      maxTicks: 2,
    };

    const result = runBattle(inputs);
    for (const frame of result.frames) {
      for (const ship of frame.ships) {
        expect("formationId" in ship).toBe(false);
        expect("role" in ship).toBe(false);
      }
    }
  });
});
