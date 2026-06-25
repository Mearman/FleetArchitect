import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { WeaponEffect } from "@/schema/module";
import {
  core,
  inputs,
  moduleOf,
  ship,
  sensor,
  awarenessAt,
} from "@/domain/simulation/engine.awareness-helpers";

/**
 * Permanent signature-sanity guard for battlefield-medium phase 4. This test
 * exists because the phase shipped GREEN but BROKEN: weapon fire deposited ε
 * into the medium grid, yet NO `medium#` contact ever formed in any receiver's
 * awareness. Two root causes (both fixed in this change):
 *
 *  F1 — Sustained cell radiation was routed through the DISCRETE light-sphere
 *       `formsContact` path, whose `isReaching` predicate only fires when the
 *       observer sits inside the emitting cell (`dist === 0` at `t === t0`).
 *       Result: zero medium contacts at any range. The fix routes sustained cell
 *       radiation through `continuousContact` (the inverse-square steady-state
 *       path a hull's ambient emission uses).
 *
 *  F2 — The coupling was ~1e5x too weak (it anchored to the no-diffusion
 *       equilibrium ε, which diffusion prevents the cell from ever reaching).
 *       The fix recalibrates against the REALISED cell ε the solver actually
 *       produces, so a missile burn is detectable at a few kilometres.
 *
 * If this test ever goes red, the feature is broken again — do not weaken the
 * assertion; fix the reception path or the coupling.
 *
 * The scenario: one side fires a powered round whose burning motor deposits ε
 * along its flight path. The other side has a passive receiver (a short-range
 * sensor, gain < 1) sited so that BOTH enemy hulls lie BEYOND its reach but the
 * missile's burning cells — which travel away from the launcher toward the
 * receiver — pass within its reach. Any `medium#` contact the receiver logs is
 * therefore unambiguously the plume's continuous radiation, not a hull detection
 * bleeding through: the hulls are out of range, the plume is not.
 */

/**
 * A powered round: heavy (50 kg), long-burn motor that deposits exhaust ε along
 * its path. Slow enough to dwell several ticks per 500 m cell (so each cell it
 * passes through accumulates a detectable ε before the round moves on) and
 * long-burning enough to still be depositing when it has crossed the arena
 * toward the receiver. Mirrors the catalogue powered-ordnance derivation
 * (`ordnance-motor.ts` + `combat-scale.ts`): motor acceleration, burnTicks, and
 * round mass are the same shape a torpedo carries.
 */
function poweredRound(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "missile",
    damage: 1,
    range: 30_000,
    cooldown: 3,
    projectileSpeed: 200,
    projectileMass: 50,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    facing: 0,
    powered: true,
    guided: false,
    thrust: 40,
    burnTicks: 700,
    ...over,
  };
}

describe("engine.medium-signatures — sustained-cell radiation is detectable", () => {
  it("a burning powered round's plume forms a medium# contact in a passive receiver beyond hull range", () => {
    // Geometry (metres; the world is metre-scaled). The receiver o1 sits at the
    // world origin with a SHORT sensor (3 km, gain (3000/5000)² = 0.36). Both
    // enemy hulls are 5 km from o1 — beyond its 3 km sensor reach — so o1 never
    // detects either hull by ambient emission. The attacker a1 fires a powered
    // round toward the defender d1; the round flies roughly along y ≈ 0 from
    // a1 (-5000, 0) toward d1 (+5000, 0), passing within o1's 3 km reach as it
    // crosses the arena. While the round burns, each cell it occupies radiates
    // continuously; the cells it passes through near the origin are within o1's
    // reach and above the noise floor, so o1 logs `medium#` contacts — but never
    // a hull contact.
    //
    // The battle runs long enough (700 ticks) for the round to fly from a1
    // across the origin toward d1 while its motor is still burning (burnTicks
    // 700 ≈ 23 s of motor life).
    const result = runBattle(
      inputs(
        [
          ship("a1", "attacker", -5000, 0, [
            ...core(),
            moduleOf("w", poweredRound(), 1, 0, { powerDraw: 0 }),
            // a1 carries a long-range sensor so it can acquire d1 and fire.
            moduleOf("se", sensor(25_000), -1, 0),
          ]),
          ship("d1", "defender", 5000, 0, [
            ...core(),
            moduleOf("se", sensor(8_000), 1, 0),
          ]),
          // o1: the receiver under test. Short sensor, both enemy hulls beyond
          // its reach (5 km > 3 km), so it sees the plume but neither hull.
          ship("o1", "defender", 0, 0, [
            ...core(),
            moduleOf("se", sensor(3_000), 1, 0),
          ]),
        ],
        [],
        700,
      ),
    );

    // THE CRITICAL ASSERTION. Scan every frame's snapshot contacts for a medium#
    // contact observed by o1. The round's motor deposits ε each tick it burns;
    // the cell it occupies radiates continuously and — via the continuousContact
    // reception path (the F1 fix) at the recalibrated coupling (the F2 fix) —
    // forms a transient `medium#<col>_<row>` contact in o1's awareness. At least
    // one such contact must appear over the round's burn. The prior broken
    // implementation produced ZERO such contacts at any range; this assertion
    // pins the fix.
    let mediumContactsForO1 = 0;
    for (let t = 0; t < result.frames.length; t += 1) {
      const awareness = awarenessAt(result, t);
      for (const c of awareness.contacts) {
        if (c.observerId === "o1" && c.enemyId.startsWith("medium#")) {
          mediumContactsForO1 += 1;
        }
      }
    }
    expect(
      mediumContactsForO1,
      "o1 (passive receiver beyond hull range) must detect at least one medium# " +
        "contact from the powered round's burning plume — if this is 0, sustained-cell " +
        "radiation is not reaching the reception path (regression of the phase-4 bug)",
    ).toBeGreaterThan(0);

    // Belt-and-braces: o1 must NOT have detected either enemy hull by its
    // ambient emission (both hulls sit 5 km away, beyond o1's 3 km sensor).
    // This confirms the medium# contacts are genuinely the plume's radiation,
    // not a hull detection bleeding through — the contacts the assertion above
    // counted could not have come from a hull.
    let detectedHull = false;
    for (let t = 0; t < result.frames.length; t += 1) {
      const awareness = awarenessAt(result, t);
      for (const c of awareness.contacts) {
        if (c.observerId === "o1" && (c.enemyId === "a1" || c.enemyId === "d1")) {
          detectedHull = true;
        }
      }
    }
    expect(detectedHull, "o1 must be beyond hull-ambient range of both ships").toBe(false);
  });
});
