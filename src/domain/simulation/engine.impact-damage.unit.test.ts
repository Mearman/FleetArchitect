import { describe, expect, it } from "vitest";

import { applyImpact } from "@/domain/simulation/engine/damage-impact";
import {
  beamImpactProfile,
  kineticImpactProfile,
  ramImpactProfile,
  warheadImpactProfile,
  internalBlastImpactProfile,
} from "@/domain/simulation/engine/impact-profile";
import { toSimShip } from "@/domain/simulation/engine/setup";
import { mulberry32 } from "@/domain/simulation/rng";
import type { SimShip } from "@/domain/simulation/engine/types";
import type { CombatShip, ResolvedModule } from "@/domain/simulation/types";
import type { ShipStats } from "@/domain/stats";
import type { CellEdges } from "@/schema/grid";
import type { ModuleEffect } from "@/schema/module";

/**
 * applyImpact is the unified (energy, momentum) absorption path: shield takes
 * energy, deflector takes momentum, armour/structure takes the residual (energy
 * 1:1 + the residual momentum's KE p²/2m). These pin the screen layers and the
 * no-double-count property. Ships are built via toSimShip then given explicit
 * shield/deflector pools so the layers are exercised directly.
 */

const OPEN_EDGES: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

function moduleOf(slotId: string, effect: ModuleEffect, col: number, maxHp = 50): ResolvedModule {
  return {
    slotId, moduleId: `mod-${slotId}`, kind: effect.kind, col, row: 0, x: col * 24, y: 0,
    maxSurfaceHp: 0, maxSubstrateHp: maxHp, surfaceReduction: 0, reactiveReduction: 0, reactiveWindow: 0, maxReactiveHp: 0,
    surface: "deck", edges: OPEN_EDGES, mass: 5, powerDraw: 0, crewRequired: 0, effect,
    command: effect.kind === "hull", repairRate: 0, shieldArc: Math.PI * 2, shieldFacing: 0,
    facing: 0, weaponFacing: 0, turretArc: 0, turretTurnRate: 0, channel: 0, commsBearing: 0, sensorBearing: 0,
  };
}

function baseStats(): ShipStats {
  return {
    mass: 10, cost: 100, powerDraw: 0, powerOutput: 1000, powerNet: 1000, crewRequired: 0,
    crewCapacity: 0, crewNet: 0, structure: 500, damageReduction: 0, shieldCapacity: 0,
    shieldRechargeRate: 0, shieldRechargeDelay: 30, deflectorCapacity: 0, deflectorRechargeRate: 0,
    deflectorRechargeDelay: 30, thrust: 0, turnRate: 0, weapons: [], compartments: 0, airtightCompartments: 0,
  };
}

/** A modular ship with a bridge + one deck cell, built fresh each call. */
function shipWith(shieldJ: number, deflectorKgMps: number): SimShip {
  const combat: CombatShip = {
    instanceId: "s1", designId: "d-s1", faction: "Terran", side: "attacker", stats: baseStats(),
    position: { x: 0, y: 0 }, facing: 0, doctrine: { base: {}, rules: [] }, classification: "frigate",
    modules: [moduleOf("cmd", { kind: "hull" }, 0), moduleOf("c0", { kind: "hull" }, 1)],
  };
  const s = toSimShip(combat, mulberry32(1));
  s.shield = shieldJ;
  s.maxShield = shieldJ;
  s.deflector = deflectorKgMps;
  s.maxDeflector = deflectorKgMps;
  return s;
}

describe("applyImpact — unified (energy, momentum) absorption", () => {
  it("an energy impact depletes the shield, not the deflector", () => {
    const s = shipWith(1_000, 100_000);
    applyImpact(s, beamImpactProfile({ damageJ: 400, shieldPiercing: 0, armourPiercing: 0 }));
    expect(s.shield).toBe(600); // 1000 - 400
    // Beams carry only photon momentum (E/c ≈ 1e-6), so the deflector is all but
    // untouched — depleting by a negligible, physically-correct fraction.
    expect(s.deflector).toBeCloseTo(100_000, 3);
  });

  it("a kinetic impact depletes the deflector, not the shield", () => {
    const s = shipWith(1_000, 100_000);
    // 10 kg at 8000 m/s → momentum 80 000 kg·m/s (within the deflector's 100 000).
    applyImpact(s, kineticImpactProfile({ massKg: 10, speedMps: 8_000, shieldPiercing: 0, armourPiercing: 0 }));
    expect(s.shield).toBe(1_000); // untouched — kinetics carry no energy
    expect(s.deflector).toBe(20_000); // 100 000 - 80 000
  });

  it("a deflector arrests a ram before it reaches armour (momentum ≤ deflector)", () => {
    const s = shipWith(0, 1_000_000); // huge deflector, no shield
    const structBefore = s.structure;
    // reducedMass 2500 at 200 m/s → momentum 500 000 (well within deflector).
    applyImpact(s, ramImpactProfile({ reducedMassKg: 2_500, relSpeedMps: 200 }));
    expect(s.deflector).toBe(500_000); // arrested the ram's momentum
    expect(s.structure).toBe(structBefore); // nothing got through to the hull
  });

  it("a ram with no deflector reaches the hull: p²/2m × collisionDamageFraction", () => {
    // Give the ship enough structure to absorb the full ram without dying, so the
    // total energy loss (cells + hull) equals the collision damage exactly.
    const s = shipWith(0, 0);
    s.structure = 1e9;
    s.maxStructure = 1e9;
    const structBefore = s.structure;
    applyImpact(s, ramImpactProfile({ reducedMassKg: 2_500, relSpeedMps: 200 }));
    // ½·2500·200² × 0.3 = 15 000 000 J — byte-identical to applyCollisionDamage.
    const expectedLoss = 0.5 * 2_500 * 200 * 200 * 0.3;
    const cellLoss = (s.modules ?? []).reduce((sum, m) => sum + (50 - m.hp), 0); // hp started at 50
    expect(structBefore - s.structure + cellLoss).toBeCloseTo(expectedLoss, 5);
  });

  it("a warhead impact depletes BOTH the shield (yield) and the deflector (body momentum)", () => {
    const s = shipWith(1_000, 100_000);
    applyImpact(s, warheadImpactProfile({
      massKg: 5, speedMps: 3_000, energyJ: 600, shieldPiercing: 0, armourPiercing: 0,
    }));
    expect(s.shield).toBe(400); // 1000 - 600 yield
    expect(s.deflector).toBe(85_000); // 100 000 - 15 000 body momentum
  });

  it("an internal blast bypasses both screens", () => {
    const s = shipWith(1_000_000, 1_000_000); // huge screens
    const structBefore = s.structure;
    applyImpact(s, internalBlastImpactProfile({ energyJ: 1_000_000 }));
    expect(s.shield).toBe(1_000_000); // bypassed
    expect(s.deflector).toBe(1_000_000); // bypassed
    expect(s.structure).toBeLessThan(structBefore); // hit the hull directly
  });
});
