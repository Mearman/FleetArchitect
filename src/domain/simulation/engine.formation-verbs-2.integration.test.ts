import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleFrame } from "@/schema/battle";
import type { Doctrine, SpatialObjective } from "@/schema/ai";
import type { WeaponEffect, ModuleEffect } from "@/schema/module";
import type { ShipClassification } from "@/schema/armor";
import type { CombatShip } from "@/domain/simulation/types";
import {
  inputs,
  modularShip,
  moduleOf,
  shipAt,
  targetDummy,
} from "./engine.factions-tech-helpers";

/**
 * Formation-doctrine VERB integration (part 2): the remaining movement and
 * targeting verbs — ORBIT, EVADE, MAINTAIN, MEMBERS_OF, CLASS, PD_PRIORITY —
 * authored on real modular ships and run through the full tick loop, asserting
 * the OBSERVABLE behaviour each verb produces (not merely "doesn't crash").
 *
 * Engine reality these tests encode (verified by reading the consumers):
 *
 *  - The formation-doctrine pass writes ONLY `aiSpatial` / `aiTargeting` /
 *    `aiFire`, and ONLY from a fired RULE's `then` action. `base.spatial` is
 *    read directly only for `hold` / `engage`; every other range kind (kite /
 *    evade / maintain / close) and every relational targeting mode takes effect
 *    solely as a rule's `then` (resolved onto the transient `ai*` fields). So
 *    every verb here uses an always-true rule (`tickAfter: 0`) — the gate that
 *    makes the formation pass open and the verb fire every tick.
 *  - `desiredPoint` maps the spatial objective to a world point + a desired
 *    range `want` from that point. For `orbit` the point is the reference
 *    shifted by `radius` along `phase + omega·tick` and `want` is 0 (sit on the
 *    circling point); for `evade` / `maintain` the point is the reference
 *    itself and `want` carries `minRange` / `range` (hold open that distance).
 *  - Relational targeting (`membersOf` / `class`) is a FILTER on the visible
 *    candidate set; `pdPriority` is a +1 scoring bias for phantom (drone/decoy)
 *    candidates, applied in `scoreEnemy`. Phantoms ARE in the live per-side
 *    ship lists (`refreshRosterIncremental` includes them), so a PD-priority
 *    ship surfaces a drone above real ships once the drone is in awareness.
 *
 * The same two fixture details that bit part 1 apply here: an armed ship with
 * `thrust: 0` starts fragmented (weapon cells disconnect from the bridge), so
 * armed fixtures carry a small thrust + a `hold` spatial to station-keep; and
 * per-tick movement is slow, so verbs that must settle within a short tick
 * budget use `thrust: 4000`.
 */

const SEED = 42;

/** A short-range beam that fires every tick (cooldown 0). `damage: 0` lets a
 *  ship lock and hold a target without destroying the fixture it tracks. */
function beam(over: Partial<WeaponEffect> = {}): WeaponEffect {
  return {
    kind: "weapon",
    weaponType: "beam",
    damage: 10,
    range: 400,
    cooldown: 0,
    projectileSpeed: 0,
    projectileMass: 0.5,
    tracking: 0,
    shieldPiercing: 0,
    armourPiercing: 0,
    spread: 0,
    ...over,
  };
}

/** The hold spatial objective used to park armed fixtures on station. */
const HOLD_SPATIAL: SpatialObjective = {
  reference: { kind: "target" },
  range: { kind: "hold", band: 0.1 },
  bearing: { kind: "free" },
};

/**
 * Build a modular CombatShip via the shared `modularShip` helper, then attach a
 * full unified doctrine and (optionally) formation identity — the way
 * `resolveFleetToCombatShips` stamps a leaf doctrine at resolve time.
 */
function buildShip(opts: {
  id: string;
  side: "attacker" | "defender";
  x: number;
  y?: number;
  facing?: number;
  thrust?: number;
  turnRate?: number;
  structure?: number;
  weapons?: WeaponEffect[];
  classification?: ShipClassification;
  doctrine: Doctrine;
  formationId?: string;
  role?: string;
}): CombatShip {
  const ship = modularShip({
    id: opts.id,
    side: opts.side,
    x: opts.x,
    y: opts.y ?? 0,
    facing: opts.facing,
    thrust: opts.thrust,
    turnRate: opts.turnRate,
    structure: opts.structure,
    weapons: opts.weapons,
    classification: opts.classification,
  });
  return {
    ...ship,
    doctrine: opts.doctrine,
    ...(opts.formationId !== undefined
      ? {
          formationId: opts.formationId,
          formationChain: [opts.formationId],
          role: opts.role,
        }
      : {}),
  };
}

