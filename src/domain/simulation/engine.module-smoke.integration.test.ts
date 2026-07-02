import { beforeAll, describe, expect, it } from "vitest";
import { runBattleCached } from "@/domain/cache/run-battle-cached";
import type { CombatShip } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import {
  beam,
  inputs,
  modularShip,
  moduleOf,
  targetDummy,
} from "./engine.factions-tech-helpers";

/**
 * Module-coexistence smoke test.
 *
 * One ship carries a representative of every combat-relevant kind in the
 * {@link ModuleEffect} union, run through the full live tick loop against a
 * durable target dummy. The bar is coexistence, not correctness: a new module
 * kind that breaks the aggregate pipeline — throws on instantiation, poisons a
 * frame with NaN / Infinity, or silently suppresses weapon fire — fails here.
 * Per-kind behaviour is covered by the unit suites; this file guards the union.
 *
 * {@link modularShip} already mounts the core combat modules (hull / command
 * bridge, engine cells incl. lateral RCS-as-engines, a reaction wheel, an omni
 * sensor, the weapon, and a shield). The {@link EXTRA_EFFECTS} table adds one
 * cell per OTHER effect kind so the single hull spans the full discriminated
 * union. The extras sit in a connected row one cell below the sensor so they
 * share the command-bridge component and never trigger an opening tick-0
 * break-apart into a second chunk.
 */

const ARMED_ID = "a-smoke";
const DUMMY_ID = "d-smoke";
const MAX_TICKS = 30;
const SEED = 42;

/**
 * One representative payload per module-effect kind the base {@link modularShip}
 * does NOT already mount. Values are sane catalogue-grade figures; the intent is
 * coverage of every branch of the union, not a balanced design. Each module is
 * crewless and draws no power (the helper's defaults), so it stays online
 * without dragging in crew / power resupply — the smoke test exercises effect
 * parsing and per-kind sim hooks, not resource economics. Active-module
 * cooldowns are sized to fire at least once within {@link MAX_TICKS} ticks so
 * the spawn / launch / teleport code paths actually execute end to end.
 *
 * The reactor is DERATED well below the catalogue's GW-scale output (a real
 * fusion core feeds ~1.5 GW into a kilotonne armoured hull with proportionate
 * thermal mass). This fixture is a lightweight grid of 5 kg cells, so a
 * catalogue-grade reactor dumps its waste heat into a thermal mass orders of
 * magnitude too small: the opening transient spikes the thermal field,
 * destroys a dozen cells, and spills the structure pool to zero on tick 1 —
 * disarming the ship before it can fire. A 100 MW output keeps the same `power`
 * effect kind online without the fixture cooking itself; the kind under test is
 * the effect, not the wattage.
 */
const EXTRA_EFFECTS: ReadonlyArray<{ slot: string; effect: ModuleEffect }> = [
  { slot: "reactor", effect: { kind: "power", output: 1e8 } },
  { slot: "crew", effect: { kind: "crew", capacity: 8 } },
  {
    slot: "pd",
    effect: {
      kind: "pointDefense",
      damage: 5,
      range: 120,
      cooldown: 1,
      hitChance: 0.6,
      tracking: 0.2,
    },
  },
  { slot: "repair", effect: { kind: "repair", repairRate: 2 } },
  { slot: "magazine", effect: { kind: "magazine", ammoStored: 200 } },
  {
    slot: "comms",
    effect: {
      kind: "comms",
      commsType: "omni",
      range: 500,
      arc: Math.PI,
      bearing: 0,
      channel: 0,
      bandwidth: 4,
    },
  },
  { slot: "rcs", effect: { kind: "rcs", torque: 5000 } },
  {
    slot: "blink",
    effect: { kind: "blink", mode: "tactical", jumpRange: 60, cooldown: 15 },
  },
  {
    slot: "afterburner",
    effect: {
      kind: "afterburner",
      thrustBoost: 1.4,
      turnBoost: 1.4,
      duration: 5,
      cooldown: 20,
    },
  },
  {
    slot: "overcharge",
    effect: {
      kind: "overcharge",
      powerSurge: 1e9,
      duration: 5,
      cooldown: 20,
    },
  },
  { slot: "cloak", effect: { kind: "cloak", decloakTicks: 10 } },
  {
    slot: "signature",
    effect: { kind: "signature", acquisitionMultiplier: 0.6 },
  },
  {
    slot: "ecm",
    effect: { kind: "ecm", trackingReduction: 0.3, lockBreakChance: 0.1 },
  },
  { slot: "eccm", effect: { kind: "eccm", trackingRestore: 0.5 } },
  {
    slot: "decoy",
    effect: {
      kind: "decoy",
      decoyCount: 2,
      duration: 20,
      cooldown: 15,
      decoyHp: 30,
    },
  },
  {
    slot: "aura",
    effect: {
      kind: "commandAura",
      radius: 300,
      accuracyBonus: 0.2,
      rangeBonus: 0.1,
    },
  },
  {
    slot: "hangar",
    effect: {
      kind: "hangar",
      droneCount: 2,
      launchCooldown: 12,
      droneHp: 30,
      droneDamage: 5,
      droneRange: 150,
      droneSpeed: 4,
    },
  },
  {
    slot: "mines",
    effect: {
      kind: "mineLayer",
      mineCount: 2,
      mineDamage: 50,
      mineRadius: 40,
      layCooldown: 15,
      armingDelay: 5,
    },
  },
  {
    slot: "boarding",
    effect: {
      kind: "boarding",
      podCount: 1,
      troops: 3,
      range: 150,
      cooldown: 15,
    },
  },
];

