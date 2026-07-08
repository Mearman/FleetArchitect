import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  buildDirectContacts,
  hullReceptionIsNegligible,
  observerMaxReceptionGain,
} from "@/domain/simulation/engine/awareness-direct";
import { buildDirectContactsReference } from "@/domain/simulation/engine/awareness.reference";
import { emReceives, hullDazzleContribution } from "@/domain/simulation/engine/em-reception";
import { freshAwarenessScratch } from "@/domain/simulation/engine/awareness";
import { fillSensorUnits, sensorUnitsOf } from "@/domain/simulation/engine/sensors";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { SimShip } from "@/domain/simulation/engine/types";
import {
  core,
  moduleOf,
  sensor,
  ship,
} from "@/domain/simulation/engine.awareness-helpers";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";

/**
 * Equivalence proof for the anomaly-free awareness early-out
 * ({@link hullReceptionIsNegligible}): the optimised direct-detection path
 * ({@link buildDirectContacts}) must produce byte-identical direct-contacts maps
 * and dazzle accumulators to the frozen reference oracle
 * ({@link buildDirectContactsReference}), and the strict bound must be SOUND —
 * whenever it skips a pair, that pair provably forms no contact and contributes
 * zero dazzle. The per-frame digest gate (engine.lossless-digest.integration)
 * is the whole-battle arbiter; this unit test is the finer-grained, targeted
 * regression guard that stresses the bound's decision boundary directly.
 */

