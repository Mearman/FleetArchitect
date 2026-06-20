/**
 * Phantom ships (drones and decoys): construction, launch, and the per-tick
 * step that homes drones and times out expired phantoms.
 */

import type { DecoyEffect, HangarEffect } from "@/schema/module";
import { defaultOrders } from "@/schema/fleet";

import { defaultAiDecisions } from "./ai-step";
import { SIM } from "./config";
import { isOperational } from "./crew";
import { applyDamage } from "./damage";
import type { SimShip } from "./types";

/** A fresh drone SimShip, launched from `owner` toward the fight. Deterministic:
 *  every field is a pure function of the effect + positions + id; no rng. */
export function makeDrone(
  id: string,
  owner: SimShip,
  effect: HangarEffect,
): SimShip {
  const lifetime = effect.droneLifetime ?? SIM.droneDefaultLifetime;
  return {
    instanceId: id,
    faction: owner.faction,
    side: owner.side,
    classification: "fighter",
    x: owner.x,
    y: owner.y,
    facing: owner.facing,
    velX: 0,
    velY: 0,
    // A drone starts at rest, so its momentum starts at zero. Phantoms move in
    // a bespoke homing step rather than the force integrator, so this is never
    // re-derived; it stays the resting-momentum record.
    px: 0,
    py: 0,
    angVel: 0,
    dilationFactor: 1,
    structure: effect.droneHp,
    maxStructure: effect.droneHp,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
    mass: 1,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: SIM.droneRadius,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    orders: defaultOrders,
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    // Phantoms carry no AI of their own; leave the live decisions unset.
    ...defaultAiDecisions(),
    target: undefined,
    alive: true,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    phantom: {
      kind: "drone",
      ownerId: owner.instanceId,
      ticksLeft: lifetime,
      damage: effect.droneDamage,
      range: effect.droneRange,
      speed: effect.droneSpeed,
    },
  };
}

/** A fresh decoy SimShip: a static, targetable hit-point pool that expires. */
export function makeDecoy(
  id: string,
  owner: SimShip,
  effect: DecoyEffect,
  offset: { dx: number; dy: number },
): SimShip {
  return {
    instanceId: id,
    faction: owner.faction,
    side: owner.side,
    classification: "fighter",
    x: owner.x + offset.dx,
    y: owner.y + offset.dy,
    facing: owner.facing,
    velX: 0,
    velY: 0,
    // A decoy is static (it never moves), so its momentum is identically zero.
    px: 0,
    py: 0,
    angVel: 0,
    dilationFactor: 1,
    structure: effect.decoyHp,
    maxStructure: effect.decoyHp,
    shield: 0,
    maxShield: 0,
    shieldRechargeRate: 0,
    shieldRechargeDelay: 0,
    shieldRegenCountdown: 0,
    shieldAdaptiveRamp: 0,
    shieldUntouchedTicks: 0,
    auraRangeBonus: 0,
    auraAccuracyBonus: 0,
    armourReduction: 0,
    thrust: 0,
    turnRate: 0,
    mass: 1,
    comX: 0,
    comY: 0,
    momentOfInertia: 1,
    radius: SIM.decoyRadius,
    cost: 0,
    weapons: [],
    weaponCooldowns: [],
    orders: defaultOrders,
    crewPriority: "combat",
    shipStance: "balanced",
    rules: [],
    // Phantoms carry no AI of their own; leave the live decisions unset.
    ...defaultAiDecisions(),
    target: undefined,
    alive: true,
    ghosts: [],
    awareness: new Map(),
    lastFiredTick: Number.NEGATIVE_INFINITY,
    phantom: {
      kind: "decoy",
      ownerId: owner.instanceId,
      ticksLeft: effect.duration,
      damage: 0,
      range: 0,
      speed: 0,
    },
  };
}

/**
 * Top up a ship's drones from every ready, operational hangar module. A hangar
 * maintains up to `droneCount` live drones; every `launchCooldown` it launches
 * one replacement if the wing is below strength. Opt-in: a ship with no hangar
 * launches nothing, so a battle without hangars grows no phantoms.
 */
