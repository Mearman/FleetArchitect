/**
 * The unified (energy, momentum) impact absorption entry point. Extracted from
 * damage.ts to keep that module under the 800-line lint cap. Now the sole damage
 * entry point: the legacy scalar `applyDamage` was removed once every call site
 * switched to `applyImpact` + an impact profile.
 */

import { applyModuleDamage } from "./damage";
import type { ImpactProfile } from "./impact-profile";
import type { SimModule, SimShip } from "./types";

/**
 * Apply an impact under the unified (energy, momentum) damage model. The shield
 * pool (joules) absorbs the impact's pure energy; the deflector pool (kg·m/s)
 * absorbs its directed momentum; the residual — energy 1:1 plus the KE implied
 * by the residual momentum (`p²/2·m_eff`, 0 for a pure-energy impact) — flows to
 * armour and structure exactly as applyDamage, but with the hit's energy/mass
 * composition so the passive surface coating reduces the energy fraction and the
 * reactive plate the momentum fraction.
 *
 * v1 simplification: the directional-shield module intercepts the collapsed
 * joule total (it is an energy screen, but modelling it as energy-only here is a
 * later refinement).
 */
export function applyImpact(
  ship: SimShip,
  profile: ImpactProfile,
  impactX?: number,
  impactY?: number,
  shotAngle?: number,
  path?: readonly SimModule[],
): void {
  // Layer 1 — shield (energy screen, joules). Inert when maxShield === 0.
  const eBypass = profile.energyJ * profile.shieldPiercing;
  const eToShield = profile.energyJ - eBypass;
  const eAbsorbed = Math.min(ship.shield, eToShield);
  if (profile.energyJ > 0 || profile.momentumKgMps > 0) ship.aiWasFiredUpon = true;
  ship.shield -= eAbsorbed;
  if (eAbsorbed > 0) {
    ship.shieldRegenCountdown = ship.shieldRechargeDelay;
    ship.shieldUntouchedTicks = 0;
  }
  const eResidual = eBypass + (eToShield - eAbsorbed);

  // Layer 2 — deflector (momentum screen, kg·m/s). Inert when maxDeflector === 0.
  const pBypass = profile.momentumKgMps * profile.deflectorPiercing;
  const pToDeflector = profile.momentumKgMps - pBypass;
  const pAbsorbed = Math.min(ship.deflector, pToDeflector);
  ship.deflector -= pAbsorbed;
  if (pAbsorbed > 0) ship.deflectorRegenCountdown = ship.deflectorRechargeDelay;
  const pResidual = pBypass + (pToDeflector - pAbsorbed);

  // Layer 3 — armour collapse to joules. Pure energy 1:1; momentum's KE via
  // p²/(2·m_eff) (0 for a pure-energy impact, m_eff = ∞). The residual routes
  // through the existing per-cell armour path (uniform reduction — the
  // energy/mass-weighted surface-vs-reactive split is a deferred refinement).
  const kineticEq = profile.effectiveMassKg === Infinity
    ? 0
    : (pResidual * pResidual) / (2 * profile.effectiveMassKg);
  const totalPreArmour = eResidual + kineticEq;
  const rawStructure = totalPreArmour * profile.armourScale;
  if (rawStructure <= 0) return;
  // Energy/mass composition for the (E,p)-aware armour: surfaceReduction scales
  // with the energy fraction, reactiveReduction with the momentum fraction.
  const eFrac = totalPreArmour > 0 ? eResidual / totalPreArmour : 1;
  const pFrac = totalPreArmour > 0 ? kineticEq / totalPreArmour : 0;

  if (ship.modules !== undefined) {
    applyModuleDamage(ship, rawStructure, profile.armourPiercing, impactX, impactY, shotAngle, path, eFrac, pFrac);
    return;
  }
  // Legacy aggregated path (no modules): ship-wide armour, uniform reduction.
  const effectiveReduction = ship.armourReduction * (1 - profile.armourPiercing);
  ship.structure -= rawStructure * (1 - effectiveReduction);
  if (ship.structure <= 0) {
    ship.structure = 0;
    ship.alive = false;
  }
}
