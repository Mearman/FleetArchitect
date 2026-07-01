import type { CellEdges } from "@/schema/grid";
import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import {
  resolveChainReactions,
  resolveChainReactionsReference,
} from "@/domain/simulation/engine/chain-reaction";
import { toSimShip } from "@/domain/simulation/engine/setup";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ModuleEffect } from "@/schema/module";
import type { ShipStats } from "@/domain/stats";
import type { SimModule, SimShip } from "@/domain/simulation/engine/types";

/**
 * Equivalence between the reference (oracle) and optimised chain-reaction
 * implementations. Both share the drain core (`drainChainReactions`); the only
 * difference is whether a spatial cell index is built. With the index
 * (optimised / production) each blast gathers candidates via a radius-box
 * lookup; without it (reference / oracle) each blast scans every alive cell on
 * the ship. Both strategies return the identical candidate list (same members,
 * same order), so the damage each blast deals — and the chain it drives as
 * further volatile cells die — is byte-identical.
 *
 * Each path runs against a fresh `structuredClone` of the same resolved ships,
 * because `resolveChainReactions` mutates ship state in place (module HP,
 * `alive` / `exploded` flags, structure). Fixtures use open edges exclusively:
 * wall/door blast attenuation is computed only on the optimised path (it needs
 * the cell index), so open-edge layouts — where attenuation is uniformly 1 — are
 * the common ground on which both paths agree exactly.
 */

const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

function stats(over: Partial<ShipStats> = {}): ShipStats {
  return {
    mass: 10,
    cost: 100,
    powerDraw: 0,
    powerOutput: 0,
    powerNet: 0,
    crewRequired: 0,
    crewCapacity: 0,
    crewNet: 0,
    structure: 1_000_000,
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
    ...over,
    compartments: 0,
    airtightCompartments: 0,
  };
}

function moduleOf(
  slotId: string,
  effect: ModuleEffect,
  col: number,
  row: number,
  maxHp: number,
  mass = 5,
  command = false,
): ResolvedModule {
  return {
    slotId,
    moduleId: `mod-${slotId}`,
    kind: effect.kind,
    col,
    row,
    x: col * CELL_SIZE,
    y: row * CELL_SIZE,
    maxSurfaceHp: 0,
    maxSubstrateHp: maxHp,
    surfaceReduction: 0,
    reactiveReduction: 0,
    reactiveWindow: 0,
    maxReactiveHp: 0,
    surface: "bare",
    edges: OPEN_EDGES,
    mass,
    powerDraw: 0,
    crewRequired: 0,
    effect,
    command,
    repairRate: 0,
    shieldArc: Math.PI * 2,
    shieldFacing: 0,
    facing: "facing" in effect && typeof effect.facing === "number" ? effect.facing : 0,
    weaponFacing: 0,
    turretArc: 0,
    turretTurnRate: 0,
    channel: 0,
    commsBearing: 0,
    sensorBearing: 0,
  };
}

function combatShip(
  id: string,
  side: "attacker" | "defender",
  modules: ResolvedModule[],
  position: { x: number; y: number },
  facing: number,
): CombatShip {
  return {
    instanceId: id,
    designId: `d-${id}`,
    faction: "Terran",
    side,
    stats: stats(),
    position,
    facing,
    doctrine: { base: {}, rules: [] },
    classification: "frigate",
    modules,
  };
}

function resolveToSim(ships: CombatShip[]): SimShip[] {
  const rng = mulberry32(7);
  return ships.map((s) => toSimShip(s, rng));
}

/** Mark the module with `slotId` as destroyed (alive = false, hp = 0) so the
 *  chain-reaction queue picks it up as a pending detonation. Throws if the
 *  slotId is not found, so a fixture typo surfaces immediately. */
