/**
 * Weapon firing and projectile lifecycle: spawn, fire, point-defence
 * intercept, penetration path, and the per-tick projectile update.
 */

import { CELL_SIZE } from "@/domain/grid";
import { ranged } from "@/domain/simulation/rng";
import type { Rng } from "@/domain/simulation/rng";
import { type SpatialHash, cellWorldPosition, cellWorldPositionCs } from "@/domain/simulation/spatial-hash";
import type { BattleAnomalyKind, BattleSide } from "@/schema/battle";
import { hasAnomaly } from "@/domain/anomaly";
import type { PointDefenseEffect, WeaponEffect } from "@/schema/module";
import type { BattleInputs } from "../types";

import { CELL_CONTACT_DISTANCE, buildShipCellHash, nearestCellAlongSegment } from "./collision";
import type { ShipCell } from "./collision";
import { SIM, GAS_DRAG_CROSS_SECTION_PROJECTILE_M2, claimProjectileId } from "./config";
import { TICKS_PER_SECOND } from "../types";
import { POWERED_SPAWN_FRACTION_OF_CRUISE } from "@/data/catalog/ordnance-motor";
import { ACCEL_PER_TICK_FROM_SI } from "../types";
import { beamDamageFactor, lensingDeflection } from "./optics";
import { isCharged } from "./crew";
import { applyImpact } from "./damage-impact";
import { DEFLECTOR_PIERCING_DEFAULT } from "@/data/catalog/combat-scale";
import {
  beamImpactProfile,
  kineticImpactProfile,
  warheadImpactProfile,
} from "./impact-profile";
import { outerWorldLoop, rayPolygonEntry } from "./poly-collision";
import { isRetreating } from "./movement";
import { hasAliveCommand } from "./physics";
import { angleDifference, slewTurret, steer } from "./setup";
import { attackerEccmRestore, isDetectable, netTrackingReduction, targetEcm } from "./stealth";
import type { SimBeam } from "./beams";
import type { SimModule, SimProjectile, SimShip } from "./types";
import type { MediumField, MediumState } from "./medium-field";
import { sampleLocalRhoKgPerM3 } from "./medium-setup";

