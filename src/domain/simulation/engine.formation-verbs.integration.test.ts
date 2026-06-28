import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type { BattleFrame } from "@/schema/battle";
import type { Doctrine, SpatialObjective } from "@/schema/ai";
import type { WeaponEffect } from "@/schema/module";
import type { CombatShip } from "@/domain/simulation/types";
import {
  inputs,
  modularShip,
  shipAt,
  targetDummy,
} from "./engine.factions-tech-helpers";

/**
 * Formation-doctrine VERB integration: each unified-doctrine movement and
 * targeting verb, authored on a real modular ship, run through the full tick
 * loop, asserting the OBSERVABLE behaviour the verb produces — not merely
 * "doesn't crash".
 *
 * Engine reality these tests encode (verified by reading the pass + consumers):
 *
 *  - The formation-doctrine pass writes ONLY `aiSpatial` / `aiTargeting` /
 *    `aiFire`, and ONLY from a fired RULE's `then` action. `base.spatial` is
 *    read directly by the translation controller for just two cases — `hold`
 *    (via `isHoldRange`) and the `engage` fraction — but `kite` / `evade` /
 *    `maintain` / `close` in `base.spatial` are NEVER read; they take effect
 *    only as a rule's `then.spatial` (resolved to `aiSpatial`). Likewise the
 *    relational targeting modes (`threatsTo` etc.) take effect only via
 *    `aiTargeting` from a rule; `base.targeting.mode` is read for the four
 *    scalar kinds alone. So the KITE / THREATS_TO verbs use an always-true
 *    rule (`tickAfter: 0`); HOLD uses `base.spatial` directly.
 *  - `then: { stance: "retreat" }` on a FORMATION-conditioned rule is silently
 *    dropped: `stepAi` returns false for any non-ship-self condition, and the
 *    formation pass's `applyDoctrineAxes` writes only the spatial / targeting /
 *    fire axes. So a formation-strength-driven retreat is expressed here
 *    through the SPATIAL axis (`evade` the target), which the pass propagates.
 *
 * Two fixture details that bite if missed (both discovered by debugging):
 *  - A `modularShip` weapon cell sits at col -2; with `thrust: 0` there is no
 *    engine cell at col -1 to bridge it to the bridge, so the ship starts
 *    fragmented and the break-apart pass spawns a chunk on tick 1 (losing
 *    command / targeting). Every ARMED fixture therefore carries a small
 *    thrust so the engine cells connect the weapon, paired with a `hold`
 *    spatial so it station-keeps rather than drifting.
 *  - Movement at the engine's per-tick scale is slow (`thrust: 450` ≈ the
 *    `engine.movement-modes` fixtures), so kite / retreat ranges are in
 *    hundreds of metres; `thrust: 4000` is used where a verb must settle
 *    within a short tick budget.
 */

const SEED = 42;

/** A short-range beam that fires every tick (cooldown 0). */
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
 * full unified doctrine and (optionally) formation identity. Reuses
 * `modularShip`'s engine/reaction-wheel/sensor/command layout; only the
 * doctrine and formation stamp are layered on, the way `resolveFleetToCombatShips`
 * would stamp a leaf doctrine at resolve time.
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