function killModule(ship: SimShip, slotId: string): void {
  if (ship.modules === undefined) throw new Error(`ship ${ship.instanceId} has no modules`);
  const m = ship.modules.find((mod) => mod.slotId === slotId);
  if (m === undefined) throw new Error(`slot ${slotId} not found on ${ship.instanceId}`);
  m.alive = false;
  m.hp = 0;
}

/** Look up a module by slotId on a SimShip, throwing on a missing modules array
 *  or unknown slot so a fixture typo surfaces immediately. */
function getModule(ship: SimShip, slotId: string): SimModule {
  if (ship.modules === undefined) throw new Error(`ship ${ship.instanceId} has no modules`);
  const m = ship.modules.find((mod) => mod.slotId === slotId);
  if (m === undefined) throw new Error(`slot ${slotId} not found on ${ship.instanceId}`);
  return m;
}

/** Return the first ship in a non-empty array, throwing if the array is empty.
 *  Used for single-ship fixtures where `ships[0]` would otherwise be
 *  `SimShip | undefined` under `noUncheckedIndexedAccess`. */
function firstShip(ships: readonly SimShip[]): SimShip {
  const s = ships[0];
  if (s === undefined) throw new Error("expected at least one ship");
  return s;
}

/** Captured per-module state after the chain settles. `surfaceHp` and `hp` are
 *  the two damage reservoirs `applyDamage` depletes; `alive` and `exploded`
 *  track whether the cell is still in play and whether a volatile cell has
 *  detonated. Comparing these four fields across every module is sufficient to
 *  prove the two paths applied identical damage. */
interface ModuleSummary {
  slotId: string;
  alive: boolean;
  exploded: boolean;
  hp: number;
  surfaceHp: number;
}

interface ShipSummary {
  instanceId: string;
  structure: number;
  shield: number;
  modules: ModuleSummary[];
}

function summarise(ship: SimShip): ShipSummary {
  if (ship.modules === undefined) {
    return { instanceId: ship.instanceId, structure: ship.structure, shield: ship.shield, modules: [] };
  }
  return {
    instanceId: ship.instanceId,
    structure: ship.structure,
    shield: ship.shield,
    modules: ship.modules.map((m) => ({
      slotId: m.slotId,
      alive: m.alive,
      exploded: m.exploded,
      hp: m.hp,
      surfaceHp: m.surfaceHp,
    })),
  };
}

function expectEquivalent(ref: SimShip, opt: SimShip): void {
  const r = summarise(ref);
  const o = summarise(opt);
  expect(o.modules.length, "module count must match").toBe(r.modules.length);
  for (let i = 0; i < r.modules.length; i += 1) {
    const rm = r.modules[i];
    const om = o.modules[i];
    if (rm === undefined || om === undefined) throw new Error("module summary missing");
    expect(om.slotId, "module order must match").toBe(rm.slotId);
    expect(om.alive, `alive flag for ${rm.slotId}`).toBe(rm.alive);
    expect(om.exploded, `exploded flag for ${rm.slotId}`).toBe(rm.exploded);
    expect(om.hp, `hp for ${rm.slotId}`).toBe(rm.hp);
    expect(om.surfaceHp, `surfaceHp for ${rm.slotId}`).toBe(rm.surfaceHp);
  }
  expect(o.structure, "structure").toBe(r.structure);
  expect(o.shield, "shield").toBe(r.shield);
}

/** Run both implementations on independent deep clones of the same ships and
 *  assert identical post-chain state. The triggering module(s) are killed on
 *  `ships` BEFORE cloning so both clones start from byte-identical state. */
function assertChainEquivalent(ships: SimShip[], sourceInstanceId: string): void {
  const ref = structuredClone(ships);
  const opt = structuredClone(ships);
  const refShip = ref.find((s) => s.instanceId === sourceInstanceId);
  const optShip = opt.find((s) => s.instanceId === sourceInstanceId);
  if (refShip === undefined || optShip === undefined) {
    throw new Error(`source ship ${sourceInstanceId} not found`);
  }
  resolveChainReactionsReference(refShip, ref);
  resolveChainReactions(optShip, opt);
  for (let i = 0; i < ref.length; i += 1) {
    const r = ref[i];
    const o = opt[i];
    if (r === undefined || o === undefined) throw new Error("ship missing from clone");
    expectEquivalent(r, o);
  }
}

