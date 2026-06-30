import { describe, expect, it } from "vitest";

import { SIM, SPEED_OF_LIGHT_M_PER_S } from "@/domain/simulation/engine/config";
import {
  beamImpactProfile,
  debrisImpactProfile,
  energyImpactProfile,
  internalBlastImpactProfile,
  kineticImpactProfile,
  ramImpactProfile,
  warheadImpactProfile,
} from "@/domain/simulation/engine/impact-profile";

/**
 * The impact-profile builders are pure SI functions consumed by `applyImpact`.
 * These tests pin the (energy, momentum, effective-mass) split per source and
 * the no-double-count invariant: a kinetic round's armour work `p²/2m` must
 * equal its muzzle KE `½mv²`, and a ram's `p²/2m × armourScale` must equal
 * today's collision/debris damage byte-for-byte.
 */

describe("impact-profile builders", () => {
  describe("beam (pure energy + photon momentum)", () => {
    it("carries the full damage as energy and a negligible E/c photon momentum", () => {
      const damage = 3e8; // 300 MJ pulse
      const p = beamImpactProfile({ damageJ: damage, shieldPiercing: 0.1, armourPiercing: 0.2 });
      expect(p.energyJ).toBe(damage);
      expect(p.momentumKgMps).toBe(damage / SPEED_OF_LIGHT_M_PER_S); // ~1 kg·m/s
      expect(p.effectiveMassKg).toBe(Infinity);
      expect(p.momentumKgMps).toBeLessThan(2); // negligible next to a slug
    });
  });

  describe("kinetic slug (pure momentum)", () => {
    it("carries zero energy and momentum = m·v, so p²/2m = ½mv²", () => {
      // Frigate railgun: 10 kg at 8 km/s — ~320 MJ muzzle KE.
      const mass = 10;
      const speed = 8_000;
      const p = kineticImpactProfile({ massKg: mass, speedMps: speed, shieldPiercing: 0.35, armourPiercing: 0.5 });
      expect(p.energyJ).toBe(0);
      expect(p.momentumKgMps).toBe(mass * speed);
      expect(p.effectiveMassKg).toBe(mass);
      // The armour layer will compute this round's KE as p²/2m = ½mv² exactly.
      const armourKE = (p.momentumKgMps * p.momentumKgMps) / (2 * p.effectiveMassKg);
      expect(armourKE).toBe(0.5 * mass * speed * speed);
    });
  });

  describe("powered ordnance (energy + body momentum)", () => {
    it("carries the warhead yield as energy AND body m·v as momentum", () => {
      const mass = 5;
      const speed = 3_000;
      const yieldJ = 2e8;
      const p = warheadImpactProfile({
        massKg: mass,
        speedMps: speed,
        energyJ: yieldJ,
        shieldPiercing: 0.45,
        armourPiercing: 0.4,
      });
      expect(p.energyJ).toBe(yieldJ);
      expect(p.momentumKgMps).toBe(mass * speed);
      expect(p.effectiveMassKg).toBe(mass);
    });
  });

  describe("ram (pure momentum, collision-scaled)", () => {
    it("reduces to today's collision damage: p²/2m × fraction = ½·mRed·v² × fraction", () => {
      const reducedMass = 2_500;
      const relSpeed = 200;
      const p = ramImpactProfile({ reducedMassKg: reducedMass, relSpeedMps: relSpeed });
      expect(p.energyJ).toBe(0);
      expect(p.momentumKgMps).toBe(reducedMass * relSpeed);
      expect(p.effectiveMassKg).toBe(reducedMass);
      expect(p.armourScale).toBe(SIM.collisionDamageFraction);
      const armourDamage = ((p.momentumKgMps * p.momentumKgMps) / (2 * p.effectiveMassKg)) * p.armourScale;
      expect(armourDamage).toBe(0.5 * reducedMass * relSpeed * relSpeed * SIM.collisionDamageFraction);
    });
  });

  describe("debris (pure momentum, debris-scaled)", () => {
    it("uses the debris collision fraction, not the ship-ship one", () => {
      const mass = 100;
      const relSpeed = 50;
      const p = debrisImpactProfile({ massKg: mass, relSpeedMps: relSpeed });
      expect(p.energyJ).toBe(0);
      expect(p.momentumKgMps).toBe(mass * relSpeed);
      expect(p.armourScale).toBe(SIM.debrisCollisionDamageFraction);
      expect(SIM.debrisCollisionDamageFraction).toBeLessThan(SIM.collisionDamageFraction);
    });
  });

  describe("pure-energy sources (mine / drone strike / external blast)", () => {
    it("carries energy only — no momentum, infinite effective mass", () => {
      const p = energyImpactProfile({ energyJ: 5e8, shieldPiercing: 0, armourPiercing: 0 });
      expect(p.energyJ).toBe(5e8);
      expect(p.momentumKgMps).toBe(0);
      expect(p.effectiveMassKg).toBe(Infinity);
    });
  });

  describe("internal blast (detonates inside the hull)", () => {
    it("bypasses both screens and armour", () => {
      const p = internalBlastImpactProfile({ energyJ: 1e9 });
      expect(p.energyJ).toBe(1e9);
      expect(p.shieldPiercing).toBe(1);
      expect(p.deflectorPiercing).toBe(1);
      expect(p.armourPiercing).toBe(1);
    });
  });

  describe("deflectorPiercing", () => {
    it("defaults to 0 (deflector catches the full momentum) when omitted", () => {
      const p = kineticImpactProfile({ massKg: 10, speedMps: 8_000, shieldPiercing: 0, armourPiercing: 0 });
      expect(p.deflectorPiercing).toBe(0);
    });

    it("is honoured when passed", () => {
      const p = warheadImpactProfile({
        massKg: 5,
        speedMps: 3_000,
        energyJ: 1e8,
        shieldPiercing: 0.1,
        armourPiercing: 0.3,
        deflectorPiercing: 0.3,
      });
      expect(p.deflectorPiercing).toBe(0.3);
    });
  });
});