/** A stationary target dummy carrying formation identity (a carrier hull). */
function buildDummy(opts: {
  id: string;
  x: number;
  y?: number;
  structure?: number;
  formationId: string;
  role: string;
  /** Durable absorbing cells (high HP) keep the dummy from fragmenting under
   *  fire so its instanceId — and therefore its role reference — stays stable. */
  durable?: boolean;
}): CombatShip {
  const dummy = targetDummy({
    id: opts.id,
    side: "attacker",
    x: opts.x,
    y: opts.y ?? 0,
    structure: opts.structure,
    absorbingCells: opts.durable === true ? 1 : 5,
    absorbingSubstrateHp: opts.durable === true ? 99999 : 0,
    absorbingSurfaceHp: opts.durable === true ? 99999 : 0,
  });
  return {
    ...dummy,
    formationId: opts.formationId,
    formationChain: [opts.formationId],
    role: opts.role,
  };
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

// ---------------------------------------------------------------------------
// KITE
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: KITE", () => {
  it("opens range toward the kite distance and holds there, rather than closing or fleeing without bound", () => {
    // `kite` is a non-hold range verb, so it must be authored as a rule's
    // `then.spatial` (the only path that writes `aiSpatial`). `tickAfter: 0`
    // is the always-true gate so the verb fires every tick. The kiter starts
    // at 120 m from the dummy and must OPEN range toward the 250 m kite
    // distance and settle there — not close to zero, not flee forever.
    const kiteDoctrine: Doctrine = {
      base: {},
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            spatial: {
              reference: { kind: "target" },
              range: { kind: "kite", maxRange: 250 },
              bearing: { kind: "free" },
            },
          },
        },
      ],
    };
    const kiter = buildShip({
      id: "kiter",
      side: "attacker",
      x: 0,
      y: 0,
      thrust: 4000,
      turnRate: 0.05,
      doctrine: kiteDoctrine,
    });
    const dummy = targetDummy({
      id: "dummy",
      side: "defender",
      x: 120,
      y: 0,
      structure: 99999,
    });
    const result = runBattle(inputs([kiter, dummy], 90, SEED));

    // The kiter must OPEN range: by mid-battle it is markedly farther than at
    // the start (without the kite verb it would close to engagement range).
    const earlyDist = dist(result.frames, 10, "kiter", "dummy");
    const midDist = dist(result.frames, 40, "kiter", "dummy");
    expect(midDist, "kiter should open range toward the kite distance").toBeGreaterThan(
      earlyDist,
    );

    // It must not close to point-blank: from tick 15 onward the kiter stays
    // clear of the dummy (it is holding range, not ramming).
    for (const frame of result.frames) {
      if (frame.tick < 15) continue;
      const d = dist(result.frames, frame.tick, "kiter", "dummy");
      expect(d, `kiter should not close to point-blank at tick ${frame.tick}`).toBeGreaterThan(
        100,
      );
    }

    // And it must settle near the kite distance: in the holding window the
    // separation sits close to 250 m.
    const holdingDists = result.frames
      .filter((f) => f.tick >= 55)
      .map((f) => dist(result.frames, f.tick, "kiter", "dummy"));
    const inBand = holdingDists.filter((d) => d > 200 && d < 280).length;
    expect(
      inBand / holdingDists.length,
      "most holding-window ticks should sit near the kite distance (200, 280)",
    ).toBeGreaterThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// HOLD
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: HOLD", () => {
  it("station-keeps near its tick-0 position (base.spatial hold is the one range kind the base path reads)", () => {
    // `hold` IS read from `base.spatial` by `isHoldRange`, so no rule is
    // needed: the translation controller station-keeps at the current range,
    // damping velocity so the ship holds its post against any drift.
    const holdDoctrine: Doctrine = { base: { spatial: HOLD_SPATIAL }, rules: [] };
    const holder = buildShip({
      id: "holder",
      side: "attacker",
      x: 0,
      y: 0,
      thrust: 450,
      turnRate: 0.02,
      // No weapons: a recoil-free holder isolates the station-keep behaviour.
      weapons: [],
      doctrine: holdDoctrine,
    });
    const dummy = targetDummy({
      id: "dummy",
      side: "defender",
      x: 180,
      y: 0,
      structure: 99999,
    });
    const result = runBattle(inputs([holder, dummy], 20, SEED));

    // A holding ship station-keeps: it never wanders more than 500 m from its
    // tick-0 post (in practice it stays within a few metres — the station-keeper
    // damps the zero initial velocity to zero every tick).
    const start = shipAt(result, 0, "holder");
    for (const frame of result.frames) {
      const s = frame.ships.find((x) => x.instanceId === "holder");
      if (s === undefined) continue;
      const drift = Math.hypot(s.x - start.x, s.y - start.y);
      expect(drift, `holder should station-keep (tick ${frame.tick})`).toBeLessThan(500);
    }
  });
});