/** Convert fixture CombatShips to engine-internal SimShips (deterministic rng). */
function simShips(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** A dazzle accumulator seeded to 0 for every ship, as computeAwareness does. */
function seededDazzleAccum(ships: readonly SimShip[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of ships) m.set(s.instanceId, 0);
  return m;
}

/** `alive` (instanceId-sorted) + the two enemy-side arrays, as computeAwareness
 *  builds them, so both paths see identical inputs. */
function aliveAndEnemies(ships: readonly SimShip[]) {
  const alive = [...ships].sort((a, b) =>
    a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
  );
  const enemiesBySide: { attacker: SimShip[]; defender: SimShip[] } = {
    attacker: [],
    defender: [],
  };
  for (const s of alive) {
    if (s.side === "defender") enemiesBySide.attacker.push(s);
    else enemiesBySide.defender.push(s);
  }
  return { alive, enemiesBySide };
}

// ---------------------------------------------------------------------------
// 1. The strict bound is sound: skip ⟹ no contact AND zero dazzle.
// ---------------------------------------------------------------------------

describe("engine.awareness early-out — strict bound is sound", () => {
  // Observer receivers: a naked eye (max gain 1) and a long-range omni sensor
  // (gain (50_000/5_000)² = 100), each stationary and on a fast closing burn.
  type ObserverDef = {
    id: string;
    modules: ResolvedModule[];
    velocity?: { x: number; y: number };
  };
  const observerBuilders: ObserverDef[] = [
    { id: "naked", modules: [...core()] },
    { id: "naked-fast", modules: [...core()], velocity: { x: -90, y: 40 } },
    { id: "sensor", modules: [...core(), moduleOf("se", sensor(50_000), 1, 0)] },
  ];
  // Enemy emissions: a quiet baseline hull and a very bright active emitter.
  const enemyBuilders: { id: string; modules: ResolvedModule[] }[] = [
    { id: "quiet", modules: [...core()] },
    {
      id: "loud",
      modules: [
        ...core(),
        moduleOf("ae", sensor(1_000, { mode: "active", emitStrength: 1e13 }), 1, 0),
      ],
    },
  ];
  const separations = [100, 500, 2_000, 10_000, 50_000, 200_000];
  const enemyVelocities = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: -80, y: 60 },
  ];

  for (const ob of observerBuilders) {
    for (const eb of enemyBuilders) {
      for (const sep of separations) {
        for (const ev of enemyVelocities) {
          const label = `${ob.id} vs ${eb.id} @ ${sep}m, enemy v(${ev.x},${ev.y})`;
          it(`skip ⟹ no contact and zero dazzle — ${label}`, () => {
            const observerC = ship("obs", "attacker", 0, 0, ob.modules, {
              velocity: ob.velocity,
            });
            const enemyC = ship("ene", "defender", sep, 0, eb.modules, {
              velocity: ev,
            });
            const pair = simShips([observerC, enemyC]);
            const observer = pair[0];
            const enemy = pair[1];
            if (observer === undefined || enemy === undefined) {
              throw new Error("fixture failed to convert observer/enemy");
            }
            const sensors = sensorUnitsOf(observer);
            const observerSpeed = Math.sqrt(
              observer.velX * observer.velX + observer.velY * observer.velY,
            );
            const observerMaxGain = observerMaxReceptionGain(sensors);

            const skip = hullReceptionIsNegligible(
              observer,
              enemy,
              observerSpeed,
              observerMaxGain,
            );
            if (!skip) return; // bound did not skip — nothing to prove here
            // The bound skipped this pair, so the full path MUST agree it forms
            // no contact and contributes exactly zero dazzle.
            expect(emReceives(observer, enemy, [], sensors)).toBe(false);
            expect(hullDazzleContribution(observer, enemy, [])).toBe(0);
          });
        }
      }
    }
  }

  it("the bound fires for a far pair and does not fire for a close contact", () => {
    // Far: a baseline hull at 200 km is far below the floor (and the dazzle
    // threshold) even to a long-range sensor — provably negligible.
    const far = simShips([
      ship("obs", "attacker", 0, 0, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
      ship("ene", "defender", 200_000, 0, [...core()]),
    ]);
    const farObs = far[0];
    const farEne = far[1];
    if (farObs === undefined || farEne === undefined) {
      throw new Error("far fixture failed to convert");
    }
    expect(
      hullReceptionIsNegligible(
        farObs,
        farEne,
        0,
        observerMaxReceptionGain(sensorUnitsOf(farObs)),
      ),
    ).toBe(true);
    // Close: a baseline hull at 500 m is comfortably above the dazzle threshold
    // — the bound must NOT skip it.
    const close = simShips([
      ship("obs", "attacker", 0, 0, [...core()]),
      ship("ene", "defender", 500, 0, [...core()]),
    ]);
    const closeObs = close[0];
    const closeEne = close[1];
    if (closeObs === undefined || closeEne === undefined) {
      throw new Error("close fixture failed to convert");
    }
    expect(
      hullReceptionIsNegligible(
        closeObs,
        closeEne,
        0,
        observerMaxReceptionGain(sensorUnitsOf(closeObs)),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The optimised path matches the frozen reference oracle byte-for-byte.
// ---------------------------------------------------------------------------

describe("engine.awareness early-out — matches the reference oracle", () => {
  function mixedFleet(): CombatShip[] {
    // A spread of separations, sensors, and a bright emitter so the early-out
    // fires for some pairs and not others within one direct-detection pass.
    return [
      ship("a1", "attacker", -40_000, 0, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
      ship("a2", "attacker", -1_000, 500, [...core()]),
      ship(
        "a3",
        "attacker",
        -30_000,
        0,
        [
          ...core(),
          moduleOf("ae", sensor(1_000, { mode: "active", emitStrength: 1e12 }), 1, 0),
        ],
        { velocity: { x: 60, y: 0 } },
      ),
      ship("d1", "defender", 40_000, 0, [...core(), moduleOf("se", sensor(50_000), 1, 0)]),
      ship("d2", "defender", 1_000, -500, [...core()]),
      ship("d3", "defender", 35_000, 0, [...core()]),
    ];
  }

  /** Run a direct-detection builder on a FRESH accumulator + scratch over the
   *  shared (read-only) fleet, returning the contact map and accumulator.
   *  `sensorsByShip` is populated exactly as `computeAwareness` populates it, so
   *  the optimised path ({@link buildDirectContacts}, which reads the pooled
   *  sensor arrays from scratch) and the frozen oracle
   *  ({@link buildDirectContactsReference}, which calls `sensorUnitsOf` inline)
   *  are exercised against identical precomputed sensor data. */
  function run(
    builder: typeof buildDirectContacts,
    ships: readonly SimShip[],
  ): { direct: ReturnType<typeof buildDirectContacts>; dazzle: Map<string, number> } {
    const { alive, enemiesBySide } = aliveAndEnemies(ships);
    const dazzle = seededDazzleAccum(alive);
    const scratch = freshAwarenessScratch();
    for (const s of alive) {
      let pooled = scratch.sensorsByShip.get(s.instanceId);
      if (pooled === undefined) {
        pooled = [];
        scratch.sensorsByShip.set(s.instanceId, pooled);
      }
      fillSensorUnits(s, pooled);
    }
    const direct = builder(alive, [], [], dazzle, enemiesBySide, scratch);
    return { direct, dazzle };
  }

  it("optimised and reference produce identical direct-contacts and dazzle", () => {
    const ships = simShips(mixedFleet());
    const optimised = run(buildDirectContacts, ships);
    const reference = run(buildDirectContactsReference, ships);
    // The contact map (observer → Contact[]) matches entry-for-entry, including
    // the floating-point x/y/threat of every aberrated contact fix.
    expect(optimised.direct).toEqual(reference.direct);
    // The dazzle accumulator matches bit-for-bit: a skipped pair adds 0, which
    // is the FP identity (x + 0 === x), so the running sums are identical.
    expect(optimised.dazzle).toEqual(reference.dazzle);
  });

  it("the early-out actually skips at least one pair in the mixed fleet", () => {
    // Guards against the optimisation silently becoming a no-op: a2/d2 are
    // ~2 km apart (a contact), while a1/d1 are ~80 km apart (well beyond even a
    // 50 km sensor's reach once inverse-square is applied) — the bound must
    // skip the far cross-side pairs.
    const ships = simShips(mixedFleet());
    const a1 = ships.find((s) => s.instanceId === "a1");
    const d1 = ships.find((s) => s.instanceId === "d1");
    if (a1 === undefined || d1 === undefined) throw new Error("fixtures missing a1/d1");
    const skip = hullReceptionIsNegligible(
      a1,
      d1,
      Math.sqrt(a1.velX * a1.velX + a1.velY * a1.velY),
      observerMaxReceptionGain(sensorUnitsOf(a1)),
    );
    expect(skip).toBe(true);
  });
});
