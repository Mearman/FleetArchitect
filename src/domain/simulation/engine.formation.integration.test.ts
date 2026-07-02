import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { runBattleCached } from "@/domain/cache/run-battle-cached";
import type { BattleInputs, CombatShip } from "@/domain/simulation/types";
import type { BattleFrame } from "@/schema/battle";
import type { Doctrine } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";

/**
 * Integration coverage for the formation-aware runtime: a small doctrine-active
 * fleet run through the full tick loop, asserting the formation-doctrine pass's
 * conditional behaviour actually manifests in the frame stream — and that a
 * doctrine-active fleet is byte-identical across two same-seed runs.
 *
 * The pass is unit-tested in engine/formation-doctrine.unit.test.ts; this file
 * wires it through `runBattle` so the end-to-end chain is guarded against
 * integration drift: `stepFormationDoctrine` evaluates the unified rules and
 * writes `aiFire`, `fireWeapons` reads it and suppresses fire, and the snapshot
 * carries the resulting beam record. The doctrine uses a REAL formation-state
 * predicate (`formationEngaged` against the carrier formation's aggregate) AND
 * a temporal gate (`tickAfter`), combined with `all`, so both the aggregation
 * and the reference-resolution paths execute.
 *
 * Fleet: an attacker carrier formation plus an attacker escort formation
 * against a single defender target drone. The escort is the ship under test;
 * it carries the doctrine. Ships are stationary (zero thrust / turn rate) and
 * deployed within the baseline visual-line-of-sight radius, so geometry — and
 * therefore the frame stream — is fixed for the whole battle.
 */

/** Tick on which the escort's holdFire rule is due to fire (tickAfter is
 *  inclusive, so the rule first holds on this tick). */
const HOLD_TICK = 5;
const MAX_TICKS = 30;
const SEED = 42;

/** A short-range hitscan beam. `cooldown: 0` fires every tick, giving a dense,
 *  unambiguous fire signature in the frame stream before the rule fires. */
function beam(): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 300,
    cooldown: 0,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
  };
}

/** A minimal aggregated combatant stamped with formation identity. Stationary
 *  (thrust / turn rate 0) so the deployment geometry holds for every tick. */
function makeShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  formationId: string;
  role: string;
  doctrine: Doctrine;
  armed?: boolean;
  structure?: number;
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
    structure: opts.structure ?? 200,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 1,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: opts.armed === true ? [{ slotId: `slot-${opts.id}`, effect: beam() }] : [],
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
    doctrine: opts.doctrine,
    classification: "frigate",
    formationId: opts.formationId,
    formationChain: ["root", opts.formationId],
    role: opts.role,
  };
}

const noRules: Doctrine = { base: {}, rules: [] };

/** The escort holds fire once the battle reaches HOLD_TICK AND its carrier
 *  formation is engaged. The `all` combinator means BOTH the temporal gate and
 *  the formation-state predicate must resolve true, so the aggregate build and
 *  the friendly-role reference resolution both execute end to end. */
const escortHoldDoctrine: Doctrine = {
  base: {},
  rules: [
    {
      condition: {
        kind: "all",
        of: [
          { kind: "tickAfter", tick: HOLD_TICK },
          { kind: "formationEngaged", reference: { kind: "friendly", role: "carrier" } },
        ],
      },
      then: { fire: "holdFire" },
    },
  ],
};

/** Control: the same temporal gate, but the formation reference names a role no
 *  ship carries. `formationEngaged` then never resolves, the rule never fires,
 *  and the escort keeps firing — proving the formation predicate (not the
 *  timer alone) is what gates the hold. */
const escortWrongRoleDoctrine: Doctrine = {
  base: {},
  rules: [
    {
      condition: {
        kind: "all",
        of: [
          { kind: "tickAfter", tick: HOLD_TICK },
          { kind: "formationEngaged", reference: { kind: "friendly", role: "no-such-role" } },
        ],
      },
      then: { fire: "holdFire" },
    },
  ],
};

