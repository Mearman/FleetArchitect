/**
 * Impact profiles for the unified (energy, momentum) damage model.
 *
 * Every hit carries TWO defensive currencies: pure **energy** (joules) — a beam's
 * optical deposit, a warhead's yield, a blast's overpressure — and directed
 **momentum** (kg·m/s) — a slug's m·v, a ram's reduced-mass·v. The two are
 * physically distinct: shields are an energy barrier (they absorb joules),
 * deflectors arrest momentum (they absorb kg·m/s), and a kinetic round's muzzle
 * KE is NOT carried as energy here — it is implied by `(momentum, effectiveMass)`
 * and only becomes armour work (`p²/2m = ½mv²`) if the momentum gets past the
 * deflector. That avoids double-counting and keeps each screen in its own
 * currency (no joule↔kg·m/s conversion, no magic coupling constant).
 *
 * These are PURE functions of SI scalars — no rng, no clock — so the damage model
 * stays byte-identical-run-to-run. They are consumed by `applyImpact` (damage.ts);
 * nothing imports this module until the call sites switch over.
 */

import { SIM, SPEED_OF_LIGHT_M_PER_S } from "./config";

/** A resolved impact's two defensive currencies, the mass that links momentum to
 *  kinetic energy at the armour layer, and the per-screen piercing fractions. */
export interface ImpactProfile {
  /** Pure (thermal / blast / warhead) energy the impact deposits, in joules —
   *  the shield's currency. A kinetic round's muzzle KE is NOT here; it is
   *  implied by `(momentumKgMps, effectiveMassKg)`. */
  readonly energyJ: number;
  /** Directed momentum the impact carries, in kg·m/s — the deflector's currency.
   *  A beam carries photon momentum E/c (≈0 for combat energies); a slug carries
   *  m·v; a ram carries reducedMass·v. */
  readonly momentumKgMps: number;
  /** Mass behind the momentum, in kg. The armour layer computes the residual
   *  momentum's kinetic energy as `p²/(2·m)`. `Infinity` for a pure-energy
   *  impact (beam, blast) so the momentum term vanishes at armour. */
  readonly effectiveMassKg: number;
  /** Fraction (0..1) of pure energy bypassing the shield's energy screen. */
  readonly shieldPiercing: number;
  /** Fraction (0..1) of momentum bypassing the deflector's momentum screen. */
  readonly deflectorPiercing: number;
  /** Fraction (0..1) bypassing armour reduction. */
  readonly armourPiercing: number;
  /** Per-impact scalar on the armour-layer damage (default 1). Collisions and
   *  debris set this to their damage fraction so the model reduces to today's
   *  maths byte-for-byte when no deflector is present. */
  readonly armourScale: number;
}

/** Photon momentum per joule: p = E/c. A combat-scale beam pulse (hundreds of MJ)
 *  carries ~1 kg·m/s — negligible next to a slug's tens of thousands. */
const PHOTON_MOMENTUM_PER_JOULE = 1 / SPEED_OF_LIGHT_M_PER_S;

/** A hitscan beam: pure energy plus its (negligible) photon momentum. Shields
 *  absorb the energy; deflectors see ~0 momentum, so beams ignore them. */
export function beamImpactProfile(opts: {
  damageJ: number;
  shieldPiercing: number;
  armourPiercing: number;
  deflectorPiercing?: number;
}): ImpactProfile {
  return {
    energyJ: opts.damageJ,
    momentumKgMps: opts.damageJ * PHOTON_MOMENTUM_PER_JOULE,
    effectiveMassKg: Infinity,
    shieldPiercing: opts.shieldPiercing,
    deflectorPiercing: opts.deflectorPiercing ?? 0,
    armourPiercing: opts.armourPiercing,
    armourScale: 1,
  };
}

/** A kinetic slug (cannon / railgun / mass driver): pure momentum. Its muzzle KE
 *  is implied by `(momentum, effectiveMassKg)` and reaches armour as `p²/2m =
 *  ½mv²` only if the momentum penetrates the deflector — so a kinetic round
 *  ignores the shield entirely (energyJ = 0). */
