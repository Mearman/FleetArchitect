import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/domain/simulation/rng";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { makeDecoy, makeDrone, stepPhantoms } from "@/domain/simulation/engine/phantoms";
import { stepPhantomsReference } from "@/domain/simulation/engine/phantoms.reference";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { CombatShip } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { HangarEffect, DecoyEffect } from "@/schema/module";

/**
 * Equivalence proof for the per-side enemy-list optimisation in
 * {@link stepPhantoms}: the optimised path (build two alive-non-phantom enemy
 * lists once per tick, scan the relevant one per drone) must produce
 * byte-identical ship state to the frozen reference oracle
 * ({@link stepPhantomsReference}), which re-scans the full `ships` array per
 * drone. The per-frame digest gate (engine.lossless-digest.integration) is the
 * whole-battle arbiter; this unit test is the finer-grained, targeted regression
 * guard that stresses the three losslessness requirements directly:
 *
 *  1. ORDER — the enemy list is in ships-array order, so the squared-distance
 *     tie-break (strict `<`, first wins) picks the same target as the full scan.
 *  2. INTRA-TICK KILL REACTIVITY — a target killed by an earlier drone this
 *     tick is excluded from a later drone's selection via the shared `.alive`
 *     flag (the list holds live references, so `applyImpact`'s synchronous
 *     `alive = false` is visible to every later drone).
 *  3. FRESH PER TICK — no carry-over; each call rebuilds from the live roster.
 *
 * Each path runs against a `structuredClone` of the same template fleet,
 * because `stepPhantoms` mutates ship state in place (drone pose, target HP,
 * phantom ticksLeft / alive). The fixtures mix real ships, drones, a decoy,
 * dead hulls, and same-side friendlies so the optimisation's skip set is
 * non-trivial, and include a low-HP defender a drone can one-shot to force the
 * intra-tick tombstone path.
 */

/** A minimal real CombatShip with controllable side, pose, and structure. The
 *  ship has no modules, so `applyImpact` routes through the legacy aggregated
 *  path (`spillToStructure`), making structure/alive the damage surface. */
function realShip(
  id: string,
  side: "attacker" | "defender",
  x: number,
  y: number,
  structure: number,
  facing = 0,
): CombatShip {
  const stats: ShipStats = {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure,
    damageReduction: 0,
    shieldCapacity: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 30,
    deflectorCapacity: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    thrust: 0,
    turnRate: 0,
    weapons: [],
    compartments: 0,
    airtightCompartments: 0,
  };
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats,
    position: { x, y },
    facing,
    classification: "frigate",
    doctrine: { base: {}, rules: [] },
  };
}

