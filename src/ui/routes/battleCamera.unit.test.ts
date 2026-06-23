import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA,
  FLAT_PROJECTION,
  ISO_PROJECTION,
  liveShipsBounds,
  makeTransform,
  manualCameraFrom,
  resolveViewTransform,
  screenToWorld,
} from "./battleCamera";
import type { Bounds, Camera } from "./battleCamera";
import type { BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";

/** A frame with the given ships (only the fields the camera reads). */
function frameWith(
  ships: { id: string; x: number; y: number; alive: boolean }[],
): BattleFrame {
  return {
    tick: 0,
    projectiles: [],
    ships: ships.map((s) => ({
      instanceId: s.id,
      side: "attacker",
      x: s.x,
      y: s.y,
      facing: 0,
      vx: 0,
      vy: 0,
      structure: 100,
      shield: 0,
      alive: s.alive,
      comX: 0,
      comY: 0,
    })),
  };
}

const NO_DESCRIPTORS: DescriptorMap = new Map();
const WIDE_BOUNDS: Bounds = { minX: -10000, maxX: 10000, minY: -10000, maxY: 10000 };

describe("battleCamera", () => {
  describe("liveShipsBounds", () => {
    it("boxes the live ships and ignores the dead", () => {
      const frame = frameWith([
        { id: "a", x: -100, y: 0, alive: true },
        { id: "b", x: 100, y: 0, alive: true },
        { id: "c", x: 9000, y: 9000, alive: false }, // dead — must not widen the box
      ]);
      const b = liveShipsBounds(frame, NO_DESCRIPTORS);
      expect(b).not.toBeNull();
      // Centre is the live midpoint, not dragged toward the dead ship.
      expect((b!.minX + b!.maxX) / 2).toBeCloseTo(0, 6);
      expect(b!.maxX).toBeLessThan(9000);
    });

    it("returns null when no ship is alive", () => {
      const frame = frameWith([{ id: "a", x: 0, y: 0, alive: false }]);
      expect(liveShipsBounds(frame, NO_DESCRIPTORS)).toBeNull();
    });
  });

  describe("resolveViewTransform", () => {
    it("auto-fit frames the live ships, centred on them", () => {
      const frame = frameWith([
        { id: "a", x: -100, y: -50, alive: true },
        { id: "b", x: 100, y: 50, alive: true },
      ]);
      const t = resolveViewTransform(800, 600, WIDE_BOUNDS, DEFAULT_CAMERA, frame, NO_DESCRIPTORS);
      // Centred on the live midpoint, not the (vast) whole-battle centre.
      expect(t.centreX).toBeCloseTo(0, 6);
      expect(t.centreY).toBeCloseTo(0, 6);
      // Both ships fall inside the canvas.
      for (const s of frame.ships) {
        expect(t.sx(s.x)).toBeGreaterThanOrEqual(0);
        expect(t.sx(s.x)).toBeLessThanOrEqual(800);
        expect(t.sy(s.y)).toBeGreaterThanOrEqual(0);
        expect(t.sy(s.y)).toBeLessThanOrEqual(600);
      }
    });

    it("manual mode uses baseScale*zoom and the stored centre", () => {
      const cam: Camera = {
        autoFit: false,
        zoom: 2,
        baseScale: 3,
        centreX: 50,
        centreY: 60,
        followId: null,
        projection: "flat",
      };
      const frame = frameWith([{ id: "a", x: 0, y: 0, alive: true }]);
      const t = resolveViewTransform(800, 600, WIDE_BOUNDS, cam, frame, NO_DESCRIPTORS);
      expect(t.scale).toBe(6);
      expect(t.centreX).toBe(50);
      expect(t.centreY).toBe(60);
    });

    it("manual mode follows a ship's live position", () => {
      const cam: Camera = {
        autoFit: false,
        zoom: 1,
        baseScale: 4,
        centreX: 999,
        centreY: 999,
        followId: "a",
        projection: "flat",
      };
      const frame = frameWith([{ id: "a", x: 10, y: 20, alive: true }]);
      const t = resolveViewTransform(800, 600, WIDE_BOUNDS, cam, frame, NO_DESCRIPTORS);
      expect(t.centreX).toBe(10);
      expect(t.centreY).toBe(20);
    });
  });

  describe("projection seam", () => {
    it("flat projection maps a world point identically through project and sx/sy", () => {
      const t = makeTransform(800, 600, 5, 100, 200);
      const cases: ReadonlyArray<readonly [number, number]> = [
        [100, 200],
        [140, 260],
        [0, 0],
      ];
      for (const [wx, wy] of cases) {
        const p = t.project(wx, wy);
        expect(p.x).toBeCloseTo(t.sx(wx), 9);
        expect(p.y).toBeCloseTo(t.sy(wy), 9);
        // flat sx/sy are the plain affine map
        expect(p.x).toBeCloseTo(800 / 2 + (wx - 100) * 5, 9);
        expect(p.y).toBeCloseTo(600 / 2 + (wy - 200) * 5, 9);
      }
    });

    it("screenToWorld is the exact inverse of project", () => {
      const t = makeTransform(800, 600, 5, 100, 200);
      const cases: ReadonlyArray<readonly [number, number]> = [
        [123, 77],
        [-40, 310],
      ];
      for (const [wx, wy] of cases) {
        const p = t.project(wx, wy);
        const back = screenToWorld(t, p.x, p.y);
        expect(back.x).toBeCloseTo(wx, 6);
        expect(back.y).toBeCloseTo(wy, 6);
      }
    });

    it("FLAT_PROJECTION is the identity with depth = y", () => {
      expect(FLAT_PROJECTION.project(3, 7)).toEqual({ x: 3, y: 7 });
      expect(FLAT_PROJECTION.unproject(3, 7)).toEqual({ x: 3, y: 7 });
      expect(FLAT_PROJECTION.depth(3, 7)).toBe(7);
    });
  });

  describe("ISO_PROJECTION", () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [100, 0],
      [0, 100],
      [-37, 84],
      [250, -130],
    ];

    it("project/unproject round-trip", () => {
      for (const [dx, dy] of cases) {
        const p = ISO_PROJECTION.project(dx, dy);
        const back = ISO_PROJECTION.unproject(p.x, p.y);
        expect(back.x).toBeCloseTo(dx, 9);
        expect(back.y).toBeCloseTo(dy, 9);
      }
    });

    it("is a true 2:1 diamond — the vertical extent is half the horizontal", () => {
      // Equal world steps along each axis: x-extent (dx-dy) is twice the
      // y-extent (dx+dy) per unit, so the on-screen diamond is 2:1.
      const px = ISO_PROJECTION.project(1, -1); // pure screen-x basis
      const py = ISO_PROJECTION.project(1, 1); // pure screen-y basis
      expect(px.y).toBeCloseTo(0, 9);
      expect(py.x).toBeCloseTo(0, 9);
      expect(Math.abs(px.x)).toBeCloseTo(Math.abs(py.y) * 2, 9);
    });

    it("depth = dx + dy increases monotonically toward the front", () => {
      expect(ISO_PROJECTION.depth(0, 0)).toBe(0);
      expect(ISO_PROJECTION.depth(10, 0)).toBeGreaterThan(ISO_PROJECTION.depth(0, 0));
      expect(ISO_PROJECTION.depth(10, 10)).toBeGreaterThan(ISO_PROJECTION.depth(10, 0));
      expect(ISO_PROJECTION.depth(-5, -5)).toBeLessThan(ISO_PROJECTION.depth(0, 0));
    });

    it("screenToWorld inverts an isometric transform", () => {
      const t = makeTransform(800, 600, 5, 100, 200, ISO_PROJECTION);
      const worldCases: ReadonlyArray<readonly [number, number]> = [
        [100, 200],
        [123, 77],
        [-40, 310],
      ];
      for (const [wx, wy] of worldCases) {
        const p = t.project(wx, wy);
        const back = screenToWorld(t, p.x, p.y);
        expect(back.x).toBeCloseTo(wx, 6);
        expect(back.y).toBeCloseTo(wy, 6);
      }
    });
  });

  describe("projection mode rides the camera", () => {
    it("resolveViewTransform picks the iso projection when the camera asks for it", () => {
      const frame = frameWith([{ id: "a", x: 0, y: 0, alive: true }]);
      const cam: Camera = { ...DEFAULT_CAMERA, projection: "isometric" };
      const t = resolveViewTransform(800, 600, WIDE_BOUNDS, cam, frame, NO_DESCRIPTORS);
      expect(t.projection.mode).toBe("isometric");
    });

    it("defaults to flat and preserves the mode through break-out", () => {
      expect(DEFAULT_CAMERA.projection).toBe("flat");
      const tIso = makeTransform(800, 600, 5, 100, 200, ISO_PROJECTION);
      expect(manualCameraFrom(tIso).projection).toBe("isometric");
      const tFlat = makeTransform(800, 600, 5, 100, 200);
      expect(manualCameraFrom(tFlat).projection).toBe("flat");
    });
  });

  describe("manualCameraFrom", () => {
    it("captures the transform so resolving it reproduces the same view (break-out continuity)", () => {
      const t0 = makeTransform(800, 600, 5, 100, 200);
      const cam = manualCameraFrom(t0);
      expect(cam.autoFit).toBe(false);
      expect(cam.zoom).toBe(1);
      const frame = frameWith([{ id: "a", x: 0, y: 0, alive: true }]);
      const t1 = resolveViewTransform(800, 600, WIDE_BOUNDS, cam, frame, NO_DESCRIPTORS);
      expect(t1.scale).toBe(t0.scale);
      expect(t1.centreX).toBe(t0.centreX);
      expect(t1.centreY).toBe(t0.centreY);
    });
  });
});
