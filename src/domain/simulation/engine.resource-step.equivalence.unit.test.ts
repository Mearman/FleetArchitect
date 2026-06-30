import { describe, expect, it } from "vitest";
import {
  makeResourceState,
  resourceStep,
  resourceStepReference,
} from "./engine/resource-step";
import type { SimModule, SimShip } from "./engine/types";
import type { SimCrew } from "@/domain/simulation/types";
import type { ModuleEffect, EngineEffect, PowerPlantEffect, WeaponEffect } from "@/schema/module";
import { SIM } from "./engine/config";

/**
 * Equivalence between the reference (oracle) and optimised resource-step
 * implementations. Both share the `runResourceStep` core; the ONLY difference
 * is the `idx` lookup — optimised reads each module's precomputed
 * `m.transportIndex` (a property access set once by `makeResourceState` from the
 * module-index map), reference re-allocates a `"col,row"` template string and
 * hashes the map per call. Both return the same value (the cache IS the map's
 * value), so every downstream step — transport graph fetch, thermal/propellant/
 * atmosphere field integration, overheat death, flame-out, brownout, vent
 * recoil, crew exposure — is byte-identical.
 *
 * Each path runs against a `structuredClone` of the same template ship, because
 * `resourceStep` mutates ship state in place (resource arrays, module flags,
 * velocity from vent recoil, crew HP). The fixtures exercise every `idx` call
 * site: the overheat loop, the engine-thrust build, the flame-out check, and
 * the deck-cells build — across thermal, propellant, atmosphere, and brownout
 * stepping on hand-authored modular ships.
 */

function engineEffect(thrust: number): EngineEffect {
  return { kind: "engine", thrust, gimbalArc: 0 };
}
function reactorEffect(output: number): PowerPlantEffect {
  return { kind: "power", output };
}

/** Build a SimModule at (col, row) with the given effect and surface kind. */
function moduleAt(
  col: number,
  row: number,
  effect: ModuleEffect,
  surface: "deck" | "armor" | "bare" = "deck",
): SimModule {
  return {
    slotId: `cell-${col}-${row}`,
    moduleId: "m",
    kind: effect.kind,
    col,
    row,
    x: col,
    y: row,
    surface,
    edges: { n: "wall", e: col === 0 ? "wall" : "open", s: "wall", w: col === 1 ? "wall" : "open", doorStates: {} },
    surfaceHp: 100,
    maxSurfaceHp: 100,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    hp: 100,
    maxHp: 100,
    mass: 1,
    powerDraw: effect.kind === "power" ? 0 : 10,
    effect,
    cooldown: 0,
    ammo: 0,
    ammoStored: 0,
    charge: 100,
    alive: true,
    powered: true,
    powerCut: false,
    fuelStarved: false,
    manned: true,
    crewRequired: 0,
    command: false,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    turretAngle: 0,
    channel: 0,
    commsBearing: 0,
    dishAngle: 0,
    sensorBearing: 0,
    techCooldown: 0,
    techActive: 0,
    reactiveCharge: 0,
    mineCooldown: 0,
    boardingCooldown: 0,
    exploded: false,
  };
}

/** A deck cell with the given open-edge directions; all other edges wall. */
function deckCell(col: number, row: number, open: ("n" | "e" | "s" | "w")[]): SimModule {
  const base = moduleAt(col, row, { kind: "hull" });
  return {
    ...base,
    powerDraw: 0,
    edges: {
      n: open.includes("n") ? "open" : "wall",
      e: open.includes("e") ? "open" : "wall",
      s: open.includes("s") ? "open" : "wall",
      w: open.includes("w") ? "open" : "wall",
      doorStates: {},
    },
  };
}