export function launchDrones(
  owner: SimShip,
  ships: SimShip[],
  tick: number,
  nextPhantomId: (ownerId: string, kind: string, tick: number) => string,
): void {
  if (owner.modules === undefined || !owner.alive) return;
  for (const m of owner.modules) {
    if (m.effect.kind !== "hangar") continue;
    if (m.techCooldown > 0 || !isOperational(m)) continue;
    const effect = m.effect;
    const live = ships.filter(
      (s) =>
        s.alive &&
        s.phantom?.kind === "drone" &&
        s.phantom.ownerId === owner.instanceId,
    ).length;
    if (live >= effect.droneCount) continue; // wing at strength
    ships.push(makeDrone(nextPhantomId(owner.instanceId, "drone", tick), owner, effect));
    m.techCooldown = effect.launchCooldown;
  }
}

/**
 * Launch a decoy module's full salvo of false contacts in a deterministic ring
 * around the ship, then put the launcher on cooldown. Opt-in: no decoy module,
 * no phantoms.
 */
export function launchDecoys(
  owner: SimShip,
  ships: SimShip[],
  tick: number,
  nextPhantomId: (ownerId: string, kind: string, tick: number) => string,
): void {
  if (owner.modules === undefined || !owner.alive) return;
  for (const m of owner.modules) {
    if (m.effect.kind !== "decoy") continue;
    if (m.techCooldown > 0 || !isOperational(m)) continue;
    const effect = m.effect;
    for (let i = 0; i < effect.decoyCount; i += 1) {
      const angle = (i / effect.decoyCount) * Math.PI * 2;
      const r = SIM.decoyRadius * 2;
      ships.push(
        makeDecoy(
          nextPhantomId(owner.instanceId, "decoy", tick),
          owner,
          effect,
          { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r },
        ),
      );
    }
    m.techCooldown = effect.cooldown;
  }
}

/**
 * Advance every phantom one tick in place. Drones home on the nearest real
 * enemy and strike it for their per-tick damage when in range (via the normal
 * `applyDamage`, so shields/armour apply); decoys merely count down. A phantom
 * whose `ticksLeft` expires (or whose structure was already depleted by enemy
 * fire) is marked `alive = false` in place — exactly how a dead real ship is
 * handled — so every existing `.alive` filter then excludes it from targeting,
 * focus and victory without a separate prune pass. Deterministic: phantoms
 * iterate in array (creation) order; the nearest enemy is chosen by squared
 * distance with ship array order as the tie-break; no rng.
 */
export function stepPhantoms(ships: readonly SimShip[]): void {
  for (const s of ships) {
    if (s.phantom === undefined || !s.alive) continue;
    const ph = s.phantom;
    ph.ticksLeft -= 1;
    if (ph.ticksLeft <= 0) {
      s.alive = false;
      continue;
    }
    if (ph.kind === "drone") {
      // Home on the nearest real enemy and strike if in range.
      let nearest: SimShip | undefined;
      let nearestSq = Number.POSITIVE_INFINITY;
      for (const e of ships) {
        if (!e.alive || e.side === s.side || e.phantom !== undefined) continue;
        const dx = e.x - s.x;
        const dy = e.y - s.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < nearestSq) {
          nearest = e;
          nearestSq = dSq;
        }
      }
      if (nearest !== undefined) {
        const dx = nearest.x - s.x;
        const dy = nearest.y - s.y;
        const dist = Math.hypot(dx, dy);
        s.facing = dist > 0 ? Math.atan2(dy, dx) : s.facing;
        const step = Math.min(ph.speed, dist);
        s.x += (dx / (dist || 1)) * step;
        s.y += (dy / (dist || 1)) * step;
        if (dist <= ph.range) {
          applyDamage(nearest, ph.damage, 0, 0, s.x, s.y);
        }
      }
    }
  }
}