/** A stationary target dummy carrying formation identity and classification. */
function buildDummy(opts: {
  id: string;
  side?: "attacker" | "defender";
  x: number;
  y?: number;
  structure?: number;
  classification?: ShipClassification;
  formationId?: string;
  role?: string;
  /** Durable absorbing cells (high HP) keep the dummy from fragmenting so its
   *  instanceId — and therefore its role reference — stays stable under fire. */
  durable?: boolean;
}): CombatShip {
  const dummy = targetDummy({
    id: opts.id,
    side: opts.side ?? "attacker",
    x: opts.x,
    y: opts.y ?? 0,
    structure: opts.structure,
    classification: opts.classification,
    absorbingCells: opts.durable === true ? 1 : 5,
    absorbingSubstrateHp: opts.durable === true ? 99999 : 0,
    absorbingSurfaceHp: opts.durable === true ? 99999 : 0,
  });
  const stamped: CombatShip = { ...dummy };
  if (opts.formationId !== undefined) {
    stamped.formationId = opts.formationId;
    stamped.formationChain = [opts.formationId];
    stamped.role = opts.role;
  }
  return stamped;
}

/** Distance between two ships in a frame. */
function dist(
  frames: readonly BattleFrame[],
  tick: number,
  idA: string,
  idB: string,
): number {
  const frame = frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const a = frame.ships.find((s) => s.instanceId === idA);
  const b = frame.ships.find((s) => s.instanceId === idB);
  if (a === undefined || b === undefined) {
    throw new Error(`ship missing from tick ${tick}`);
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bearing (atan2) from ship `fromId` to ship `toId` at a tick, in radians. */
function bearing(
  frames: readonly BattleFrame[],
  tick: number,
  fromId: string,
  toId: string,
): number {
  const frame = frames.find((f) => f.tick === tick);
  if (frame === undefined) throw new Error(`no frame at tick ${tick}`);
  const a = frame.ships.find((s) => s.instanceId === fromId);
  const b = frame.ships.find((s) => s.instanceId === toId);
  if (a === undefined || b === undefined) {
    throw new Error(`ship missing from tick ${tick}`);
  }
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// ---------------------------------------------------------------------------
// ORBIT
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: ORBIT", () => {
  it("circles the anchor: the bearing to the anchor rotates over ticks while the radius stays near the maintain distance", () => {
    // `orbit` is an offsetting bearing: the desired point is the anchor shifted
    // by `radius` (= the paired `maintain` range, 200 m) along
    // `phase + omega·tick`, and `want` is 0 (sit on that circling point). With
    // omega = 0.05 rad/tick the orbit point sweeps 0.05·(30−10) = 1.0 rad
    // between tick 10 and 30 — so the orbiter's bearing to the anchor must
    // rotate by well over 0.5 rad, and its separation must stay bounded near
    // 200 m. omega is kept low (tangential speed radius·omega = 10 m/tick) so
    // the orbiter can track the circling point within the short tick budget.
    const orbitDoctrine: Doctrine = {
      base: {},
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            spatial: {
              reference: { kind: "friendly", role: "anchor" },
              range: { kind: "maintain", range: 200, tolerance: 0.2 },
              bearing: { kind: "orbit", omega: 0.05, phase: 0 },
            },
          },
        },
      ],
    };
    // Stationary anchor on the orbiter's side, carrying role "anchor" so the
    // `{kind:"friendly", role:"anchor"}` reference resolves to its centroid.
    const anchor = buildDummy({
      id: "anchor",
      side: "attacker",
      x: 0,
      y: 0,
      structure: 99999,
      durable: true,
      formationId: "f-anchor",
      role: "anchor",
    });
    // Orbiter starts on the tick-0 orbit point (200·cos0, 200·sin0) = (200, 0).
    // High thrust + agile turn-rate so it can follow the circling desired point
    // at the engine's per-tick SI scale (ACCEL_PER_TICK_FROM_SI = 1/900).
    const orbiter = buildShip({
      id: "orbiter",
      side: "attacker",
      x: 200,
      y: 0,
      thrust: 50000,
      turnRate: 0.5,
      doctrine: orbitDoctrine,
      formationId: "f-orbiter",
      role: "orbiter",
    });
    // A durable defender far away so both sides field an alive ship and the
    // battle runs the full budget (the orbiter never needs to engage it).
    const watcher = buildDummy({
      id: "watcher",
      side: "defender",
      x: 5000,
      y: 5000,
      structure: 99999,
      durable: true,
    });
    const result = runBattle(inputs([anchor, orbiter, watcher], 40, SEED));

    // Bearing rotates: the angle from the anchor to the orbiter at tick 30
    // differs from tick 10 by well over 0.5 rad (the orbit point swept 4 rad).
    const bearing10 = bearing(result.frames, 10, "anchor", "orbiter");
    const bearing30 = bearing(result.frames, 30, "anchor", "orbiter");
    let delta = Math.abs(bearing30 - bearing10);
    if (delta > Math.PI) delta = 2 * Math.PI - delta; // wrap to shortest arc
    expect(delta, "orbit bearing should rotate > 0.5 rad between tick 10 and 30").toBeGreaterThan(
      0.5,
    );

    // Radius stays bounded near the 200 m maintain distance: across the orbit
    // window the separation never collapses to zero or balloons unboundedly.
    for (const t of [10, 20, 30, 39]) {
      const d = dist(result.frames, t, "orbiter", "anchor");
      expect(d, `orbit radius should stay in 50..350 at tick ${t}`).toBeGreaterThan(50);
      expect(d, `orbit radius should stay in 50..350 at tick ${t}`).toBeLessThan(350);
    }
  });
});