function shipWith(over: Partial<SimShip> = {}): SimShip {
  const modules: SimModule[] = [
    moduleAt(0, 0, engineEffect(1000)),
    moduleAt(1, 0, reactorEffect(1_000_000)),
  ];
  return {
    instanceId: "s1",
    faction: "Terran",
    side: "attacker",
    classification: "frigate",
    x: 0,
    y: 0,
    facing: 0,
    velX: 0,
    velY: 0,
    px: 0,
    py: 0,
    angVel: 0,
    dilationFactor: 1,
    structure: 100,
    maxStructure: 100,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    deflector: 0,
    maxDeflector: 0,
    deflectorRechargeRate: 0,
    deflectorRechargeDelay: 0,
    deflectorRegenCountdown: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 1000,
    turnRate: 0,
    engineThrottle: 0,
    mass: 1000,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: 1,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    doctrine: { base: {}, rules: [] },
    aiHoldFire: false,
    aiStance: null,
    aiFocusFire: false,
    aiRetreat: false,
    aiPrioritiseRepair: false,
    aiRally: false,
    aiWasFiredUpon: false,
    target: undefined,
    alive: true,
    salvageMass: 0,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    sensorSaturation: 0,
    modules,
    crew: [],
    ...over,
  };
}

function crewAt(id: string, col: number, row: number, hp: number): SimCrew {
  return {
    id,
    col,
    row,
    ox: 0,
    oy: 0,
    hp,
    job: "idle",
    path: [],
    pathIndex: 0,
    moveAccumulator: 0,
  };
}

/** Captured post-step state for byte-identity comparison. Covers every field
 *  `resourceStep` mutates: the three transport-field arrays, the power buffer,
 *  per-module consequence flags + HP + alive, vent-recoil velocity, and crew HP. */
interface StepSummary {
  thermal: number[];
  propellant: number[];
  atmosphere: number[];
  energy: number;
  velX: number;
  velY: number;
  angVel: number;
  modules: {
    slotId: string;
    alive: boolean;
    hp: number;
    surfaceHp: number;
    fuelStarved: boolean;
    powerCut: boolean;
  }[];
  crewHp: number[];
}

function summarise(ship: SimShip): StepSummary {
  const state = ship.resource;
  if (state === undefined) throw new Error("no resource state");
  return {
    thermal: [...state.thermal],
    propellant: [...state.propellant],
    atmosphere: [...state.atmosphere],
    energy: state.powerBuffer.energy,
    velX: ship.velX,
    velY: ship.velY,
    angVel: ship.angVel,
    modules: (ship.modules ?? []).map((m) => ({
      slotId: m.slotId,
      alive: m.alive,
      hp: m.hp,
      surfaceHp: m.surfaceHp,
      fuelStarved: m.fuelStarved,
      powerCut: m.powerCut,
    })),
    crewHp: (ship.crew ?? []).map((c) => c.hp),
  };
}

/** Run both implementations on independent deep clones of the same template
 *  ship for `ticks` ticks, then assert byte-identical post-step state. The
 *  template's `resource` state is built fresh inside this helper so both clones
 *  carry an identical `ResourceState` (including the cached `transportIndex`
 *  fields the optimised path reads). */
function assertStepEquivalent(buildTemplate: () => SimShip, ticks: number): void {
  const ref = structuredClone(buildTemplate());
  const opt = structuredClone(buildTemplate());
  for (let t = 0; t < ticks; t += 1) {
    resourceStepReference(ref);
    resourceStep(opt);
  }
  expect(summarise(opt)).toEqual(summarise(ref));
}

/** Build the resource state on a ship (mutating it in place) and return it, so
 *  the template carries the state both clones will step from. */
function withResource(ship: SimShip): SimShip {
  const state = makeResourceState(ship);
  if (state === undefined) throw new Error("no resource state");
  ship.resource = state;
  return ship;
}

