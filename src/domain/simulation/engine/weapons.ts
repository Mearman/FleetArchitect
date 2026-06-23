/**
 * Weapon firing and projectile lifecycle: spawn, fire, point-defence
 * intercept, penetration path, and the per-tick projectile update.
 */

import { CELL_SIZE } from "@/domain/grid";
import { ranged } from "@/domain/simulation/rng";
import type { Rng } from "@/domain/simulation/rng";
import { cellWorldPosition } from "@/domain/simulation/spatial-hash";
import type { BattleAnomaly, BattleSide } from "@/schema/battle";
import type { PointDefenseEffect, WeaponEffect } from "@/schema/module";
import type { BattleInputs } from "../types";

import { CELL_CONTACT_DISTANCE, buildShipCellHash } from "./collision";
import { SIM, claimProjectileId } from "./config";
import { beamDamageFactor, lensingDeflection } from "./optics";
import { isCharged } from "./crew";
import { applyDamage } from "./damage";
import { outerWorldLoop, rayPolygonEntry } from "./poly-collision";
import { isRetreating } from "./movement";
import { hasAliveCommand } from "./physics";
import { angleDifference, slewTurret, steer } from "./setup";
import { attackerEccmRestore, isDetectable, netTrackingReduction, targetEcm } from "./stealth";
import type { SimModule, SimProjectile, SimShip } from "./types";

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
  const aimAngle = Math.atan2(target.y - owner.y, target.x - owner.x);
  // The weapon's mount direction (ship-local) is added to the ship's world
  // heading so a side-mounted weapon fires sideways regardless of where the
  // ship is pointed. `aimAngle` keeps the projectile on-target (homing will
  // take over from there if `tracking > 0`); the spread still perturbs the
  // aim — a side-mounted weapon is just as accurate as a forward one,
  // measured against its own muzzle direction.
  const mountAngle = owner.facing + weaponFacing;
  // Command-aura accuracy tightens the spread cone by its fraction (0 leaves it
  // untouched). The rng is still drawn whenever the weapon has any spread — same
  // stream length regardless of the buff — only the bound it scales by narrows, so
  // determinism holds and an unbuffed shot is byte-identical.
  const aimedSpread = weapon.spread * (1 - accuracyBonus);
  const spread = weapon.spread > 0 ? ranged(rng, -aimedSpread, aimedSpread) : 0;
  const angle = aimAngle + spread;
  const muzzleX = owner.x + Math.cos(mountAngle) * SIM.muzzleOffset;
  const muzzleY = owner.y + Math.sin(mountAngle) * SIM.muzzleOffset;
  const ttl = Math.ceil((weapon.range + 40) / Math.max(weapon.projectileSpeed, 1));
  const vx = Math.cos(angle) * weapon.projectileSpeed;
  const vy = Math.sin(angle) * weapon.projectileSpeed;
  // Recoil: the firing ship absorbs the projectile's momentum in equal and
  // opposite measure. delta_v_ship = -m_p * v_p / M_ship; the angular kick
  // is the lever arm (muzzle − CoM) cross the projectile's linear momentum,
  // divided by the ship's moment of inertia. Applied before the projectile
  // enters the world so the first tick of travel already reflects the
  // ship's post-recoil velocity.
  applyImpulse(owner, -SIM.projectileMass * vx, -SIM.projectileMass * vy, muzzleLocalX, muzzleLocalY);
  return {
    id: claimProjectileId(),
    x: muzzleX,
    y: muzzleY,
    vx,
    vy,
    kind: weapon.weaponType,
    mass: SIM.projectileMass,
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
    armourPiercing: weapon.armourPiercing,
    range: weapon.range,
    travelled: 0,
    ttl,
    ownerId: owner.instanceId,
    ownerSide: owner.side,
    targetId: target.instanceId,
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
  anomaly: BattleAnomaly,
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
        fireOne(ship, weapon, m.turretAngle, m.x, m.y, target, rng, fired, ship.auraAccuracyBonus, anomaly);
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
      fireOne(ship, weapon, weapon.facing ?? 0, 0, 0, target, rng, fired, ship.auraAccuracyBonus, anomaly);
    }
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
  anomaly: BattleAnomaly,
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
    if (anomaly === "blackHole" && range > 0) {
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
    applyDamage(target, damage, weapon.shieldPiercing, weapon.armourPiercing, ix, iy, strikeAngle);
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
  for (const m of ship.modules) {
    if (!m.alive) continue;
    const { wx, wy } = cellWorldPosition(ship.x, ship.y, ship.facing, m.x, m.y);
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
  anomaly: BattleInputs["anomaly"],
  rng: Rng,
): SimProjectile[] {
  const survivors: SimProjectile[] = [];
  const trackingFactor = anomaly === "nebula" ? SIM.nebulaTrackingFactor : 1;
  // Broad-phase over every alive ship's cells in world space. Projectile hits
  // query this for the frontmost occupied cell on the path instead of scanning
  // every ship. Built once per tick from the post-movement, post-collision
  // positions so a projectile strikes a cell where it actually is.
  const cellHash = buildShipCellHash([...byId.values()]);

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

    // Homing: steer velocity toward the (living) target's current position.
    if (p.tracking > 0) {
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
    if (anomaly === "blackHole") {
      const pDist = Math.hypot(p.x, p.y);
      if (pDist > 0) {
        const pEffectiveR = Math.max(pDist, SIM.blackHoleLethalRadius);
        const pAccelMag = SIM.blackHoleStrength / (pEffectiveR * pEffectiveR);
        p.vx += (-p.x / pDist) * pAccelMag;
        p.vy += (-p.y / pDist) * pAccelMag;
      }
    }

    p.x += p.vx;
    p.y += p.vy;
    p.travelled += Math.hypot(p.vx, p.vy);
    p.ttl -= 1;

    if (p.travelled > p.range || p.ttl <= 0) continue;

    // Asteroid fields randomly destroy in-flight ordnance.
    if (anomaly === "asteroidField" && rng() < SIM.asteroidDeflectChance) continue;

    // Collision with an enemy ship. For modular ships the broad-phase finds
    // the frontmost occupied cell on the projectile's path and the hit strikes
    // THAT cell, with armour-piercing overflow carrying to the cell behind.
    // Legacy aggregated ships have no cells in the hash, so they keep the
    // centre-distance test against their radius.
    const enemySide = p.ownerSide === "attacker" ? "defender" : "attacker";
    const speed = Math.hypot(p.vx, p.vy);
    const dirX = speed > 1e-9 ? p.vx / speed : 1;
    const dirY = speed > 1e-9 ? p.vy / speed : 0;

    // Modular ships: nearest enemy cell within the cell contact distance is
    // the frontmost cell struck.
    const cellHit = cellHash.nearestWithin(
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
      hit = cellHit.payload.ship;
      hitWx = cellHit.wx;
      hitWy = cellHit.wy;
      path = penetrationPath(hit, hitWx, hitWy, dirX, dirY);
    } else {
      // Legacy fallback: nearest living enemy ship without cells.
      let bestDist = Infinity;
      for (const [, ship] of byId) {
        if (!ship.alive || ship.side !== enemySide) continue;
        if (ship.modules !== undefined) continue; // modular ships use the hash
        const d = Math.hypot(ship.x - p.x, ship.y - p.y);
        if (d < ship.radius && d < bestDist) {
          bestDist = d;
          hit = ship;
        }
      }
    }

    if (hit !== undefined) {
      // The projectile's velocity gives the shot direction; that's what
      // directional shields see.
      const shotAngle = Math.atan2(p.vy, p.vx);
      applyDamage(hit, p.damage, p.shieldPiercing, p.armourPiercing, hitWx, hitWy, shotAngle, path);
      // Hit impulse: the target absorbs the projectile's remaining momentum
      // at the impact point. delta_v = +m_p * v_p / M_target; the lever arm
      // is the impact point (in ship-local) relative to the CoM. Applied
      // after damage so a kill shot still transfers momentum to the
      // (now-dead) hulk, matching conservation. The impact point's local
      // coordinates are derived by un-rotating the world hit position by
      // the target's facing.
      const c = Math.cos(-hit.facing);
      const s = Math.sin(-hit.facing);
      const localX = (hitWx - hit.x) * c - (hitWy - hit.y) * s;
      const localY = (hitWx - hit.x) * s + (hitWy - hit.y) * c;
      applyImpulse(hit, p.mass * p.vx, p.mass * p.vy, localX, localY);
      continue;
    }
    survivors.push(p);
  }
  return survivors;
}