/**
 * Build the multi-module smoke ship: a {@link modularShip} core (command,
 * drive, reaction wheel, omni sensor, beam, shield) extended with one cell per
 * extra effect kind. The extras occupy row 2 starting at col 0, so the first
 * extra sits directly below the sensor (row 1) and the whole extras row is
 * 4-connected into the command-bridge component — no opening-tick split.
 */
function buildArmedShip(): CombatShip {
  const ship = modularShip({
    id: ARMED_ID,
    side: "attacker",
    x: -150,
    y: 0,
    facing: 0,
    structure: 1000,
    shield: 300,
    // A small thrust keeps the drive cells mounted (coverage) without slinging
    // the ship into collision; the hold order station-keeps at the opening
    // range so the beam envelope (400 m) comfortably covers the dummy.
    thrust: 0.5,
    turnRate: 0.1,
    weapons: [beam({ damage: 30, cooldown: 2 })],
    orders: { engageRange: "hold" },
  });
  // modularShip always returns a per-module ship, but `modules` is optional on
  // the CombatShip interface (legacy aggregated ships omit it). Narrow with a
  // guard so the push below is typed, not asserted.
  if (ship.modules === undefined) {
    throw new Error("modularShip fixture returned no modules");
  }
  const modules = ship.modules;
  for (let i = 0; i < EXTRA_EFFECTS.length; i += 1) {
    const e = EXTRA_EFFECTS[i];
    if (e === undefined) continue;
    modules.push(moduleOf(`${ARMED_ID}-${e.slot}`, e.effect, i, 2));
  }
  return ship;
}

describe("module smoke: every module kind coexists in one live battle", () => {
  // One battle shared across the assertions — a smoke test guards the union
  // once; it does not re-exercise per kind. Computed once in `beforeAll` so the
  // cached result is reused across test runs.
  let result: BattleResult;
  let firstFrame: BattleFrame;

  beforeAll(async () => {
    result = await runBattleCached(
      inputs(
        [
          buildArmedShip(),
          // Durable dummy: a shield that depletes under beam fire (exercising
          // the shield-damage path) and enough on-axis cells that the beam
          // always finds a live target across all 30 ticks (each 0-HP cell dies
          // on the first hit it takes, passing damage onward).
          targetDummy({
            id: DUMMY_ID,
            side: "defender",
            x: 150,
            y: 0,
            structure: 5000,
            shield: 200,
            absorbingCells: 30,
          }),
        ],
        MAX_TICKS,
        SEED,
      ),
    );
    const frame = result.frames[0];
    if (frame === undefined) throw new Error("smoke battle produced no frames");
    firstFrame = frame;
  });

  it("completes the battle with a valid winner and frames produced", () => {
    expect(result.frames.length, "battle should produce frames").toBeGreaterThan(0);
    expect(result.ticks, "battle should advance at least one tick").toBeGreaterThan(0);
    expect(
      ["attacker", "defender", "draw"],
      "winner should be a declared side",
    ).toContain(result.winner);
  });

  it("fires the armed ship's weapon at least once across the frames", () => {
    const fired = result.frames.some((f) => {
      const beamFromArmed = (f.beams ?? []).some((b) => b.sourceId === ARMED_ID);
      // The armed ship is the only combatant with a weapon, so any projectile
      // in flight is also evidence it fired (defensive: covers a future swap
      // to a kinetic weapon, which spawns projectiles instead of beams).
      const anyProjectile = f.projectiles.length > 0;
      return beamFromArmed || anyProjectile;
    });
    expect(fired, "armed ship should have fired a beam or projectile").toBe(true);
  });

  it("keeps every ship numeric field finite across all frames", () => {
    for (const frame of result.frames) {
      for (const ship of frame.ships) {
        const fields: ReadonlyArray<{
          name: string;
          value: number | undefined;
          required: boolean;
        }> = [
          { name: "x", value: ship.x, required: true },
          { name: "y", value: ship.y, required: true },
          { name: "structure", value: ship.structure, required: true },
          { name: "shield", value: ship.shield, required: true },
          { name: "facing", value: ship.facing, required: false },
          { name: "vx", value: ship.vx, required: false },
          { name: "vy", value: ship.vy, required: false },
        ];
        for (const field of fields) {
          if (field.value === undefined) {
            // An absent OPTIONAL field is valid; an absent REQUIRED field is
            // invalid state the smoke test must catch.
            expect(
              field.required,
              `tick ${frame.tick} ship ${ship.instanceId}: required field "${field.name}" is undefined`,
            ).toBe(false);
            continue;
          }
          expect(
            Number.isFinite(field.value),
            `tick ${frame.tick} ship ${ship.instanceId}: field "${field.name}" is non-finite (${String(field.value)})`,
          ).toBe(true);
        }
      }
    }
  });

  it("deals damage to the target dummy (shield or structure dropped)", () => {
    const dummyStart = firstFrame.ships.find((s) => s.instanceId === DUMMY_ID);
    expect(dummyStart, "dummy should be present in the opening frame").toBeDefined();
    if (dummyStart === undefined) return;

    const damaged = result.frames.some((f) => {
      const d = f.ships.find((s) => s.instanceId === DUMMY_ID);
      if (d === undefined) return false;
      return d.shield < dummyStart.shield || d.structure < dummyStart.structure;
    });
    expect(
      damaged,
      "dummy should have taken shield or structure damage by end of battle",
    ).toBe(true);
  });
});