export function spawnProjectile(
  owner: SimShip,
  weapon: WeaponEffect,
  weaponFacing: number,
  muzzleLocalX: number,
  muzzleLocalY: number,
  target: SimShip,
  rng: () => number,
  accuracyBonus: number,
): SimProjectile {
  // The weapon's mount direction (ship-local) added to the ship's world heading:
  // an off-centre weapon's muzzle sits along this direction off the centreline.
  const mountAngle = owner.facing + weaponFacing;
  // The muzzle is the firing cell's WORLD position — the gun cell on a modular
  // ship (where the round actually originates), or the ship centre on the
  // legacy aggregated path where the caller passes a (0, 0) local muzzle. A
  // half-cell clearance along the mount direction then lifts it just clear of
  // the hull. Rooted at the cell, not the ship centre, so the round leaves the
  // gun that fired it rather than appearing deep inside the hull.
  const muzzle = cellWorldPosition(owner.x, owner.y, owner.facing, muzzleLocalX, muzzleLocalY);
  const muzzleX = muzzle.wx + Math.cos(mountAngle) * SIM.muzzleOffset;
  const muzzleY = muzzle.wy + Math.sin(mountAngle) * SIM.muzzleOffset;
  // Aim from the MUZZLE (the gun cell), not the ship centre. The round leaves
  // the gun cell and must head toward the target from there; aiming from the
  // centre would fire parallel to the centre-to-target line and miss by the
  // cell's perpendicular offset (an off-centre gun firing past its target).
  const aimAngle = Math.atan2(target.y - muzzleY, target.x - muzzleX);
  // Command-aura accuracy tightens the spread cone by its fraction (0 leaves it
  // untouched). The rng is still drawn whenever the weapon has any spread — same
  // stream length regardless of the buff — only the bound it scales by narrows, so
  // determinism holds and an unbuffed shot is byte-identical.
  const aimedSpread = weapon.spread * (1 - accuracyBonus);
  const spread = weapon.spread > 0 ? ranged(rng, -aimedSpread, aimedSpread) : 0;
  const angle = aimAngle + spread;
  const ttl = Math.ceil((weapon.range + 40) / Math.max(weapon.projectileSpeed, 1));
  // Lead aim: the round's GROUND velocity is set along the aim direction (toward
  // the target), and the muzzle impulse is whatever cancels the firing ship's
  // velocity to achieve that ground track. So a moving platform's round leads —
  // it inherits the ship's momentum (and the recoil below returns it) yet
  // actually flies toward the target — instead of inheriting the ship's lateral
  // drift and missing by it. For a stationary ship this reduces to the plain
  // muzzle velocity along the aim. Solve |k·n − ship_v| = muzzle_speed for the
  // ground speed k along the aim direction n; the discriminant is non-negative
  // whenever the muzzle speed can overcome the ship's perpendicular drift (the
  // only case in which a hit is possible at all).
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const svDotN = owner.velX * nx + owner.velY * ny;
  const svPerpSq = owner.velX * owner.velX + owner.velY * owner.velY - svDotN * svDotN;
  // A powered guided round spawns at a FRACTION of its rated cruise velocity
  // (a slow launch) and accelerates to cruise over its burn. The fraction is
  // shared with the catalogue's thrust derivation
  // (POWERED_SPAWN_FRACTION_OF_CRUISE) so the motor's total impulse exactly
  // closes the spawn→cruise gap. An unpowered round (or one whose effect omits
  // `powered`) spawns at full cruise as before. Recoil uses the actual launch
  // velocity, so a slow launch kicks the firing ship less — consistent with the
  // lower muzzle momentum. The optional schema fields are resolved to concrete
  // values here (the one engine boundary) so the SimProjectile carries required
  // booleans for its per-tick motor step.
  const isPowered = weapon.powered === true;
  const isGuided = weapon.guided === true;
  const launchSpeed = isPowered
    ? weapon.projectileSpeed * POWERED_SPAWN_FRACTION_OF_CRUISE
    : weapon.projectileSpeed;
  const disc = launchSpeed * launchSpeed - svPerpSq;
  const k = svDotN + Math.sqrt(disc > 0 ? disc : 0);
  const vx = nx * k;
  const vy = ny * k;
  // Muzzle impulse relative to the firing ship — the momentum the round carries
  // away from the ship, returned to it as recoil.
  const muzzleVx = vx - owner.velX;
  const muzzleVy = vy - owner.velY;
  // Recoil: the firing ship absorbs the projectile's momentum RELATIVE to itself
  // (the muzzle impulse) in equal and opposite measure — delta_v_ship =
  // -m_p * muzzleV / M_ship — so momentum is conserved across the shot (the ship
  // loses m·muzzleV; the round departs with ground velocity k·n). The angular
  // kick is the lever arm (muzzle − CoM) cross that linear momentum, divided by
  // the ship's moment of inertia.
  applyImpulse(owner, -weapon.projectileMass * muzzleVx, -weapon.projectileMass * muzzleVy, muzzleLocalX, muzzleLocalY);
  return {
    id: claimProjectileId(),
    x: muzzleX,
    y: muzzleY,
    vx,
    vy,
    kind: weapon.weaponType,
    mass: weapon.projectileMass,
    muzzleLocalX,
    muzzleLocalY,
    damage: weapon.damage,
    // Command-aura accuracy raises homing tracking by its fraction so a buffed
    // missile corrects onto its target faster; 0 leaves it at the weapon's rate.
    // ECM on the target then degrades the lock: the net reduction (target ECM
    // minus the firing ship's ECCM, floored at 0) scales the homing rate down at
    // spawn. With no ECM on the target this factor is 1, so the projectile keeps
    // its full tracking and an ECM-free battle is byte-identical.
    tracking: weapon.tracking * (1 + accuracyBonus) * (1 - netTrackingReduction(owner, target)),
    shieldPiercing: weapon.shieldPiercing,
    // Deflector piercing: the weapon's authored fraction, or 0 (the deflector
    // catches the full momentum) when unset. The per-type default is applied at
    // catalogue authoring time where a weapon should punch the deflector.
    deflectorPiercing: weapon.deflectorPiercing ?? DEFLECTOR_PIERCING_DEFAULT[weapon.weaponType],
    armourPiercing: weapon.armourPiercing,
    range: weapon.range,
    travelled: 0,
    ttl,
    ownerId: owner.instanceId,
    ownerSide: owner.side,
    targetId: target.instanceId,
    // Powered×guided taxonomy (finite-burn motors). The optional effect fields
    // are resolved to concrete values here (absent → unpowered/unguided, the
    // default for beams, cannon slugs, and plasma bolts). `burnTicks` is the
    // mutable fuel counter (decremented each burning tick); the others are
    // fixed for the projectile's life. An unpowered round carries zero thrust
    // and zero fuel so the motor step is a no-op for it.
    powered: isPowered,
    guided: isGuided,
    thrust: isPowered ? weapon.thrust ?? 0 : 0,
    burnTicks: isPowered ? weapon.burnTicks ?? 0 : 0,
  };
}

/**
 * Apply an instantaneous impulse to a ship: a linear momentum change
 * (deltaPx, deltaPy) in world coordinates, delivered at the ship-local
 * point (localX, localY) relative to the ship origin. The ship's CoM
 * absorbs the linear part (`delta_v = deltaP / M`) and the offset from
 * the CoM produces a torque (`tau = r × deltaP`) which becomes an angular
 * velocity change (`delta_omega = tau / I`). Used for both firing recoil
 * (impulse = -m_p * v_p, applied at the muzzle) and hit impulses
 * (impulse = +m_p * v_p, applied at the impact point).
 *
 * The local point is in ship-local coordinates (un-rotated design frame),
 * so the lever arm is `(localX − comX, localY − comY)` regardless of the
 * ship's world heading. The impulse itself is in world coordinates because
 * that's the frame the projectile's velocity lives in; we rotate it back
 * into the local frame only to compute the cross product for torque.
 */