function buildFleet(escortDoctrine: Doctrine): BattleInputs {
  return {
    ships: [
      // Carrier formation: an unarmed hull fielded solely as the formation the
      // escort's doctrine references. It still acquires the drone as a target
      // (targeting needs no weapon), so its aggregate's `engaged` flag is true.
      makeShip({
        id: "a-carrier",
        side: "attacker",
        x: -200,
        formationId: "form-carrier",
        role: "carrier",
        doctrine: noRules,
      }),
      // Escort formation: the armed ship under test. Faces +x toward the drone
      // at 100 m — well inside the 300 m beam range and the firing arc.
      makeShip({
        id: "a-escort",
        side: "attacker",
        x: -50,
        formationId: "form-escort",
        role: "escort",
        armed: true,
        doctrine: escortDoctrine,
      }),
      // Defender target drone: unarmed, durable enough to absorb a full battle
      // of beam fire so the escort never loses its target to a kill.
      makeShip({
        id: "d-drone",
        side: "defender",
        x: 50,
        formationId: "form-strike",
        role: "strike",
        structure: 5000,
        doctrine: noRules,
      }),
    ],
    attackerFleetId: "fleet-attacker",
    defenderFleetId: "fleet-defender",
    anomalies: [],
    seed: SEED,
    maxTicks: MAX_TICKS,
  };
}

/** The tick numbers on which the escort fired its beam. A beam fired on tick N
 *  is snapshot on frame N with `emissionTicks === SIM.beamEmissionTicks - 1`
 *  (fireWeapons pushes the full duration, ageBeams decrements once before the
 *  snapshot is yielded); a beam lingering from tick N-1 shows one fewer still.
 *  Filtering to the freshly-fired value isolates the act of firing to a tick,
 *  so a hold that begins on HOLD_TICK reads as "no fresh fire on/after
 *  HOLD_TICK" rather than as a lingering fading beam. */
function escortFireTicks(
  frames: readonly BattleFrame[],
  escortId = "a-escort",
): number[] {
  const fired: number[] = [];
  for (const f of frames) {
    const beams = f.beams ?? [];
    if (beams.some((b) => b.sourceId === escortId && b.emissionTicks >= 2)) {
      fired.push(f.tick);
    }
  }
  return fired;
}

describe("formation-doctrine integration: a doctrine-active fleet through a full battle", () => {
  it("fires the escort's holdFire rule once the carrier is engaged past the hold tick, suppressing beam fire", async () => {
    const held = await runBattleCached(buildFleet(escortHoldDoctrine));
    const fireTicks = escortFireTicks(held.frames);

    // Sanity: the escort was actually shooting before the rule could fire, so
    // the suppression below is a real change in behaviour, not an idle gun.
    expect(
      fireTicks.some((t) => t < HOLD_TICK),
      "escort should fire before the hold tick",
    ).toBe(true);

    // The doctrine fired: from HOLD_TICK onward the escort holds fire. The
    // fresh-fire filter excludes any beam lingering from tick HOLD_TICK - 1, so
    // this asserts no NEW shot on or after the hold tick.
    expect(
      fireTicks.every((t) => t < HOLD_TICK),
      "escort should hold fire on and after the hold tick",
    ).toBe(true);

    // The escort must still have the drone locked after it went silent — this
    // proves the fire stopped because of holdFire, not because the target was
    // lost or the escort destroyed. Targeting runs before fireWeapons and does
    // not read the fire discipline, so the lock survives the hold.
    const late = held.frames.find((f) => f.tick >= HOLD_TICK + 2);
    const escortLate = late?.ships.find((s) => s.instanceId === "a-escort");
    expect(escortLate, "escort should still be present late in the battle").toBeDefined();
    expect(escortLate?.targetId, "escort should still hold the drone locked while holding fire").toBe("d-drone");
  });

  it("does not suppress fire when the formation reference resolves to no formation", async () => {
    // Same temporal gate, wrong role: formationEngaged never resolves, so the
    // rule never fires and the escort keeps shooting past the hold tick. This
    // is the contrasting value — identical fleet and tick gate, different
    // formation reference — that isolates the formation predicate as the cause.
    const wrongRole = await runBattleCached(buildFleet(escortWrongRoleDoctrine));
    const fireTicks = escortFireTicks(wrongRole.frames);

    expect(
      fireTicks.some((t) => t >= HOLD_TICK),
      "escort should keep firing past the hold tick when the formation reference is unsatisfiable",
    ).toBe(true);
  });

  it("produces byte-identical frames across two same-seed runs of a doctrine-active fleet", () => {
    // Formation-determinism: the doctrine pass, the relational targeting
    // context, and the fire gate are all pure functions of instanceId-sorted
    // state over a seeded rng, so two runs over the same resolved inputs must
    // reproduce the frame stream exactly. The fleet carries formation identity
    // and an active rule, so this guards the pass's determinism contract for
    // the doctrine-active case (the preset-byte-identity gate is separate).
    const run = () => runBattle(buildFleet(escortHoldDoctrine));
    const a = run();
    const b = run();
    expect(b.frames).toEqual(a.frames);
  });
});
