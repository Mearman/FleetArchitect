/**
 * REFERENCE (oracle) power-grid + aggregate recomputation: the naive
 * unbounded-scan brownout path, kept as a first-class implementation the
 * equivalence test (`engine.aggregates.equivalence.unit.test.ts`) compares
 * against the optimised {@link recomputeAggregates} in `./physics`.
 *
 * Production never imports this module; production runs `recomputeAggregates`.
 * The two functions have the same signature and the same body apart from the
 * brownout cut strategy: the optimised path pre-sorts the cut candidates once
 * (descending `powerDraw`, stable) and walks them, while this reference
 * re-scans every cell on every cut. Both strategies cut the same victims in the
 * same order — `Array.sort` is stable, so equal draws keep their array order,
 * matching the strict-`>` "first wins" tie-break of the re-scan — so the
 * post-recompute ship state is byte-identical. The reference is a pure bound
 * on the same computation, exactly mirroring the `resolveChainReactions` /
 * `resolveChainReactionsReference` split in `./chain-reaction`.
 */
import type { WeaponEffect } from "@/schema/module";

import { isCharged, isOperational } from "./crew";
import { localCentreOfMass } from "./physics";
import { gridRadius } from "./setup";
import type { SimModule, SimShip } from "./types";

/**
 * REFERENCE (oracle) power-grid + aggregate recomputation. Same body as
 * {@link recomputeAggregates} in `./physics` with the naive brownout cut: a
 * `while (demand > supply)` loop that re-scans every cell on each cut to find
 * the hungriest powered weapon/PD/shield, instead of pre-sorting the candidates
 * once. Not wired into production; production runs `recomputeAggregates`.
 */
export function recomputeAggregatesReference(ship: SimShip): void {
  if (ship.modules === undefined) return;

  // 1. Supply from alive, manned reactors. A reactor that needs crew only
  //    outputs when its cell is manned — an unmanned reactor is cold.
  let supply = 0;
  for (const m of ship.modules) {
    if (m.alive && m.manned && m.effect.kind === "power") {
      supply += m.effect.output;
    }
  }
  // Reactor overcharge (factions update): every active overcharge module lifts
  // the power ceiling by its `powerSurge` for the duration of its window, so
  // more consumers stay online through a brownout.
  for (const m of ship.modules) {
    if (m.effect.kind === "overcharge" && m.techActive > 0 && isOperational(m)) {
      supply += m.effect.powerSurge;
    }
  }

  // 2. Start every alive module powered; we'll disable the hungriest to fit the
  //    budget. Reactors draw nothing. Also refreshes `ship.aliveCount`.
  let aliveCount = 0;
  for (const m of ship.modules) {
    m.powered = m.alive && m.effect.kind !== "power";
    if (m.alive) aliveCount += 1;
  }
  ship.aliveCount = aliveCount;

  // 3. Demand from powered consumers. If it exceeds supply, take the
  //    hungriest offline — weapons and PD first (PD is an active defence
  //    system, same priority class as offensive weapons), then shields —
  //    rechecking each time, until demand ≤ supply (or nothing is left to
  //    cut).
  const demandOf = (m: SimModule): number => (m.powered ? m.powerDraw : 0);
  let demand = 0;
  for (const m of ship.modules) demand += demandOf(m);

  if (demand > supply) {
    while (demand > supply) {
      // Candidates to cut: powered weapons or PD modules, else powered shields.
      let victim: SimModule | undefined;
      let bestDraw = -1;
      for (const m of ship.modules) {
        if (!m.powered) continue;
        if (
          m.effect.kind !== "weapon" &&
          m.effect.kind !== "pointDefense" &&
          m.effect.kind !== "shield"
        ) {
          continue;
        }
        if (m.powerDraw > bestDraw) {
          bestDraw = m.powerDraw;
          victim = m;
        }
      }
      if (victim === undefined) break; // nothing power-hungry left to cut
      victim.powered = false;
      demand -= victim.powerDraw;
    }
  }

  // 4. Build aggregates from alive + powered modules.
  let thrust = ship.hullBaseThrust ?? 0;
  let mass = 0;
  const armourReduction = 0;
  let shieldCapacity = 0;
  let shieldRechargeRate = 0;
  let shieldRechargeDelay = 0;
  let shieldAdaptiveRamp = 0;
  let deflectorCapacity = 0;
  let deflectorRechargeRate = 0;
  let deflectorRechargeDelay = 0;
  const weapons: WeaponEffect[] = [];
  const cooldowns: number[] = [];

  for (const m of ship.modules) {
    if (!m.alive) {
      mass += 0; // destroyed modules contribute neither mass nor function
      continue;
    }
    mass += m.mass;
    if (!m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
    const effect = m.effect;
    switch (effect.kind) {
      case "weapon":
        weapons.push(effect);
        cooldowns.push(m.cooldown);
        break;
      case "shield":
        shieldCapacity += effect.capacity;
        shieldRechargeRate += effect.rechargeRate;
        shieldRechargeDelay = Math.max(shieldRechargeDelay, effect.rechargeDelay);
        if (effect.adaptiveRampRate !== undefined) {
          shieldAdaptiveRamp = Math.max(shieldAdaptiveRamp, effect.adaptiveRampRate);
        }
        break;
      case "deflector":
        deflectorCapacity += effect.capacity;
        deflectorRechargeRate += effect.rechargeRate;
        deflectorRechargeDelay = Math.max(deflectorRechargeDelay, effect.rechargeDelay);
        break;
      case "engine":
        if (!m.fuelStarved) thrust += effect.thrust;
        break;
      case "power":
      case "crew":
      case "pointDefense":
      case "repair":
      case "hull":
      case "magazine":
      case "sensor":
      case "comms":
      case "rcs":
      case "reactionWheel":
      case "blink":
      case "afterburner":
      case "overcharge":
      case "cloak":
      case "signature":
      case "ecm":
      case "eccm":
      case "decoy":
      case "commandAura":
      case "hangar":
      case "mineLayer":
      case "boarding":
        break;
    }
  }

  ship.thrust = thrust;
  ship.mass = mass;
  ship.armourReduction = armourReduction;
  ship.maxShield = shieldCapacity;
  ship.shieldRechargeRate = shieldRechargeRate;
  ship.shieldRechargeDelay = shieldRechargeDelay;
  ship.shieldAdaptiveRamp = shieldAdaptiveRamp;
  ship.shield = Math.min(ship.shield, shieldCapacity);
  ship.maxDeflector = deflectorCapacity;
  ship.deflectorRechargeRate = deflectorRechargeRate;
  ship.deflectorRechargeDelay = deflectorRechargeDelay;
  ship.deflector = Math.min(ship.deflector, deflectorCapacity);
  ship.weapons = weapons;
  ship.weaponCooldowns = cooldowns;

  // Centre of mass and moment of inertia derived purely from the alive cells'
  // mass distribution.
  const com = localCentreOfMass(ship.modules);
  const comX = com.x;
  const comY = com.y;
  let moi = 0;
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const dx = m.x - comX;
    const dy = m.y - comY;
    moi += m.mass * (dx * dx + dy * dy);
  }
  ship.comX = comX;
  ship.comY = comY;
  ship.momentOfInertia = Math.max(moi, 1);
  ship.radius = gridRadius(ship.modules);
}