/** Convert a list of CombatShips to engine SimShips with a deterministic rng. */
function toSim(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** A hangar effect whose drones carry the given per-strike damage, range,
 *  speed, and lifetime. */
function hangar(
  damage: number,
  range: number,
  speed: number,
  lifetime: number,
): HangarEffect {
  return {
    kind: "hangar",
    droneCount: 1,
    launchCooldown: 0,
    droneHp: 100,
    droneDamage: damage,
    droneRange: range,
    droneSpeed: speed,
    droneLifetime: lifetime,
  };
}

/** A decoy effect with the given lifetime. The literal is checked against the
 *  DecoyEffect schema type at compile time (no assertion needed). */
function decoyEffect(lifetime: number): DecoyEffect {
  return {
    kind: "decoy",
    decoyHp: 100,
    decoyCount: 1,
    duration: lifetime,
    cooldown: 0,
  };
}

/**
 * Capture every field `stepPhantoms` can mutate as a comparable string, so two
 * ships are "equal" iff their post-step state is byte-identical across the
 * damage surface (structure/shield/deflector + regen countdowns + alive), the
 * drone pose (x/y/facing), and the phantom bookkeeping (ticksLeft).
 */
function fingerprint(s: SimShip): string {
  const ph =
    s.phantom === undefined
      ? "none"
      : `${s.phantom.kind}|${s.phantom.ticksLeft}|${s.phantom.damage}|${s.phantom.range}|${s.phantom.speed}`;
  return [
    s.instanceId,
    s.alive ? "1" : "0",
    s.x,
    s.y,
    s.facing,
    s.structure,
    s.shield,
    s.deflector,
    s.shieldRegenCountdown,
    s.shieldUntouchedTicks,
    s.deflectorRegenCountdown,
    s.aiWasFiredUpon ? "1" : "0",
    ph,
  ].join(",");
}

/** Run both implementations on independent deep clones of the same fleet and
 *  assert every ship's fingerprint matches entry-for-entry. Returns the
 *  optimised clone so callers can sanity-check that the scenario actually
 *  exercised the path (otherwise equivalence holds trivially). */
function assertPhantomsEquivalent(template: readonly SimShip[]): readonly SimShip[] {
  const ref = structuredClone(template);
  const opt = structuredClone(template);
  stepPhantomsReference(ref);
  stepPhantoms(opt);
  const refFp = ref.map(fingerprint);
  const optFp = opt.map(fingerprint);
  expect(optFp, "optimised vs reference fingerprints").toEqual(refFp);
  return opt;
}

describe("engine.phantoms — per-side enemy list matches the reference oracle", () => {
  it("a no-op fleet (no phantoms) is unchanged on both paths", () => {
    const fleet = toSim([
      realShip("a1", "attacker", 0, 0, 1000),
      realShip("d1", "defender", 500, 0, 1000),
    ]);
    const opt = assertPhantomsEquivalent(fleet);
    // Sanity: nothing mutated.
    expect(opt.every((s) => s.phantom === undefined)).toBe(true);
  });

  it("mixed fleet: drones, decoy, dead hulls, friendlies, varied distances", () => {
    // Two attacker ships (one is the drone owner), three defenders at varied
    // ranges, plus a dead hull on each side and a same-side friendly mixed in
    // — the optimisation must skip all of the non-enemy entries per drone.
    const real = toSim([
      realShip("atk-owner", "attacker", -200, 0, 50_000),
      realShip("atk-friendly", "attacker", 100, 0, 50_000),
      realShip("def-near", "defender", 300, 0, 50_000),
      realShip("def-mid", "defender", 800, 100, 50_000),
      realShip("def-far", "defender", 5_000, 0, 50_000),
      realShip("atk-dead", "attacker", 0, 0, 1),
      realShip("def-dead", "defender", 0, 0, 1),
    ]);
    // Kill the dead hulls before the step so they are filtered at list build.
    const atkDead = real.find((s) => s.instanceId === "atk-dead");
    const defDead = real.find((s) => s.instanceId === "def-dead");
    if (atkDead === undefined || defDead === undefined) throw new Error("dead hulls missing");
    atkDead.alive = false;
    defDead.alive = false;
    const owner = real.find((s) => s.instanceId === "atk-owner");
    if (owner === undefined) throw new Error("owner missing");
    // Three drones from the owner, in array order: each scans for the nearest
    // live defender. A decoy counts down alongside them.
    const drones = [
      makeDrone("drone-1", owner, hangar(100, 50, 30, 4000), owner.x + 10, owner.y),
      makeDrone("drone-2", owner, hangar(100, 50, 30, 4000), owner.x + 10, owner.y + 5),
      makeDrone("drone-3", owner, hangar(100, 50, 30, 4000), owner.x + 10, owner.y - 5),
    ];
    const decoy = makeDecoy(
      "decoy-1",
      owner,
      decoyEffect(3),
      owner.x,
      owner.y,
      { dx: 0, dy: 0 },
    );
    const fleet = [...real, ...drones, decoy];
    assertPhantomsEquivalent(fleet);
  });

  it("order tie-break: two equidistant defenders, first in array wins on both paths", () => {
    const real = toSim([
      realShip("atk-owner", "attacker", 0, 0, 50_000),
      // Two defenders equidistant from the drone's spawn; ships-array order
      // must decide the tie identically in both paths.
      realShip("def-first", "defender", 400, 300, 50_000),
      realShip("def-second", "defender", 400, 300, 50_000),
    ]);
    const owner = real.find((s) => s.instanceId === "atk-owner");
    if (owner === undefined) throw new Error("owner missing");
    // A slow, short-range drone that homes toward the tie pair but cannot
    // reach them this tick (range 1, speed 1) — it picks a facing only.
    const drone = makeDrone("drone-1", owner, hangar(10, 1, 1, 4000), 0, 0);
    const opt = assertPhantomsEquivalent([...real, drone]);
    // Sanity: the drone actually turned to face one of the pair (the tie was
    // resolved rather than the drone sitting idle).
    const optDrone = opt.find((s) => s.instanceId === "drone-1");
    if (optDrone === undefined) throw new Error("drone missing");
    expect(optDrone.facing).not.toBe(0);
  });

  it("intra-tick kill reactivity: drone-1 one-shots a defender, drone-2 sees it dead", () => {
    // A defender with exactly enough structure that one drone strike kills it.
    // drone-1 (earlier in array) kills it; drone-2 (later) must then pick the
    // OTHER defender as its nearest — the intra-tick tombstone path. Both paths
    // must agree on drone-2's resulting pose and on the killed defender's HP.
    const real = toSim([
      realShip("atk-owner", "attacker", 0, 0, 50_000),
      realShip("def-fragile", "defender", 100, 0, 50), // one-shotted by a 100-J drone
      realShip("def-other", "defender", 200, 0, 50_000),
    ]);
    const owner = real.find((s) => s.instanceId === "atk-owner");
    if (owner === undefined) throw new Error("owner missing");
    const fleet: SimShip[] = [
      ...real,
      makeDrone("drone-1", owner, hangar(100, 50, 100, 4000), 60, 0),
      makeDrone("drone-2", owner, hangar(100, 50, 100, 4000), 60, 0),
    ];
    const opt = assertPhantomsEquivalent(fleet);
    // Sanity: the fragile defender was actually killed this tick (so the
    // intra-tick tombstone path was genuinely exercised, not vacuously true).
    const optFragile = opt.find((s) => s.instanceId === "def-fragile");
    if (optFragile === undefined) throw new Error("fragile defender missing");
    expect(optFragile.alive, "fragile defender must be killed by drone-1").toBe(false);
    expect(optFragile.structure).toBe(0);
  });

  it("both sides field drones: attacker drones and defender drones each home", () => {
    const real = toSim([
      realShip("atk-owner", "attacker", -500, 0, 50_000),
      realShip("def-owner", "defender", 500, 0, 50_000),
      realShip("atk-extra", "attacker", -600, 50, 50_000),
      realShip("def-extra", "defender", 600, -50, 50_000),
    ]);
    const atkOwner = real.find((s) => s.instanceId === "atk-owner");
    const defOwner = real.find((s) => s.instanceId === "def-owner");
    if (atkOwner === undefined || defOwner === undefined) throw new Error("owners missing");
    const fleet: SimShip[] = [
      ...real,
      makeDrone("atk-drone", atkOwner, hangar(80, 40, 60, 4000), -480, 0),
      makeDrone("def-drone", defOwner, hangar(80, 40, 60, 4000), 480, 0),
    ];
    assertPhantomsEquivalent(fleet);
  });

  it("out-of-range drone homes toward the nearest enemy but does not strike", () => {
    const real = toSim([
      realShip("atk-owner", "attacker", 0, 0, 50_000),
      realShip("def-far", "defender", 10_000, 0, 50_000),
    ]);
    const owner = real.find((s) => s.instanceId === "atk-owner");
    if (owner === undefined) throw new Error("owner missing");
    // range 5: the defender at 10_000m is well out of strike range, so the
    // drone turns and moves toward it but deals no damage.
    const fleet: SimShip[] = [
      ...real,
      makeDrone("drone-1", owner, hangar(100, 5, 50, 4000), 0, 0),
    ];
    const opt = assertPhantomsEquivalent(fleet);
    // Sanity: the defender took no damage (no strike) and the drone moved.
    const optDef = opt.find((s) => s.instanceId === "def-far");
    const optDrone = opt.find((s) => s.instanceId === "drone-1");
    if (optDef === undefined || optDrone === undefined) throw new Error("fixture missing");
    expect(optDef.structure, "out-of-range defender must not be struck").toBe(50_000);
    expect(optDrone.x, "drone must have moved toward the enemy").toBeGreaterThan(0);
  });

  it("expiry: a drone and a decoy at ticksLeft=1 both die this tick on both paths", () => {
    const real = toSim([
      realShip("atk-owner", "attacker", 0, 0, 50_000),
      realShip("def-far", "defender", 10_000, 0, 50_000),
    ]);
    const owner = real.find((s) => s.instanceId === "atk-owner");
    if (owner === undefined) throw new Error("owner missing");
    const expiringDrone = makeDrone(
      "drone-dying",
      owner,
      hangar(100, 50, 30, 4000),
      0,
      0,
    );
    const expiringDecoy = makeDecoy(
      "decoy-dying",
      owner,
      decoyEffect(1),
      0,
      0,
      { dx: 0, dy: 0 },
    );
    // Force one tick from lifetime: set ticksLeft so the decrement this step
    // brings it to 0 → the phantom is marked dead.
    if (expiringDrone.phantom === undefined) throw new Error("drone phantom missing");
    expiringDrone.phantom.ticksLeft = 1;
    if (expiringDecoy.phantom === undefined) throw new Error("decoy phantom missing");
    expiringDecoy.phantom.ticksLeft = 1;
    const fleet = [...real, expiringDrone, expiringDecoy];
    const opt = assertPhantomsEquivalent(fleet);
    // Sanity: both phantoms actually expired.
    const optDrone = opt.find((s) => s.instanceId === "drone-dying");
    const optDecoy = opt.find((s) => s.instanceId === "decoy-dying");
    if (optDrone === undefined || optDecoy === undefined) throw new Error("phantoms missing");
    expect(optDrone.alive, "expiring drone must die").toBe(false);
    expect(optDecoy.alive, "expiring decoy must die").toBe(false);
  });
});