// ---------------------------------------------------------------------------
// EVADE
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: EVADE", () => {
  it("opens range beyond the evade floor when starting inside it", () => {
    // `evade` maps to `want = minRange` against the target's position (free
    // bearing — the controller picks the approach). The ship starts at 150 m,
    // well inside the 300 m evade floor, and must open range past 280 m rather
    // than close or hold.
    const evadeDoctrine: Doctrine = {
      base: {},
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            spatial: {
              reference: { kind: "target" },
              range: { kind: "evade", minRange: 300 },
              bearing: { kind: "free" },
            },
          },
        },
      ],
    };
    const evader = buildShip({
      id: "evader",
      side: "attacker",
      x: 0,
      y: 0,
      facing: Math.PI,
      thrust: 50000,
      turnRate: 0.5,
      // Zero-damage beam: lock the dummy as a target (so `{kind:"target"}`
      // resolves) without destroying it. Facing PI so it already points away
      // from the target (at +x) and opens range without a slow flip.
      weapons: [beam({ range: 600, damage: 0 })],
      doctrine: evadeDoctrine,
    });
    const dummy = buildDummy({
      id: "dummy",
      side: "defender",
      x: 150,
      y: 0,
      structure: 99999,
      durable: true,
    });
    const result = runBattle(inputs([evader, dummy], 30, SEED));

    // Starts at 150 m; by tick 25 the evader has opened range past the 300 m
    // floor (allowing a little controller undershoot).
    const startDist = dist(result.frames, 1, "evader", "dummy");
    expect(startDist, "evader starts inside the evade floor").toBeLessThan(200);
    for (const t of [25, 28, 30]) {
      const d = dist(result.frames, t, "evader", "dummy");
      expect(d, `evader should open range past 280 at tick ${t}`).toBeGreaterThan(280);
    }
  });
});