describe("engine.resource-step — reference vs optimised equivalence", () => {
  // -------------------------------------------------------------------------
  // Fixture 1: thermal + propellant + overheat + flame-out, one tick.
  //
  // A 3x3 grid of deck cells with a reactor at the interior centre (1,1) and an
  // engine at (0,0). The interior reactor cell has no radiator surface, so a
  // forced temperature spike survives the thermal step and trips Gate 3. The
  // engine at (0,0) is commanded to thrust with a dry tank, exercising Gate 1.
  // Together these exercise every idx call site in a single tick: the overheat
  // loop reads idx for every alive cell (and kills the reactor), the
  // engine-thrust build reads idx for the engine, the flame-out check reads idx
  // and flags it, and the deck-cells build reads idx for all nine deck cells.
  // -------------------------------------------------------------------------
  it("thermal + propellant + overheat + flame-out: both paths produce identical state", () => {
    const build = (): SimShip => {
      const modules: SimModule[] = [];
      for (let col = 0; col < 3; col += 1) {
        for (let row = 0; row < 3; row += 1) {
          modules.push(moduleAt(col, row, { kind: "hull" }));
        }
      }
      // Replace the centre cell with a reactor and (0,0) with an engine.
      const centreIdx = modules.findIndex((m) => m.col === 1 && m.row === 1);
      if (centreIdx === -1) throw new Error("no centre cell");
      modules[centreIdx] = moduleAt(1, 1, reactorEffect(1_000_000));
      const cornerIdx = modules.findIndex((m) => m.col === 0 && m.row === 0);
      if (cornerIdx === -1) throw new Error("no corner cell");
      modules[cornerIdx] = moduleAt(0, 0, engineEffect(1000));
      const ship = shipWith({ modules, engineThrottle: 1 });
      const state = makeResourceState(ship);
      if (state === undefined) throw new Error("no state");
      ship.resource = state;
      // Force the interior reactor cell well past the overheat threshold so
      // Gate 3 fires despite one thermal step (the interior cell has no
      // radiator flux, so it stays hot).
      const reactorCellIdx = state.moduleIndex.get("1,1");
      if (reactorCellIdx === undefined) throw new Error("no reactor cell");
      state.thermal[reactorCellIdx] = SIM.overheatThresholdK + 10_000;
      // Force the engine cell's tank dry so Gate 1 flames it out.
      const engineCellIdx = state.moduleIndex.get("0,0");
      if (engineCellIdx === undefined) throw new Error("no engine cell");
      state.propellant[engineCellIdx] = 0;
      return ship;
    };
    assertStepEquivalent(build, 1);

    // Sanity: the reactor must overheat and the engine must flame out, proving
    // the consequence paths actually ran (and the equivalence assertion is
    // meaningful, not a trivially-empty step).
    const sanity = structuredClone(build());
    resourceStep(sanity);
    const reactor = sanity.modules?.find((m) => m.col === 1 && m.row === 1);
    const engine = sanity.modules?.find((m) => m.col === 0 && m.row === 0);
    expect(reactor?.alive, "reactor must overheat and die").toBe(false);
    expect(engine?.fuelStarved, "engine must flame out on the dry tank").toBe(true);
  });

  // -------------------------------------------------------------------------
  // Fixture 2: atmosphere breach + vent recoil + crew exposure, multi-tick.
  //
  // Two adjacent deck cells; cell B is killed to open a breach through cell A's
  // east edge. A crew member stands on A. Over 30 ticks the breached cell vents
  // to vacuum, recoiling the hull and exposing the crew. This exercises the
  // vent-recoil path (which reads `graph.aliveByIndex`), the deck-cells build
  // (idx), and the crew-exposure path. The topology change (B's death) forces a
  // graph rebuild on the first step, so both paths rebuild the folded indices
  // from the post-death alive set.
  // -------------------------------------------------------------------------
  it("atmosphere breach + vent recoil + crew exposure: both paths produce identical state", () => {
    const build = (): SimShip => {
      const aDeck = deckCell(0, 0, ["e"]);
      const bDeck = deckCell(1, 0, ["w"]);
      const ship = shipWith({
        modules: [aDeck, bDeck],
        mass: 100,
        crew: [crewAt("s1-crew-0", 0, 0, 10)],
      });
      const state = makeResourceState(ship);
      if (state === undefined) throw new Error("no state");
      ship.resource = state;
      // Kill cell B to open the breach, and clear the cached graph exactly as
      // the engine does after a module death (refreshPathCache sets it
      // undefined so the next step rebuilds with the new alive set).
      bDeck.alive = false;
      ship.resourceGraph = undefined;
      return ship;
    };
    assertStepEquivalent(build, 30);

    // Sanity: the hull must recoil and the crew must take damage.
    const sanity = structuredClone(build());
    for (let t = 0; t < 30; t += 1) resourceStep(sanity);
    expect(sanity.velX, "breach must recoil the hull").not.toBe(0);
    expect(sanity.crew?.[0]?.hp ?? 0, "crew must take vacuum damage").toBeLessThan(10);
  });

  // -------------------------------------------------------------------------
  // Fixture 3: intact multi-module ship, multi-tick (regression coverage).
  //
  // A reactor + engine + two deck cells + crew, throttle on, hull intact. Run
  // 20 ticks so the thermal field migrates from cabin temperature, the
  // propellant burns down, and the power buffer settles. No consequence fires
  // (no overheat, no flame-out, no breach), so this exercises the steady-state
  // idx lookups across every alive module every tick — the common-case workload
  // the optimised path is designed for.
  // -------------------------------------------------------------------------
  it("intact multi-module ship: steady-state stepping is identical over many ticks", () => {
    const build = (): SimShip => {
      const modules: SimModule[] = [
        moduleAt(0, 0, reactorEffect(1_000_000)),
        moduleAt(1, 0, engineEffect(1000)),
        deckCell(0, 1, []),
        deckCell(1, 1, []),
      ];
      const ship = shipWith({
        modules,
        engineThrottle: 1,
        crew: [crewAt("s1-crew-0", 0, 1, 10)],
      });
      return withResource(ship);
    };
    assertStepEquivalent(build, 20);

    // Sanity: the thermal field must have moved off the initial cabin temp and
    // propellant must have burned down, proving the steps actually ran.
    const sanity = structuredClone(build());
    const initialThermal = [...(sanity.resource?.thermal ?? [])];
    const initialPropellant = [...(sanity.resource?.propellant ?? [])];
    for (let t = 0; t < 20; t += 1) resourceStep(sanity);
    expect(sanity.resource?.thermal, "thermal must evolve").not.toEqual(initialThermal);
    expect(sanity.resource?.propellant, "propellant must burn down").not.toEqual(initialPropellant);
  });

  // -------------------------------------------------------------------------
  // Fixture 4: brownout load-shed.
  //
  // A single weapon drawing power with no reactor and an empty buffer: the grid
  // cannot meet the draw, so Gate 2 sheds the weapon. The terminals loop does
  // not use idx (it iterates modules directly), but the brownout shed writes
  // `powerCut` which the summary captures — and the step's other idx call sites
  // (overheat, deckCells) still run, so the equivalence covers the whole step.
  // -------------------------------------------------------------------------
  it("brownout load-shed: both paths produce identical powerCut state", () => {
    const weaponEffect: WeaponEffect = {
      kind: "weapon",
      weaponType: "cannon",
      damage: 10,
      range: 100,
      cooldown: 1,
      projectileSpeed: 8,
      projectileMass: 0.5,
      tracking: 0,
      shieldPiercing: 0,
      armourPiercing: 0,
      spread: 0,
    };
    const build = (): SimShip => {
      const weapon = moduleAt(1, 0, weaponEffect);
      const ship = shipWith({ modules: [weapon] });
      const state = makeResourceState(ship);
      if (state === undefined) throw new Error("no state");
      state.powerBuffer = { energy: 0, capacityJoules: 0 };
      ship.resource = state;
      return ship;
    };
    assertStepEquivalent(build, 1);

    // Sanity: the weapon must be power-cut.
    const sanity = structuredClone(build());
    resourceStep(sanity);
    expect(sanity.modules?.[0]?.powerCut, "weapon must be shed by brownout").toBe(true);
  });
});
