import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import {
  core,
  inputs,
  moduleOf,
  ship,
  sensor,
  awarenessAt,
} from "@/domain/simulation/engine.awareness-helpers";
import { EM_HULL_AMBIENT_EMISSION } from "@/domain/simulation/engine/em-anchors";

/**
 * Permanent dazzle-sanity guard for battlefield-medium phase 5. An intense
 * incident emission SATURATES the receiver, raising its effective noise floor
 * for a recovery period, so a sensor blinded by a nearby bright source
 * temporarily loses its weaker contacts. This test pins that behaviour: an
 * observer holding a fix on a distant hull LOSES that fix for at least one tick
 * when a bright source passes close, then RECOVERS it once the source moves on
 * and the saturation decays. If this test ever goes red, dazzle is broken — do
 * not weaken the assertions; fix the saturation/decay/floor wiring.
 *
 * The scenario is constructed so the lost-then-recovered contact is
 * unambiguously the dazzle effect (raised floor) and not geometry:
 *  - The faint target `t1` is STATIONARY at a fixed range where the observer
 *    holds a stable fix before the flash. It never moves, never dies, never
 *    occludes — the ONLY thing that can drop it is the observer's floor rising.
 *  - The bright source `b1` carries an active emitter 1000× a baseline hull's
 *    ambient emission, so its continuous emission dazzles when it passes close
 *    (well above the dazzle threshold), but it contributes no weapon damage and
 *    never occludes the observer→target sight line (it flies past on a parallel
 *    line 3 km off the observer→target axis).
 *  - The observer has no weapons, so neither enemy is ever damaged and the
 *    geometry is the only moving part.
 */

/** An active emitter 1000× a baseline hull's ambient emission: a dazzle source
 *  whose continuous self-emission (ambient + transmit power) is intense enough
 *  to clear the dazzle threshold at several kilometres. */
function dazzleEmitter() {
  return sensor(10_000, { mode: "active", emitStrength: 1000 * EM_HULL_AMBIENT_EMISSION });
}

describe("engine.medium-dazzle — receiver saturation drops and recovers a contact", () => {
  it("an observer loses a held hull fix while a bright source passes, then recovers it", () => {
    // Geometry (metres). o1 (defender) sits at the origin with a 12 km sensor
    // (gain (12000/5000)² = 5.76). The faint target t1 (attacker) is stationary
    // 9 km away along -x, where o1 holds a stable fix (t1's baseline emission
    // received at 9 km = (5000/9000)² ≈ 0.31 × floor, comfortably above
    // floor/gain ≈ 0.174 — so o1 sees t1 while its receiver is recovered). The
    // bright source b1 (attacker, 1000× ambient active emitter) flies past on a
    // parallel line 3 km above the x-axis: it starts 25 km to the -x side,
    // drifts east at 1000 m/tick under its hold order (Newtonian coast), and
    // passes the observer around tick 25 at closest approach 3 km. While b1 is
    // close its emission dazzles o1, the floor rises above t1's received
    // strength, and o1 drops the t1 fix; once b1 has moved away the saturation
    // decays and the t1 fix returns.
    const result = runBattle(
      inputs(
        [
          // o1: the observer under test. 12 km omni sensor, no weapons.
          ship("o1", "defender", 0, 0, [...core(), moduleOf("se", sensor(12_000), 1, 0)]),
          // t1: the stationary faint target o1 tracks. 9 km away along -x.
          ship("t1", "attacker", -9000, 0, [...core()]),
          // b1: the bright source. 1000× ambient active emitter, drifting east
          // past the observer at 1000 m/tick under a hold order (coasts — no
          // thrust, no braking). Closest approach 3 km at ~tick 25.
          ship(
            "b1",
            "attacker",
            -25_000,
            3_000,
            [...core(), moduleOf("se", dazzleEmitter(), 1, 0)],
            { velocity: { x: 1000, y: 0 } },
          ),
        ],
        [],
        70,
      ),
    );

    // Per-tick membership of o1's contact set restricted to the faint target.
    // `holdsT1[t]` is true exactly when o1 has a live t1 fix on tick t.
    const holdsT1: boolean[] = [];
    for (let t = 0; t < result.frames.length; t += 1) {
      const awareness = awarenessAt(result, t);
      const has = awareness.contacts.some(
        (c) => c.observerId === "o1" && c.enemyId === "t1",
      );
      holdsT1.push(has);
    }

    // (a) Before the flash: o1 holds the t1 fix. The opening ticks have b1 far
    //     away (no dazzle), so t1 must be detected. Pins that the fixture
    //     genuinely gives o1 the contact to lose.
    const detectedBeforeFlash = holdsT1[0] === true || holdsT1[1] === true;
    expect(
      detectedBeforeFlash,
      "o1 must hold the t1 fix before the bright source arrives (otherwise the " +
        "fixture is not exercising dazzle — there is no contact to lose)",
    ).toBe(true);

    // (b) During the pass: o1 LOSES the t1 fix for at least one tick. b1's
    //     emission saturates o1's receiver, the floor rises above t1's received
    //     strength, and t1 falls below it. t1 never moves and never dies, so the
    //     ONLY cause of the drop is the raised floor — the core dazzle effect.
    //     The prior phase-4 lesson was a green-but-broken feature with no
    //     behavioural assertion; this is the assertion that pins dazzle works.
    const lostDuringPass = holdsT1.some((h) => h === false);
    expect(
      lostDuringPass,
      "o1 must LOSE the t1 fix for at least one tick while the bright source " +
        "passes (raised receiver floor from saturation) — if this never happens, " +
        "dazzle is not raising the floor enough to drop a contact (regression of " +
        "the phase-5 feature)",
    ).toBe(true);

    // (c) After the pass: o1 RECOVERS the t1 fix. b1 has moved far enough that
    //     its received strength falls below the dazzle threshold; no new boost
    //     accumulates and the carried saturation decays at the recovery
    //     timescale, so the floor falls back to baseline and t1 is detected
    //     again. The last tick (well after the pass) must hold t1.
    const recoveredAfterPass = holdsT1[holdsT1.length - 1] === true;
    expect(
      recoveredAfterPass,
      "o1 must RECOVER the t1 fix after the bright source passes and the " +
        "saturation decays — if the contact never returns, dazzle is not " +
        "decaying (the receiver stays permanently blinded)",
    ).toBe(true);

    // Belt-and-braces: the lost-then-recovered pattern is a genuine transient.
    // Find the first tick the contact was lost and confirm it is later found
    // again, so the assertion is not satisfied by a coincidental end-of-run
    // state.
    const firstLost = holdsT1.indexOf(false);
    const firstRegainedAfter =
      firstLost >= 0 ? holdsT1.indexOf(true, firstLost + 1) : -1;
    expect(
      firstRegainedAfter,
      "the t1 fix must be lost and then genuinely regained (a transient blind " +
        `window), not dropped permanently; firstLost=${firstLost}`,
    ).toBeGreaterThan(firstLost);
  });
});