// ---------------------------------------------------------------------------
// MAINTAIN
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: MAINTAIN", () => {
  it("settles near the maintain range when starting well inside it", () => {
    // `maintain` maps to `want = range` (200 m) against the target's position.
    // The ship starts at 100 m and must open range to settle near 200 m — not
    // close to zero, not flee past the tolerance band.
    const maintainDoctrine: Doctrine = {
      base: {},
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            spatial: {
              reference: { kind: "target" },
              range: { kind: "maintain", range: 200, tolerance: 0.15 },
              bearing: { kind: "free" },
            },
          },
        },
      ],
    };
    const holder = buildShip({
      id: "holder",
      side: "attacker",
      x: 0,
      y: 0,
      facing: Math.PI,
      thrust: 50000,
      turnRate: 0.5,
      weapons: [beam({ range: 600, damage: 0 })],
      doctrine: maintainDoctrine,
    });
    const dummy = buildDummy({
      id: "dummy",
      side: "defender",
      x: 100,
      y: 0,
      structure: 99999,
      durable: true,
    });
    const result = runBattle(inputs([holder, dummy], 40, SEED));

    // Starts at 100 m; once settled (tick 30+) the separation sits near 200 m.
    const startDist = dist(result.frames, 1, "holder", "dummy");
    expect(startDist, "holder starts well inside the maintain range").toBeLessThan(130);
    for (const t of [30, 35, 39]) {
      const d = dist(result.frames, t, "holder", "dummy");
      expect(d, `maintain should settle in 150..260 at tick ${t}`).toBeGreaterThan(150);
      expect(d, `maintain should settle in 150..260 at tick ${t}`).toBeLessThan(260);
    }
  });
});

// ---------------------------------------------------------------------------
// MEMBERS_OF
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: MEMBERS_OF", () => {
  it("targets a member of the referenced enemy formation, not the nearer non-member", () => {
    // `membersOf` is a relational FILTER: it keeps only enemies whose
    // formationId resolves to the referenced enemy role. Geometry isolates the
    // verb: the sniper (nearer, 200 m) is in a different formation; the two
    // vanguard ships (farther, 400 m) share role "vanguard". A nearest-targeting
    // ship picks the sniper; a membersOf(vanguard) ship must pick a vanguard.
    const membersDoctrine: Doctrine = {
      base: { spatial: HOLD_SPATIAL },
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            targeting: {
              mode: {
                kind: "membersOf",
                reference: { kind: "enemy", role: "vanguard" },
              },
              vulnerableWeight: 0,
              focusFire: false,
            },
          },
        },
      ],
    };
    // Durable, stationary attacker dummies so their instanceIds (and formation
    // membership) stay stable. The sniper is the closest; both vanguard ships
    // are farther so nearest-targeting would never pick them.
    const sniper = buildDummy({
      id: "sniper",
      side: "attacker",
      x: 200,
      y: 0,
      structure: 99999,
      durable: true,
      formationId: "sniper",
      role: "sniper",
    });
    const vanguardA = buildDummy({
      id: "vanguardA",
      side: "attacker",
      x: -400,
      y: 0,
      structure: 99999,
      durable: true,
      formationId: "vanguard",
      role: "vanguard",
    });
    const vanguardB = buildDummy({
      id: "vanguardB",
      side: "attacker",
      x: 0,
      y: 400,
      structure: 99999,
      durable: true,
      formationId: "vanguard",
      role: "vanguard",
    });
    const defender = buildShip({
      id: "defender",
      side: "defender",
      x: 0,
      y: 0,
      thrust: 450,
      turnRate: 0.02,
      weapons: [beam({ range: 1200, damage: 0 })],
      doctrine: membersDoctrine,
    });
    const result = runBattle(inputs([sniper, vanguardA, vanguardB, defender], 30, SEED));

    // The membersOf defender picks a vanguard ship — not the nearer sniper.
    // This holds across the battle: the filter excludes the sniper every tick.
    for (const t of [5, 10, 15, 20, 25]) {
      const d = shipAt(result, t, "defender");
      expect(
        d.targetId,
        `membersOf defender should target a vanguard ship at tick ${t}`,
      ).toBeOneOf(["vanguardA", "vanguardB"]);
    }
  });
});