// ---------------------------------------------------------------------------
// THREATS_TO
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: THREATS_TO", () => {
  it("targets the enemy threatening the carrier, not the nearer non-threat", () => {
    // `threatsTo` is a relational mode, so it must be a rule's `then.targeting`
    // (the only path that writes `aiTargeting`). The filter keeps only enemies
    // whose current target is a member of the referenced friendly formation.
    //
    // Geometry isolates the verb: the escort has TWO enemies in view. The
    // striker (farther, at -800) targets the carrier — it IS a threat to the
    // carrier. The decoy (nearer, at +300) targets the escort — it is NOT a
    // threat to the carrier. A nearest-targeting ship would pick the decoy;
    // a threatsTo(carrier) ship must pick the striker.
    const threatsDoctrine: Doctrine = {
      base: { spatial: HOLD_SPATIAL },
      rules: [
        {
          condition: { kind: "tickAfter", tick: 0 },
          then: {
            targeting: {
              mode: {
                kind: "threatsTo",
                reference: { kind: "friendly", role: "carrier" },
              },
              vulnerableWeight: 0,
              focusFire: false,
            },
          },
        },
      ],
    };
    // The control: same hold station-keeping, but default nearest targeting
    // (no rule) — so the control escort picks the closer decoy.
    const nearestDoctrine: Doctrine = { base: { spatial: HOLD_SPATIAL }, rules: [] };

    // An indestructible carrier so its instanceId (and role reference) is
    // stable for the whole battle.
    const carrier = buildDummy({
      id: "carrier",
      x: -400,
      structure: 99999,
      durable: true,
      formationId: "f-carrier",
      role: "carrier",
    });

    const buildFleet = (escortDoctrine: Doctrine): CombatShip[] => [
      carrier,
      buildShip({
        id: "escort",
        side: "attacker",
        x: 0,
        thrust: 450,
        turnRate: 0.02,
        weapons: [beam({ range: 1200 })],
        doctrine: escortDoctrine,
        formationId: "f-escort",
        role: "escort",
      }),
      // Enemy striker: armed, holds station, targets the carrier (its nearest
      // attacker at 400 m vs the escort at 800 m).
      buildShip({
        id: "striker",
        side: "defender",
        x: -800,
        facing: 0,
        thrust: 450,
        turnRate: 0.02,
        weapons: [beam({ range: 600 })],
        doctrine: nearestDoctrine,
        formationId: "f-striker",
        role: "striker",
      }),
      // Enemy decoy: nearer to the escort (300 m) but targets the escort, not
      // the carrier, so the threatsTo filter excludes it.
      buildShip({
        id: "decoy",
        side: "defender",
        x: 300,
        facing: Math.PI,
        thrust: 450,
        turnRate: 0.02,
        weapons: [beam({ range: 600 })],
        doctrine: nearestDoctrine,
        formationId: "f-decoy",
        role: "decoy",
      }),
    ];

    const result = runBattle(inputs(buildFleet(threatsDoctrine), 30, SEED));

    // Premises: the striker threatens the carrier (targets it), and the decoy
    // does not (targets the escort). These make the threatsTo assertion
    // meaningful — without them both would be equally valid picks.
    const strikerTick = shipAt(result, 10, "striker");
    expect(strikerTick.targetId, "striker should target the carrier").toBe("carrier");
    const decoyTick = shipAt(result, 10, "decoy");
    expect(decoyTick.targetId, "decoy should target the escort (not the carrier)").toBe(
      "escort",
    );

    // The threatsTo escort picks the STRIKER — the enemy threatening the
    // carrier — even though the decoy is much closer (300 m vs 800 m). This
    // is the load-bearing assertion: relational targeting overrode distance.
    for (const t of [5, 10, 15, 20, 25]) {
      const escort = shipAt(result, t, "escort");
      expect(
        escort.targetId,
        `threatsTo escort should target the striker at tick ${t}`,
      ).toBe("striker");
    }

    // Contrasting value: with default nearest targeting (no rule), the same
    // escort picks the nearer DECOY. Identical fleet and geometry, different
    // targeting doctrine — this isolates threatsTo as the cause.
    const control = runBattle(inputs(buildFleet(nearestDoctrine), 30, SEED));
    const controlEscort = shipAt(control, 15, "escort");
    expect(
      controlEscort.targetId,
      "a nearest-targeting escort should pick the closer decoy",
    ).toBe("decoy");
  });
});

// ---------------------------------------------------------------------------
// FORMATION_STRENGTH (retreat via the spatial axis)
// ---------------------------------------------------------------------------