describe("engine.chain-reaction — reference vs optimised equivalence", () => {
  // -------------------------------------------------------------------------
  // Fixture 1: reactor detonation with partial damage to neighbours.
  //
  // A reactor's yield (output * reactorYieldFraction) is small enough that
  // adjacent cells with modest HP survive the blast with partial damage, so the
  // equivalence assertion exercises exact HP matching rather than just
  // alive/dead. The four hull cells sit one step (distance 1, falloff 0.5) from
  // the reactor in each cardinal direction; the cell at (2, 0) sits at the blast
  // radius edge (distance 2, falloff 0) and takes no damage.
  // -------------------------------------------------------------------------
  it("reactor detonation: neighbours take identical partial damage on both paths", () => {
    const ship = combatShip(
      "solo",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 2_000_000 }, 0, 0, 1_000, 5, true),
        moduleOf("h1", { kind: "hull" }, 1, 0, 2_000),
        moduleOf("h2", { kind: "hull" }, -1, 0, 2_000),
        moduleOf("h3", { kind: "hull" }, 0, 1, 2_000),
        moduleOf("h4", { kind: "hull" }, 0, -1, 2_000),
        moduleOf("h5", { kind: "hull" }, 2, 0, 2_000),
      ],
      { x: 0, y: 0 },
      0,
    );
    const ships = resolveToSim([ship]);
    killModule(firstShip(ships), "r1");
    assertChainEquivalent(ships, "solo");

    // Sanity: the reactor must have detonated and neighbours must have taken
    // partial damage (proving the chain actually ran and the test is meaningful).
    const sanity = structuredClone(ships);
    const sanityShip = firstShip(sanity);
    resolveChainReactions(sanityShip, sanity);
    expect(getModule(sanityShip, "r1").exploded, "reactor must detonate").toBe(true);
    const h1 = getModule(sanityShip, "h1");
    const h5 = getModule(sanityShip, "h5");
    expect(h1.hp, "adjacent hull must be damaged").toBeLessThan(2_000);
    expect(h1.alive, "adjacent hull must survive").toBe(true);
    expect(h5.hp, "radius-edge hull must be untouched").toBe(2_000);
  });

  // -------------------------------------------------------------------------
  // Fixture 2: magazine-to-reactor chain.
  //
  // A magazine cook-off (yield = ammoStored * magazineYieldPerRound) is violent
  // enough to kill an adjacent reactor, which then detonates in turn — a genuine
  // two-hop chain. The reactor's lower-yield blast then reaches a hull cell that
  // the magazine blast did not (the magazine blast is omnidirectional but the
  // reactor is closer to the far hull). This exercises the queue rebuild
  // (collectPending re-runs after each detonation batch) and proves both paths
  // chain identically.
  //
  // Module layout (local, facing 0):
  //   col=-1  col=0        col=1       col=2
  //   hull    magazine     reactor     hull
  // -------------------------------------------------------------------------
  it("magazine-to-reactor chain: both paths detonate the same cells", () => {
    const ship = combatShip(
      "chain",
      "attacker",
      [
        moduleOf("h-left", { kind: "hull" }, -1, 0, 5_000),
        moduleOf("mag", { kind: "magazine", ammoStored: 1 }, 0, 0, 100),
        moduleOf("rea", { kind: "power", output: 2_000_000 }, 1, 0, 1_000),
        moduleOf("h-right", { kind: "hull" }, 2, 0, 5_000),
      ],
      { x: 0, y: 0 },
      0,
    );
    const ships = resolveToSim([ship]);
    killModule(firstShip(ships), "mag");
    assertChainEquivalent(ships, "chain");

    // Sanity: both volatile cells must detonate (the chain must reach the
    // reactor), proving the test exercises the chaining path.
    const sanity = structuredClone(ships);
    const sanityShip = firstShip(sanity);
    resolveChainReactions(sanityShip, sanity);
    const mag = getModule(sanityShip, "mag");
    const rea = getModule(sanityShip, "rea");
    expect(mag.exploded, "magazine must detonate").toBe(true);
    expect(rea.exploded, "reactor must detonate via chain").toBe(true);
    expect(rea.alive, "reactor must be dead").toBe(false);
  });

  // -------------------------------------------------------------------------
  // Fixture 3: within-ship and cross-ship blast in one run.
  //
  // A reactor detonation on ship A damages its own hull cells (within-ship,
  // shieldPiercing = armourPiercing = 1) AND a second ship B parked just inside
  // the blast radius (cross-ship, no piercing). Both damage paths run through
  // the shared `applyDamage` with the same arguments on both implementations, so
  // the full end state must match. Ship B sits at world distance 1 from the
  // blast centre (well inside the 2-cell radius).
  // -------------------------------------------------------------------------
  it("cross-ship blast: within-ship and cross-ship damage match on both paths", () => {
    const shipA = combatShip(
      "blast-src",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 2_000_000 }, 0, 0, 1_000, 5, true),
        moduleOf("h1", { kind: "hull" }, 1, 0, 5_000),
      ],
      { x: 0, y: 0 },
      0,
    );
    const shipB = combatShip(
      "blast-victim",
      "defender",
      [moduleOf("bv", { kind: "hull" }, 0, 0, 5_000, 5, true)],
      { x: CELL_SIZE, y: 0 }, // 1 m from the blast centre — inside the radius
      0,
    );
    const ships = resolveToSim([shipA, shipB]);
    killModule(firstShip(ships), "r1");
    assertChainEquivalent(ships, "blast-src");

    // Sanity: the victim ship's cell must take cross-ship damage.
    const sanity = structuredClone(ships);
    const srcShip = sanity.find((s) => s.instanceId === "blast-src");
    if (srcShip === undefined) throw new Error("blast-src not found");
    resolveChainReactions(srcShip, sanity);
    const victimShip = sanity.find((s) => s.instanceId === "blast-victim");
    if (victimShip === undefined) throw new Error("blast-victim not found");
    const victim = getModule(victimShip, "bv");
    expect(victim.hp, "victim cell must be damaged by cross-ship blast").toBeLessThan(5_000);
  });

  // -------------------------------------------------------------------------
  // Fixture 4: no volatile death — both paths are no-ops.
  //
  // With every module alive, collectPending returns an empty queue and both
  // paths return immediately without touching any state. This guards against a
  // refactor that accidentally builds the spatial index (or otherwise mutates
  // state) even when there is nothing to process.
  // -------------------------------------------------------------------------
  it("no volatile death: both paths are no-ops", () => {
    const ship = combatShip(
      "calm",
      "attacker",
      [
        moduleOf("r1", { kind: "power", output: 1_000 }, 0, 0, 1_000, 5, true),
        moduleOf("m1", { kind: "magazine", ammoStored: 5 }, 1, 0, 500),
        moduleOf("h1", { kind: "hull" }, 2, 0, 2_000),
      ],
      { x: 0, y: 0 },
      0,
    );
    const ships = resolveToSim([ship]);
    // No module killed — both paths should be no-ops.
    assertChainEquivalent(ships, "calm");

    const sanity = structuredClone(ships);
    const sanityShip = firstShip(sanity);
    resolveChainReactions(sanityShip, sanity);
    if (sanityShip.modules === undefined) throw new Error("calm has no modules");
    const allAlive = sanityShip.modules.every((m) => m.alive && !m.exploded);
    expect(allAlive, "no module should be touched when no volatile cell has died").toBe(true);
  });
});
