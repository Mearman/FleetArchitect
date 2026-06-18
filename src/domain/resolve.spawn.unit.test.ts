import { describe, expect, it } from "vitest";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { deriveRadius } from "@/domain/grid";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";

/**
 * Spawn spacing: deployed ships must not overlap at the start of a battle, and
 * each side must deploy on its OWN side of the arena (attackers to the left of
 * the midline, defenders to the right). Ships overlapping at tick 0 trigger the
 * cell-collision separation impulse and get flung apart before the battle even
 * begins; ships spawning across the midline meet in the wrong place. The
 * deployment must space ships by their actual size, so it stays correct as ship
 * designs grow.
 */

function radiusOf(designId: string): number {
  const design = presetDesigns.find((d) => d.id === designId);
  if (design === undefined) throw new Error(`unknown design ${designId}`);
  return deriveRadius(design.grid);
}

describe("fleet deployment spacing", () => {
  const designs = new Map(presetDesigns.map((d) => [d.id, d]));

  it("no two ships in a deployed fleet overlap", () => {
    for (const fleet of presetFleets) {
      const ships = resolveFleetToCombatShips(fleet, designs, catalog(), "attacker");
      for (let i = 0; i < ships.length; i += 1) {
        for (let j = i + 1; j < ships.length; j += 1) {
          const a = ships[i];
          const b = ships[j];
          if (a === undefined || b === undefined) continue;
          const gap = Math.hypot(
            a.position.x - b.position.x,
            a.position.y - b.position.y,
          );
          const minGap = radiusOf(a.designId) + radiusOf(b.designId);
          expect(
            gap,
            `${fleet.name}: ships ${i} and ${j} overlap (gap ${gap.toFixed(0)} < ${minGap.toFixed(0)})`,
          ).toBeGreaterThanOrEqual(minGap);
        }
      }
    }
  });

  it("attackers deploy left of the midline, defenders right, with a clear gap", () => {
    for (const fleet of presetFleets) {
      const attackers = resolveFleetToCombatShips(fleet, designs, catalog(), "attacker");
      const defenders = resolveFleetToCombatShips(fleet, designs, catalog(), "defender");
      // Every attacker ship (including its hull extent) sits left of x=0.
      for (const s of attackers) {
        const r = radiusOf(s.designId);
        expect(
          s.position.x + r,
          `${fleet.name}: an attacker reaches past the midline (x=${s.position.x.toFixed(0)} r=${r.toFixed(0)})`,
        ).toBeLessThanOrEqual(0);
      }
      for (const s of defenders) {
        const r = radiusOf(s.designId);
        expect(
          s.position.x - r,
          `${fleet.name}: a defender reaches past the midline`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