describe("formation-doctrine verbs: FORMATION_STRENGTH retreat", () => {
  it("holds station while the carrier is healthy, then flees once the carrier's formation strength drops below half", () => {
    // `formationStrength` is a formation condition, so the rule is evaluated by
    // the formation-doctrine pass. `then: { stance: "retreat" }` would be
    // silently dropped on a formation-conditioned rule (stepAi does not fire
    // for formation conditions, and the pass writes only spatial/targeting/fire),
    // so the retreat is expressed through the SPATIAL axis: once the carrier's
    // strength drops below 0.5, the escort switches from holding station to
    // evading its target (opening range without bound = fleeing).
    //
    // Side orientation: the GUNNER is the attacker and the carrier/escort are
    // defenders. The carrier is a (non-durable) target dummy so its structure
    // actually depletes; an attacker-side observer reliably acquires a defender
    // dummy (a defender observer does not), and a defender escort reliably
    // acquires an attacker gunner, so the escort can lock and then flee it.
    //
    // The gunner's beam range (350) reaches the carrier (300 m away) but NOT
    // the escort (500 m away), so only the carrier takes damage and the escort
    // survives to flee.
    const escortDoctrine: Doctrine = {
      base: { spatial: HOLD_SPATIAL },
      rules: [
        {
          condition: {
            kind: "formationStrength",
            reference: { kind: "friendly", role: "carrier" },
            threshold: 0.5,
            direction: "below",
          },
          then: {
            spatial: {
              reference: { kind: "target" },
              range: { kind: "evade", minRange: 100000 },
              bearing: { kind: "free" },
            },
          },
        },
      ],
    };

    // Carrier + escort are DEFENDERS (the side being protected); the gunner is
    // the ATTACKER. buildDummy keeps the attacker side by default, so the
    // carrier is re-stamped to defender here.
    const carrier: CombatShip = {
      ...buildDummy({
        id: "carrier",
        x: 300,
        structure: 1000,
        formationId: "f-carrier",
        role: "carrier",
      }),
      side: "defender",
    };
    const escort = buildShip({
      id: "escort",
      side: "defender",
      x: 500,
      thrust: 4000,
      turnRate: 0.05,
      weapons: [],
      doctrine: escortDoctrine,
      formationId: "f-escort",
      role: "escort",
    });
    // Enemy gunner (attacker): holds station at x=0, faces +x toward the
    // carrier. Beam range 350 reaches the carrier (300 m) but not the escort
    // (500 m), so the escort takes no damage.
    const gunner = buildShip({
      id: "gunner",
      side: "attacker",
      x: 0,
      facing: 0,
      thrust: 450,
      turnRate: 0.02,
      weapons: [beam({ damage: 200, range: 350 })],
      doctrine: { base: { spatial: HOLD_SPATIAL }, rules: [] },
      formationId: "f-gunner",
      role: "gunner",
    });

    const result = runBattle(inputs([carrier, escort, gunner], 60, SEED));

    // Premise: the carrier must actually take damage — find the tick its
    // structure first drops below half. If it never does, the rule never fires
    // and the test is vacuous.
    const maxStructure = 1000;
    let crossoverTick: number | undefined;
    for (const frame of result.frames) {
      const c = frame.ships.find((s) => s.instanceId === "carrier");
      if (c === undefined) continue;
      if (c.structure < maxStructure * 0.5) {
        crossoverTick = frame.tick;
        break;
      }
    }
    expect(
      crossoverTick,
      "carrier should be damaged below 50% structure so the rule can fire",
    ).toBeDefined();
    if (crossoverTick === undefined) return;

    // Before the crossover the escort HOLDS station: its separation from the
    // gunner is roughly constant (it has not started fleeing).
    const preSep = dist(result.frames, 1, "escort", "gunner");
    const crossSep = dist(result.frames, crossoverTick, "escort", "gunner");
    expect(
      Math.abs(crossSep - preSep),
      "escort should hold station before the carrier is weakened",
    ).toBeLessThan(50);

    // After the crossover the escort FLEES: its separation from the gunner
    // grows well beyond its holding-post separation. This is the observable
    // the formationStrength-then-evade rule produces.
    const lastTick = result.frames[result.frames.length - 1]?.tick ?? 60;
    const fleeSep = dist(result.frames, lastTick, "escort", "gunner");
    expect(
      fleeSep,
      "escort should flee the gunner after the carrier is weakened",
    ).toBeGreaterThan(crossSep + 30);
  });
});