export function kineticImpactProfile(opts: {
  massKg: number;
  speedMps: number;
  shieldPiercing: number;
  armourPiercing: number;
  deflectorPiercing?: number;
}): ImpactProfile {
  return {
    energyJ: 0,
    momentumKgMps: opts.massKg * opts.speedMps,
    effectiveMassKg: opts.massKg,
    shieldPiercing: opts.shieldPiercing,
    deflectorPiercing: opts.deflectorPiercing ?? 0,
    armourPiercing: opts.armourPiercing,
    armourScale: 1,
  };
}

/** Powered ordnance (missile / torpedo / plasma bolt): warhead or thermal energy
 *  PLUS body momentum. Hits BOTH screens — the shield takes the yield, the
 *  deflector takes the body's m·v. */
export function warheadImpactProfile(opts: {
  massKg: number;
  speedMps: number;
  energyJ: number;
  shieldPiercing: number;
  armourPiercing: number;
  deflectorPiercing?: number;
}): ImpactProfile {
  return {
    energyJ: opts.energyJ,
    momentumKgMps: opts.massKg * opts.speedMps,
    effectiveMassKg: opts.massKg,
    shieldPiercing: opts.shieldPiercing,
    deflectorPiercing: opts.deflectorPiercing ?? 0,
    armourPiercing: opts.armourPiercing,
    armourScale: 1,
  };
}

/** A ship-ship ram: pure momentum over the reduced-mass pair. `armourScale` is
 *  the collision damage fraction, so with no deflector the armour takes
 *  `p²/2m × fraction = ½·reducedMass·v² × fraction` — byte-identical to today's
 *  `applyCollisionDamage` at sim speeds (v ≪ c, where the relativistic KE the
 *  engine computes equals ½mv² to full float precision). */
export function ramImpactProfile(opts: {
  reducedMassKg: number;
  relSpeedMps: number;
}): ImpactProfile {
  return {
    energyJ: 0,
    momentumKgMps: opts.reducedMassKg * opts.relSpeedMps,
    effectiveMassKg: opts.reducedMassKg,
    shieldPiercing: 0,
    deflectorPiercing: 0,
    armourPiercing: 0,
    armourScale: SIM.collisionDamageFraction,
  };
}

/** Drifting debris: pure momentum, lower armour scale (wreckage, not a weapon). */
export function debrisImpactProfile(opts: {
  massKg: number;
  relSpeedMps: number;
}): ImpactProfile {
  return {
    energyJ: 0,
    momentumKgMps: opts.massKg * opts.relSpeedMps,
    effectiveMassKg: opts.massKg,
    shieldPiercing: 0,
    deflectorPiercing: 0,
    armourPiercing: 0,
    armourScale: SIM.debrisCollisionDamageFraction,
  };
}

/** A pure-energy source — mine detonation, drone warhead strike, external blast
 *  wave. v1 simplification: the (small) fragment / body / overpressure momentum
 *  is folded into the energy term rather than carried separately, so these are
 *  shield-absorbed and do not deplete deflectors; split the momentum out only if
 *  balance wants a deflector role for them (it would need a representative
 *  fragment/body/overpressure mass anchor). */
export function energyImpactProfile(opts: {
  energyJ: number;
  shieldPiercing: number;
  armourPiercing: number;
}): ImpactProfile {
  return {
    energyJ: opts.energyJ,
    momentumKgMps: 0,
    effectiveMassKg: Infinity,
    shieldPiercing: opts.shieldPiercing,
    deflectorPiercing: 0,
    armourPiercing: opts.armourPiercing,
    armourScale: 1,
  };
}

/** An internal blast — a volatile module cooking off INSIDE the hull. Pure
 *  energy that bypasses BOTH screens and armour (it detonates behind them). */
export function internalBlastImpactProfile(opts: { energyJ: number }): ImpactProfile {
  return {
    energyJ: opts.energyJ,
    momentumKgMps: 0,
    effectiveMassKg: Infinity,
    shieldPiercing: 1,
    deflectorPiercing: 1,
    armourPiercing: 1,
    armourScale: 1,
  };
}