export function applyImpulse(
  ship: SimShip,
  deltaPx: number,
  deltaPy: number,
  localX: number,
  localY: number,
): void {
  if (!ship.alive) return;
  const invMass = 1 / Math.max(ship.mass, 1);
  ship.velX += deltaPx * invMass;
  ship.velY += deltaPy * invMass;
  // Torque = r × F where r is measured from the CoM and F is the impulse
  // expressed in the ship's local frame. Rotate the world impulse by
  // -ship.facing to bring it into the local frame.
  const c = Math.cos(-ship.facing);
  const s = Math.sin(-ship.facing);
  const localImpulseX = deltaPx * c - deltaPy * s;
  const localImpulseY = deltaPx * s + deltaPy * c;
  const rx = localX - ship.comX;
  const ry = localY - ship.comY;
  const torque = rx * localImpulseY - ry * localImpulseX;
  if (ship.momentOfInertia > 0) {
    ship.angVel += torque / ship.momentOfInertia;
  }
}

export function fireWeapons(
  ships: readonly SimShip[],
  byId: Map<string, SimShip>,
  rng: Rng,
  tick: number,
  anomalies: readonly BattleAnomalyKind[],
  beams: SimBeam[],
): SimProjectile[] {
  const fired: SimProjectile[] = [];
  for (const ship of ships) {
    if (!ship.alive || isRetreating(ship)) continue;
    // Phantoms never fire via this loop — a drone strikes in its bespoke step.
    if (ship.phantom !== undefined) continue;
    // AI hold-fire (Phase 7 wiring): a ship whose effective AI state this tick
    // is holdFire ceases weapon fire — a holdFire rule or stance action overrides
    // the firing loop. False by default, so a ship with no rules fires as before.
    if (ship.aiHoldFire) continue;
    // Phase D fire discipline (formation-doctrine `aiFire`): GATED on the field
    // being set (every preset ship has it undefined → unchanged). `holdFire`
    // ceases fire (mirrors aiHoldFire); `whenFiredUpon` fires only if the ship
    // took damage this tick (the `aiWasFiredUpon` flag, set in applyDamage and
    // reset at the top of this weapons step — a one-tick reaction latency, since
    // damage from the enemy's shot lands after this ship's fire check); `atWill`
    // and `onlyAt` fire normally (`onlyAt` restricts to the locked target, which
    // is the single-target model's default — the enum carries no separate
    // reference, so it reduces to "fire at ship.target").
    const fire = ship.aiFire;
    if (fire === "holdFire") continue;
    if (fire === "whenFiredUpon" && !ship.aiWasFiredUpon) continue;
    const target = ship.target !== undefined ? byId.get(ship.target) : undefined;
    if (target === undefined || !target.alive) continue;

    const toTarget = Math.atan2(target.y - ship.y, target.x - ship.x);
    const facingError = Math.abs(angleDifference(ship.facing, toTarget));
    const dist = Math.hypot(target.x - ship.x, target.y - ship.y);
    // Stealth fire gate: a ship cannot fire at a target it can no longer detect.
    // Movement between the targeting step and here can carry a signature target
    // out of acquisition range or let a target re-cloak, so re-validate against
    // the post-movement positions. A non-stealth target is always detectable, so
    // this never blocks a shot for fleets carrying no stealth tech.
    if (!isDetectable(ship, target, dist * dist, tick)) continue;
    // Command-aura buffs (factions update): a covered ship reaches `rangeBonus`
    // further and bears on a target within a `accuracyBonus`-wider forward arc.
    // Both are 0 for an unbuffed ship, so the gates below are identical to before.
    const rangeScale = 1 + ship.auraRangeBonus;
    const firingArc = SIM.firingArc * (1 + ship.auraAccuracyBonus);

    // Per-module path: iterate the ship's own weapon modules, reading and
    // writing each module's cooldown and ammo (so destruction is reflected
    // live and recomputeAggregates can't clobber in-flight state). An
    // unpowered or dry weapon is inert — but its cooldown still ticks, so
    // it fires the moment the grid recovers or the magazine is restored.
    // A ship with no alive command (bridge) module cannot coordinate its
    // weapons either, so the whole path is skipped — destroying the bridge
    // disarms the ship.
    if (ship.modules !== undefined) {
      if (!hasAliveCommand(ship)) continue;
      for (const m of ship.modules) {
        if (!m.alive || m.effect.kind !== "weapon") continue;
        const weapon = m.effect;
        const isTurret = m.turretTurnRate > 0;
        // Slew the turret every tick, even while cooling or unpowered, so the
        // barrel keeps tracking and is on-target the moment it can fire again.
        // A fixed mount leaves its barrel on the mount direction.
        let turretCanBear = true;
        if (isTurret) {
          const slew = slewTurret(m, ship, target);
          m.turretAngle = slew.angle;
          turretCanBear = slew.canFire;
        }
        if (m.cooldown > 0) {
          m.cooldown -= ship.dilationFactor;
          continue;
        }
        if (!m.powered) continue; // reactor can't sustain it this tick
        if (m.powerCut) continue; // energy buffer ran dry — grid shed this gun
        if (!m.manned) continue; // nobody crewing the gun — it can't fire
        if (!isCharged(m)) continue; // local charge buffer empty — no juice
        if (dist > weapon.range * rangeScale) continue;
        // Fire gate: a turret fires when its slewed barrel bears on the target
        // (independent of where the ship is pointing); a fixed mount fires
        // only when the ship's own heading brings the target into the forward
        // firing arc (aura-widened), exactly as before turrets existed.
        if (isTurret ? !turretCanBear : facingError > firingArc) continue;
        if (m.ammo <= 0) continue; // out of ammo; no resupply yet
        // A genuine, in-range shot: spend a round and reset the cycle. Firing
        // direction and recoil use the live barrel angle (which equals the
        // mount facing on a fixed mount), not the static mount direction.
        m.ammo -= 1;
        m.cooldown = weapon.cooldown;
        // Firing drops a cloak for `decloakTicks`: record the tick so the
        // stealth gate exposes a cloaked ship while the window is open.
        ship.lastFiredTick = tick;
        fireOne(ship, weapon, m.turretAngle, m.x, m.y, target, rng, fired, ship.auraAccuracyBonus, anomalies, beams);
      }
      continue;
    }

    // Legacy aggregated path.
    for (let i = 0; i < ship.weapons.length; i++) {
      const weapon = ship.weapons[i];
      if (weapon === undefined) continue;
      const cooldown = ship.weaponCooldowns[i];
      if (cooldown === undefined) continue;
      if (cooldown > 0) {
        ship.weaponCooldowns[i] = cooldown - ship.dilationFactor;
        continue;
      }
      if (dist > weapon.range * rangeScale) continue;
      if (facingError > firingArc) continue;

      ship.weaponCooldowns[i] = weapon.cooldown;
      // Firing drops a cloak for `decloakTicks` (see the per-module path above).
      ship.lastFiredTick = tick;
      // Legacy aggregated path reads facing off the weapon effect (default 0).
      // No per-module muzzle position, so the recoil lever arm is the ship's
      // origin (0, 0) — the legacy CoM.
      fireOne(ship, weapon, weapon.facing ?? 0, 0, 0, target, rng, fired, ship.auraAccuracyBonus, anomalies, beams);
    }
  }
  // Phase D: reset the per-tick "was fired upon" flag AFTER every ship has made
  // its fire decision this tick. The flag was set by applyDamage during this
  // tick's collision step (2b) and the prior tick's projectile-resolution step
  // (4), so a `whenFiredUpon` ship reads whether it was shot since its last fire
  // decision — a one-tick reaction latency, which is the intended "fire back
  // once shot" behaviour. Resetting here (not in stepAi) keeps the signal alive
  // across the damage→fire boundary; resetting after the loop means every ship
  // reads the same flag state. Inert for ships without the `whenFiredUpon`
  // discipline.
  for (const ship of ships) {
    ship.aiWasFiredUpon = false;
  }
  return fired;
}