// ---------------------------------------------------------------------------
// CLASS
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: CLASS", () => {
  it("targets the enemy of the authored classification, not the nearer other class", () => {
    // `class` is a relational FILTER: it keeps only enemies whose
    // `classification` matches. The cruiser (nearer, 200 m) is filtered out;
    // the fighter (farther, 500 m) is the only candidate. A nearest-targeting
    // ship picks the cruiser; a class(fighter) ship must pick the fighter.
    const classDoctrine: Doctrine = {
      base: { spatial: HOLD_SPATIAL },
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            targeting: {
              mode: { kind: "class", classification: "fighter" },
              vulnerableWeight: 0,
              focusFire: false,
            },
          },
        },
      ],
    };
    const cruiser = buildDummy({
      id: "cruiser",
      side: "attacker",
      x: 200,
      y: 0,
      structure: 99999,
      durable: true,
      classification: "cruiser",
    });
    const fighter = buildDummy({
      id: "fighter",
      side: "attacker",
      x: 500,
      y: 0,
      structure: 99999,
      durable: true,
      classification: "fighter",
    });
    const defender = buildShip({
      id: "defender",
      side: "defender",
      x: 0,
      y: 0,
      thrust: 450,
      turnRate: 0.02,
      weapons: [beam({ range: 1200, damage: 0 })],
      doctrine: classDoctrine,
    });
    const result = runBattle(inputs([cruiser, fighter, defender], 20, SEED));

    // The class(fighter) defender targets the fighter, not the nearer cruiser.
    for (const t of [5, 10, 15, 19]) {
      const d = shipAt(result, t, "defender");
      expect(d.targetId, `class defender should target the fighter at tick ${t}`).toBe("fighter");
    }
  });
});

// ---------------------------------------------------------------------------
// PD_PRIORITY
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: PD_PRIORITY", () => {
  it("biases targeting toward a launched drone once one is in awareness", () => {
    // `pdPriority` is a +1 scoring bias for phantom (drone/decoy) candidates,
    // applied in `scoreEnemy` (not a filter). A drone launched by an enemy
    // hangar enters the defender's awareness once in sensor range; the bias
    // then surfaces it above the launching carrier. The drone id format is
    // `${ownerId}#drone#${tick}#${seq}` (see nextPhantomId in engine/index.ts),
    // so a targeted drone's targetId contains "#drone#".
    const pdDoctrine: Doctrine = {
      base: { spatial: HOLD_SPATIAL },
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            targeting: {
              mode: { kind: "pdPriority" },
              vulnerableWeight: 0,
              focusFire: false,
            },
          },
        },
      ],
    };

    // A hangar module that launches drones immediately (cooldown 0) and fast
    // enough (droneSpeed 30 m/tick) to reach the defender within the budget.
    const hangarEffect: ModuleEffect = {
      kind: "hangar",
      droneCount: 2,
      launchCooldown: 0,
      droneHp: 50,
      droneDamage: 0,
      droneRange: 100,
      droneSpeed: 30,
      droneLifetime: 200,
    };
    const carrier = buildShip({
      id: "carrier",
      side: "attacker",
      x: -300,
      y: 0,
      thrust: 450,
      turnRate: 0.02,
      weapons: [beam({ range: 600, damage: 0 })],
      doctrine: { base: { spatial: HOLD_SPATIAL }, rules: [] },
    });
    // Append a hangar module (col 1 — adjacent to the bridge, connected even
    // without engines) so `launchDrones` finds an operational bay.
    const hangarModule = moduleOf("carrier-hangar", hangarEffect, 1, 0);
    const existingModules = carrier.modules;
    if (existingModules === undefined) throw new Error("carrier must carry modules");
    carrier.modules = [...existingModules, hangarModule];

    const defender = buildShip({
      id: "defender",
      side: "defender",
      x: 0,
      y: 0,
      thrust: 450,
      turnRate: 0.02,
      weapons: [beam({ range: 600, damage: 0 })],
      doctrine: pdDoctrine,
    });
    const result = runBattle(inputs([carrier, defender], 40, SEED));

    // Premise: drones ARE launched (the carrier's bay is operational). If none
    // ever appear, the assertion below would be vacuous, so check first.
    const droneTicks = result.frames.filter(
      (f) => f.drones !== undefined && f.drones.length > 0,
    );
    expect(droneTicks.length, "carrier should launch drones").toBeGreaterThan(0);

    // The PD-priority defender targets a drone at some tick once drones are in
    // play. The +1 phantom bias surfaces the drone above the carrier once both
    // are in awareness.
    const targetedDrone = result.frames.some((f) => {
      if (f.tick < 5) return false;
      if (f.drones === undefined || f.drones.length === 0) return false;
      const d = f.ships.find((s) => s.instanceId === "defender");
      return d?.targetId !== undefined && d.targetId.includes("#drone#");
    });
    expect(targetedDrone, "pdPriority defender should target a drone once one is in play").toBe(true);
  });
});
