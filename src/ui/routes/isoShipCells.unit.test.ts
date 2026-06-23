import { describe, expect, it } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import { isoCellBox, type Pt } from "./isoShipCells";

/** A canonical 2:1 isometric projection, like ISO_PROJECTION but standalone so
 *  the geometry test does not depend on the camera module. */
const isoProject = (wx: number, wy: number): Pt => ({
  x: (wx - wy) * 0.8,
  y: (wx + wy) * 0.4,
});

describe("isoCellBox", () => {
  it("lifts the top face straight up the screen by the height rise", () => {
    const scale = 3;
    const heightCells = 0.5;
    const box = isoCellBox(isoProject, 1, 0, 0, 0, 0, 0, heightCells, scale);
    const expectedZ = heightCells * CELL_SIZE * scale;
    expect(box.zS).toBeCloseTo(expectedZ, 9);
    for (let i = 0; i < 4; i += 1) {
      const g = box.ground[i];
      const t = box.top[i];
      if (g === undefined || t === undefined) throw new Error("missing corner");
      // Top is the ground corner raised by exactly zS, with x unchanged.
      expect(t.x).toBeCloseTo(g.x, 9);
      expect(t.y).toBeCloseTo(g.y - expectedZ, 9);
    }
  });

  it("a taller cell rises further than a shorter one at the same scale", () => {
    const scale = 2;
    const tall = isoCellBox(isoProject, 1, 0, 0, 0, 0, 0, 0.85, scale);
    const short = isoCellBox(isoProject, 1, 0, 0, 0, 0, 0, 0.12, scale);
    expect(tall.zS).toBeGreaterThan(short.zS);
  });

  it("the projected centre is the centroid of the ground quad (affine projection)", () => {
    const box = isoCellBox(isoProject, 1, 0, 5, -3, 2, 1, 0.4, 1.5);
    const avgX = box.ground.reduce((s, p) => s + p.x, 0) / 4;
    const avgY = box.ground.reduce((s, p) => s + p.y, 0) / 4;
    expect(box.centre.x).toBeCloseTo(avgX, 9);
    expect(box.centre.y).toBeCloseTo(avgY, 9);
  });

  it("ship rotation orients the box (a 90° turn swaps the local axes)", () => {
    // Facing +y (cosF=0, sinF=1): the cell's local +x maps to world +y. The
    // centre of a cell at local (1,0) must land where world (shipX, shipY+1)
    // projects.
    const box = isoCellBox(isoProject, 0, 1, 0, 0, 1, 0, 0.3, 1);
    const expected = isoProject(0, 1);
    expect(box.centre.x).toBeCloseTo(expected.x, 9);
    expect(box.centre.y).toBeCloseTo(expected.y, 9);
  });
});