/** Fire a single weapon: hitscan applies damage immediately at a synthesised
 *  impact point on the target's facing edge; otherwise spawn a projectile.
 *  `weaponFacing` is the weapon's mount direction (radians, ship-local); the
 *  ship adds it to its own heading to figure out the muzzle position.
 *  `muzzleLocalX/Y` is the weapon's position in ship-local coordinates —
 *  the lever arm against the ship's CoM for firing recoil. On the legacy
 *  aggregated path it defaults to (0, 0) (the ship's origin), matching the
 *  pre-rigid-body behaviour where every weapon sat at the pivot. */
export function fireOne(
  ship: SimShip,
  weapon: WeaponEffect,
  weaponFacing: number,
  muzzleLocalX: number,
  muzzleLocalY: number,
  target: SimShip,
  rng: () => number,
  fired: SimProjectile[],
  accuracyBonus: number,
  anomalies: readonly BattleAnomalyKind[],
  beams: SimBeam[],
): void {
  if (weapon.projectileSpeed <= 0) {
    // Hitscan: the beam strikes the target's edge nearest the shooter.
    // The shot angle (used by directional shields) is the shooter's bearing
    // relative to the target, i.e. the direction the energy is travelling.
    // A hitscan beam already strikes whatever it is fired at, so the accuracy
    // buff adds nothing here — its benefit is the wider firing arc upstream.
    const angle = Math.atan2(target.y - ship.y, target.x - ship.x);
    const range = Math.hypot(target.x - ship.x, target.y - ship.y);
    // Beam divergence (Phase 10): a Gaussian beam's spot grows with range, so a
    // directed-energy shot lands softer the further it travels. Scale the damage
    // by the closed-form intensity falloff at the firing range. At point-blank
    // this factor is 1, so a short-range beam is unchanged.
    const damage = weapon.damage * beamDamageFactor(range);
    // Gravitational lensing (Phase 10): near a black hole at the arena origin the
    // beam path bends by the Einstein deflection 4·GM/(c²·b), where b is the
    // impact parameter — the perpendicular distance from the hole to the shot
    // line. The deflection rotates the apparent strike point about the firing
    // ship by that angle (sign set so the beam bends TOWARD the hole), so a shot
    // grazing the well lands off the target's near edge rather than dead-centre.
    // With no black hole the deflection is zero and the strike is unchanged.
    let strikeAngle = angle;
    if (hasAnomaly(anomalies, "blackHole") && range > 0) {
      // Impact parameter: perpendicular distance from the origin (the hole) to
      // the line from the firing ship through the target. |r_ship × dir|, with
      // dir the unit firing direction.
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const impactParameter = Math.abs(ship.x * dirY - ship.y * dirX);
      const deflection = lensingDeflection(impactParameter, SIM.blackHoleStrength);
      // Bend toward the hole: the sign of the cross product of the firing
      // direction with the ship→hole vector picks which way the ray curves.
      const toHoleCross = dirX * -ship.y - dirY * -ship.x;
      strikeAngle = angle + (toHoleCross >= 0 ? deflection : -deflection);
    }
    // Outline entry: trace the beam ray from the shooter into the target's
    // world-space hull outline (the chamfered armour shell) and strike the
    // point where it first crosses the boundary. The entry point feeds
    // applyDamage, whose nearest-alive-cell routing then lands the hit on the
    // cell behind that face — so a beam hits the armour surface it actually
    // crosses, not a synthesised point on the bounding circle. A beam whose
    // line of fire grazes past the hull (enters no edge) misses and deals no
    // damage. A target with no outline (a bare-substrate hull, or a legacy
    // aggregated ship) has no polygon to trace, so we fall back to the
    // bounding-circle edge point exactly as before.
    const dirX = Math.cos(strikeAngle);
    const dirY = Math.sin(strikeAngle);
    const outline = outerWorldLoop(target);
    let ix: number;
    let iy: number;
    if (outline !== undefined) {
      const entry = rayPolygonEntry(ship.x, ship.y, dirX, dirY, outline);
      if (entry === null) return; // the beam's line of fire misses the hull
      ix = entry.x;
      iy = entry.y;
    } else {
      ix = target.x + dirX * target.radius;
      iy = target.y + dirY * target.radius;
    }
    applyImpact(target, beamImpactProfile({ damageJ: damage, shieldPiercing: weapon.shieldPiercing, armourPiercing: weapon.armourPiercing, deflectorPiercing: weapon.deflectorPiercing ?? DEFLECTOR_PIERCING_DEFAULT.beam }), ix, iy, strikeAngle);
    // Emit a visible beam event so the renderer can draw the line. The source is
    // the firing gun cell's WORLD position (rotated by the ship's heading), not
    // the ship centre: a beam leaves the gun that fired it, so an off-centre
    // turret's beam originates at the turret, not deep inside the hull. The
    // target is the strike point on the target's hull. Damage is applied once
    // above; this record is pure render state, carried for a few ticks while the
    // line fades.
    const source = cellWorldPosition(ship.x, ship.y, ship.facing, muzzleLocalX, muzzleLocalY);
    beams.push({
      sourceId: ship.instanceId,
      sourceX: source.wx,
      sourceY: source.wy,
      targetX: ix,
      targetY: iy,
      kind: weapon.weaponType,
      emissionTicks: SIM.beamEmissionTicks,
    });
  } else {
    fired.push(
      spawnProjectile(ship, weapon, weaponFacing, muzzleLocalX, muzzleLocalY, target, rng, accuracyBonus),
    );
  }
}

/**
 * Roll for a point-defence intercept. Returns true if the projectile was
 * shot down. PD modules on ships on the opposing side that are alive,
 * powered, not on cooldown, and within range of the projectile each get an
 * independent hit roll; the per-module chance stacks as
 * 1 - (1 - p)^n, capped at SIM.pdMaxStackedChance.
 *
 * Only ships with the per-module path (`ship.modules` defined) carry PD.
 * The legacy aggregated path is unaffected. PD requires the defending
 * ship to have an alive command module — coordination matters, same rule
 * as offensive weapons.
 */
export function tryPointDefenseIntercept(
  p: SimProjectile,
  byId: Map<string, SimShip>,
  rng: () => number,
): boolean {
  const enemySide: BattleSide = p.ownerSide === "attacker" ? "defender" : "attacker";
  // Walk every alive defending ship; count how many in-range, online PD
  // modules can fire this tick. A single rng draw resolves the stacked
  // chance — keeps the random stream the same length regardless of how
  // many PD modules are present, so a destroyer with two PDs and a cruiser
  // with one see the same determinism behaviour modulo the count.
  let pdCount = 0;
  for (const [, ship] of byId) {
    if (!ship.alive || ship.side !== enemySide) continue;
    if (ship.modules === undefined) continue; // legacy ships don't run PD
    if (!hasAliveCommand(ship)) continue; // no bridge → no coordination
    for (const m of ship.modules) {
      if (!m.alive || !m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
      if (m.cooldown > 0) continue;
      if (m.effect.kind !== "pointDefense") continue;
      const effect: PointDefenseEffect = m.effect;
      const dx = ship.x - p.x;
      const dy = ship.y - p.y;
      if (Math.hypot(dx, dy) <= effect.range) pdCount += 1;
    }
  }
  if (pdCount === 0) return false;
  const perModule = SIM.pdHitChancePerModule;
  const stacked = 1 - Math.pow(1 - perModule, pdCount);
  const capped = Math.min(stacked, SIM.pdMaxStackedChance);
  // Consume one cycle on every contributing module regardless of outcome —
  // a PD battery firing into the sky should still pay its cooldown, so
  // salvos are spaced out across ticks rather than back-to-back.
  for (const [, ship] of byId) {
    if (!ship.alive || ship.side !== enemySide) continue;
    if (ship.modules === undefined) continue;
    if (!hasAliveCommand(ship)) continue;
    for (const m of ship.modules) {
      if (!m.alive || !m.powered || m.powerCut || !m.manned || !isCharged(m)) continue;
      if (m.effect.kind !== "pointDefense") continue;
      if (m.cooldown > 0) continue;
      const dx = ship.x - p.x;
      const dy = ship.y - p.y;
      if (Math.hypot(dx, dy) > m.effect.range) continue;
      m.cooldown = m.effect.cooldown;
    }
  }
  return rng() < capped;
}

/**
 * Penetration path for a projectile-vs-cell hit: the alive cells of the struck
 * ship that lie on the projectile's line, ordered front to back along its
 * travel direction. The frontmost cell is the one the broad-phase found; cells
 * behind it (further along `(vx, vy)`) and within half a cell of the line of
 * fire follow, so armour-piercing overflow carries straight through the hull
 * rather than scattering to whichever module happens to be nearest. The
 * direction must be a unit vector.
 */
export function penetrationPath(
  ship: SimShip,
  hitWx: number,
  hitWy: number,
  dirX: number,
  dirY: number,
): SimModule[] {
  if (ship.modules === undefined) return [];
  // Projection of the hit point along the travel direction; the path is every
  // cell at or beyond it, within half a cell laterally.
  const hitAlong = hitWx * dirX + hitWy * dirY;
  const onLine: { module: SimModule; along: number }[] = [];
  // cos/sin of the ship's facing are invariant across its cells.
  const cosF = Math.cos(ship.facing);
  const sinF = Math.sin(ship.facing);
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const { wx, wy } = cellWorldPositionCs(ship.x, ship.y, cosF, sinF, m.x, m.y);
    const along = wx * dirX + wy * dirY;
    if (along < hitAlong - CELL_SIZE / 2) continue; // in front of the entry cell
    const perp = Math.abs((wx - hitWx) * -dirY + (wy - hitWy) * dirX);
    if (perp > CELL_SIZE / 2) continue; // off the line of fire
    onLine.push({ module: m, along });
  }
  onLine.sort((l, r) => l.along - r.along);
  return onLine.map((e) => e.module);
}

export function updateProjectiles(
  projectiles: readonly SimProjectile[],
  byId: Map<string, SimShip>,
  anomalies: BattleInputs["anomalies"],
  rng: Rng,
  medium?: { field: MediumField; state: MediumState },
  /** Reusable cell-hash scratch (`state.shipCellHashScratch`) — cleared and
   *  refilled by `buildShipCellHash`. When omitted a fresh hash is allocated. */
  cellHashScratch?: SpatialHash<ShipCell>,
): SimProjectile[] {
  const survivors: SimProjectile[] = [];
  if (projectiles.length === 0) return survivors;
  const trackingFactor = hasAnomaly(anomalies, "nebula") ? SIM.nebulaTrackingFactor : 1;
  // Broad-phase over every alive ship's cells in world space. Projectile hits
  // query this for the frontmost occupied cell on the path instead of scanning
  // every ship. Built once per tick from the post-movement, post-collision
  // positions so a projectile strikes a cell where it actually is.
  const cellHash = buildShipCellHash([...byId.values()], cellHashScratch);

  for (const p of projectiles) {
    // Point-defence intercept: PD modules on the opposing side get a chance
    // to shoot down the projectile before it moves on this tick. Only
    // missiles and torpedoes are PD-able; beams and plasma travel too fast
    // to intercept. Multiple PD modules within range stack their per-tick
    // hit chance (1 - (1-p)^n) up to `pdMaxStackedChance`. An unpowered,
    // cooling, or destroyed PD module contributes nothing. PD requires the
    // defending ship to have an alive command module — coordination matters.
    if (p.kind === "missile" || p.kind === "torpedo") {
      if (tryPointDefenseIntercept(p, byId, rng)) continue;
    }

    // Finite-burn motor: a powered projectile with fuel remaining accelerates
    // along its current velocity heading by `thrust` (SI m·s⁻² scaled to
    // per-tick² via ACCEL_PER_TICK_FROM_SI, exactly like ship thrust), then
    // burns one tick of fuel. After burnout (`burnTicks` reaches 0) it coasts
    // ballistically. The acceleration is along the heading (the unit velocity
    // vector) so a guided round that has just steered accelerates in its new
    // direction; an unguided powered round holds a straight boost. Applied
    // BEFORE homing so the steer (for a guided round) acts on the boosted
    // velocity, and before drag so the plume's drag and the motor's thrust
    // settle in the same tick. A round whose velocity is zero (rare: brought
    // to a halt by drag) falls back to accelerating along +x so the motor is
    // never a no-op on a round with fuel.
    if (p.powered && p.burnTicks > 0) {
      const speed = Math.hypot(p.vx, p.vy);
      const dvPerTick = p.thrust * ACCEL_PER_TICK_FROM_SI;
      if (speed > 1e-9) {
        p.vx += (p.vx / speed) * dvPerTick;
        p.vy += (p.vy / speed) * dvPerTick;
      } else {
        p.vx += dvPerTick;
      }
      p.burnTicks -= 1;
    }

    // Homing: a guided projectile steers its velocity toward the (living)
    // target's current position (the existing `steer` path, preserving speed
    // magnitude). An unguided projectile holds its heading. The `guided` flag
    // formalises the old ad-hoc `tracking > 0` path; a guided round with
    // tracking 0 still homes but never corrects (steer rate 0 → holds heading),
    // so the two flags compose cleanly.
    if (p.guided && p.tracking > 0) {
      const target = byId.get(p.targetId);
      if (target !== undefined && target.alive) {
        // ECM lock-break: a guided round homing onto a ship with operational ECM
        // rolls each tick to lose its lock. The chance is the target's
        // `lockBreakChance` scaled by (1 - the firing ship's ECCM restore), so a
        // well-defended attacker breaks lock less often. The rng is drawn exactly
        // once per guided projectile per tick that is targeting an ECM ship — in
        // projectile array (creation) order — so the stream stays the same length
        // regardless of the roll's outcome. A target with no operational ECM
        // never reaches this draw, so an ECM-free battle is byte-identical.
        const ecm = targetEcm(target);
        if (ecm !== undefined) {
          const owner = byId.get(p.ownerId);
          const restore = owner !== undefined ? attackerEccmRestore(owner) : 0;
          const breakChance = ecm.lockBreakChance * (1 - restore);
          if (rng() < breakChance) p.tracking = 0;
        }
      }
      // Re-read after a possible lock-break: a round that just went ballistic
      // (tracking now 0) holds its heading this tick instead of steering.
      if (p.tracking > 0 && target !== undefined && target.alive) {
        const speed = Math.hypot(p.vx, p.vy);
        const desired = Math.atan2(target.y - p.y, target.x - p.x);
        const current = Math.atan2(p.vy, p.vx);
        const steered = steer(current, desired, p.tracking * trackingFactor);
        p.vx = Math.cos(steered) * speed;
        p.vy = Math.sin(steered) * speed;
      }
    }

    // Black-hole gravity bends projectiles too. The same 1/r^2
    // acceleration applied to the projectile's velocity; a fast
    // projectile traverses the strong-field region in fewer ticks and
    // so accumulates less deflection — the "mass" of a projectile
    // (its speed) is what determines how much it bends.
    if (hasAnomaly(anomalies, "blackHole")) {
      const pDist = Math.hypot(p.x, p.y);
      if (pDist > 0) {
        const pEffectiveR = Math.max(pDist, SIM.blackHoleLethalRadius);
        const pAccelMag = SIM.blackHoleStrength / (pEffectiveR * pEffectiveR);
        p.vx += (-p.x / pDist) * pAccelMag;
        p.vy += (-p.y / pDist) * pAccelMag;
      }
    }

    // Gas drag: decelerate in the local medium density. Quadratic drag
    // `F = −C_d · ρ · |v| · v` applied as a velocity decrement before position
    // integration, so a round traverses less ground through dense gas. At ISM
    // density the decrement is below float64 epsilon and the term is numerically
    // zero; in dense plume/nebula gas it measurably slows the round. Only applied
    // when a medium field is present (always true once wired in) and ρ > 0.
    // Sample density AHEAD of the round (one cell along its velocity): drag is
    // resistance from the medium the round flies INTO, and sampling ahead avoids
    // a self-drag feedback where the round's own exhaust/wake deposit would brake
    // it. A near-stationary round samples its current cell.
    const aheadSpeedP = Math.hypot(p.vx, p.vy);
    const aheadP = (medium !== undefined && aheadSpeedP > 1e-6) ? medium.field.config.pitchM / aheadSpeedP : 0;
    const rhoHere = medium !== undefined ? sampleLocalRhoKgPerM3(medium, p.x + p.vx * aheadP, p.y + p.vy * aheadP) : 0;
    if (rhoHere > 0) {
      const speedTick = aheadSpeedP;
      if (speedTick > 0) {
        const speedMs = speedTick * TICKS_PER_SECOND;
        const dvTick =
          GAS_DRAG_CROSS_SECTION_PROJECTILE_M2 * rhoHere * speedMs * speedMs /
          (Math.max(p.mass, 1e-6) * TICKS_PER_SECOND * TICKS_PER_SECOND);
        if (dvTick >= speedTick) {
          p.vx = 0;
          p.vy = 0;
        } else {
          const f = 1 - dvTick / speedTick;
          p.vx *= f;
          p.vy *= f;
        }
      }
    }

    // Capture the pre-move position: the projectile's per-tick travel is the
    // segment (prevX, prevY) → (p.x, p.y), used for the swept collision below.
    const prevX = p.x;
    const prevY = p.y;
    p.x += p.vx;
    p.y += p.vy;
    p.travelled += Math.hypot(p.vx, p.vy);
    p.ttl -= 1;

    if (p.travelled > p.range || p.ttl <= 0) continue;

    // Asteroid fields randomly destroy in-flight ordnance.
    if (hasAnomaly(anomalies, "asteroidField") && rng() < SIM.asteroidDeflectChance) continue;

    // Collision with an enemy ship. The projectile's per-tick travel is a line
    // segment; the swept test finds the frontmost occupied cell that segment
    // passes within the cell contact distance of, so a fast round (which may
    // inherit a high firing velocity) cannot tunnel through a target — it
    // strikes the first cell its path crosses. Armour-piercing overflow then
    // carries to the cell behind. Legacy aggregated ships have no cells in the
    // hash, so they keep a swept centre-distance test against their radius.
    const enemySide = p.ownerSide === "attacker" ? "defender" : "attacker";
    const speed = Math.hypot(p.vx, p.vy);
    const dirX = speed > 1e-9 ? p.vx / speed : 1;
    const dirY = speed > 1e-9 ? p.vy / speed : 0;

    // Modular ships: the frontmost enemy cell the swept segment passes within
    // the cell contact distance of is the entry cell struck.
    const cellHit = nearestCellAlongSegment(
      cellHash,
      prevX,
      prevY,
      p.x,
      p.y,
      CELL_CONTACT_DISTANCE,
      (c) => c.ship.alive && c.ship.side === enemySide,
    );

    let hit: SimShip | undefined;
    let hitWx = p.x;
    let hitWy = p.y;
    let path: readonly SimModule[] | undefined;
    if (cellHit !== undefined) {
      hit = cellHit.ship;
      hitWx = cellHit.wx;
      hitWy = cellHit.wy;
      path = penetrationPath(hit, hitWx, hitWy, dirX, dirY);
    } else {
      // Legacy fallback: a living enemy without cells whose body the swept
      // segment passes within its radius (swept so a fast round cannot tunnel).
      const segDx = p.x - prevX;
      const segDy = p.y - prevY;
      const segLenSq = segDx * segDx + segDy * segDy;
      let bestDistSq = Infinity;
      for (const [, ship] of byId) {
        if (!ship.alive || ship.side !== enemySide) continue;
        if (ship.modules !== undefined) continue; // modular ships use the hash
        let t = segLenSq > 0 ? ((ship.x - prevX) * segDx + (ship.y - prevY) * segDy) / segLenSq : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const cx = prevX + t * segDx;
        const cy = prevY + t * segDy;
        const dSq = (ship.x - cx) * (ship.x - cx) + (ship.y - cy) * (ship.y - cy);
        if (dSq < ship.radius * ship.radius && dSq < bestDistSq) {
          bestDistSq = dSq;
          hit = ship;
        }
      }
    }

    if (hit !== undefined) {
      // The projectile's velocity gives the shot direction; that's what
      // directional shields see.
      const shotAngle = Math.atan2(p.vy, p.vx);
      // Unified (E,p) impact: cannons are pure momentum (energyJ 0, so they
      // bypass the shield and hit the deflector); powered ordnance carries its
      // warhead yield as energy AND body momentum. Speed is SI (m/tick × TPS) so
      // the armour term p²/2m matches the weapon's authored SI damage.
      const speedMps = Math.hypot(p.vx, p.vy) * TICKS_PER_SECOND;
      const profile = p.kind === "cannon"
        ? kineticImpactProfile({ massKg: p.mass, speedMps, shieldPiercing: p.shieldPiercing, armourPiercing: p.armourPiercing, deflectorPiercing: p.deflectorPiercing })
        : warheadImpactProfile({ massKg: p.mass, speedMps, energyJ: p.damage, shieldPiercing: p.shieldPiercing, armourPiercing: p.armourPiercing, deflectorPiercing: p.deflectorPiercing });
      applyImpact(hit, profile, hitWx, hitWy, shotAngle, path);
      // Hit impulse: the target absorbs the projectile's momentum RELATIVE to
      // itself at the impact point — delta_v = +m_p * (v_p − v_target) / M_target.
      // A target moving with the projectile feels only the relative impact; the
      // shared frame velocity does no work. The lever arm is the impact point
      // (ship-local) relative to the CoM. Applied after damage so a kill shot
      // still transfers momentum to the (now-dead) hulk, matching conservation.
      // The impact point's local coordinates are derived by un-rotating the
      // world hit position by the target's facing.
      const c = Math.cos(-hit.facing);
      const s = Math.sin(-hit.facing);
      const localX = (hitWx - hit.x) * c - (hitWy - hit.y) * s;
      const localY = (hitWx - hit.x) * s + (hitWy - hit.y) * c;
      applyImpulse(hit, p.mass * (p.vx - hit.velX), p.mass * (p.vy - hit.velY), localX, localY);
      continue;
    }
    survivors.push(p);
  }
  return survivors;
}
