import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CELL_SIZE } from "@/domain/grid";
import type { RenderCell } from "@/ui/cellLayout";
import { ISO_PROJECTION, makeTransform } from "./battleCamera";
import { drawIsoShipCells, isoCellBox, type IsoCellDepth, type Pt } from "./isoShipCells";

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

/** Named handles to the chamfer-clip spy methods, returned alongside the typed
 *  ctx so a test asserts on local `Mock` consts rather than reading
 *  `ctx.clip`/`ctx.save`/`ctx.restore` as detached method references — the
 *  `@typescript-eslint/unbound-method` rule rejects that. Mirrors the repo's
 *  existing `const onFail = vi.fn()` pattern. */
interface CtxSpies {
  ctx: CanvasRenderingContext2D;
  save: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
}

/** A CanvasRenderingContext2D test double covering exactly the call surface
 *  drawIsoShipCells touches (9 drawing methods, 6 fields) PLUS the chamfer-clip
 *  surface (`clip`, `save`, `restore`) as vi.fn spies so a test can assert the
 *  body-only outline clip is applied. Built without a type assertion — banned
 *  repo-wide — by narrowing a plain-object stub to the full interface with a
 *  user-defined type guard. Vitest runs in the node environment, so no real
 *  canvas exists. Returns the spy handles as well as the typed ctx. */
function spyCtx(): CtxSpies {
  const save = vi.fn();
  const clip = vi.fn();
  const restore = vi.fn();
  const noop = (): void => {};
  const stub = {
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    save,
    restore,
    transform: noop,
    clip,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    globalAlpha: 1,
  };
  if (!isCanvasCtx(stub)) throw new Error("stub is not a CanvasRenderingContext2D");
  return { ctx: stub, save, clip, restore };
}

/** A ctx-only view of {@link spyCtx} for tests that draw but do not assert on
 *  clip/save/restore calls. */
function mockCtx(): CanvasRenderingContext2D {
  return spyCtx().ctx;
}

/** Narrow the partial stub to the full CanvasRenderingContext2D interface (a
 *  test double: only the call surface above is actually implemented). */
function isCanvasCtx(value: unknown): value is CanvasRenderingContext2D {
  return typeof value === "object" && value !== null;
}

/** Build a valid, live RenderCell at the given ship-local offset. The glyph
 *  branch in drawIsoShipCells is gated on `cellPx > 12`; with the test's scale
 *  of 3 and CELL_SIZE of 1, cellPx is 3, so no real Path2D is constructed
 *  (vitest's node environment has no canvas). */
function cellAt(ox: number, oy: number): RenderCell {
  return {
    slotId: `slot-${ox},${oy}`,
    ox,
    oy,
    kind: "armour",
    maxHp: 100,
    surface: "deck",
    maxSurfaceHp: 50,
    hasTurret: false,
    hp: 100,
    alive: true,
    surfaceHp: 50,
    turretAngle: undefined,
    manned: undefined,
    ammo: undefined,
    charge: undefined,
  };
}

describe("drawIsoShipCells", () => {
  it("painter-sorts the pooled out buffer back-to-front by projection depth", () => {
    const t = makeTransform(800, 600, 3, 0, 0, ISO_PROJECTION);
    const s = { x: 100, y: 200, facing: 0 };
    // Depths deliberately out of order: with facing 0 the projection depth of a
    // cell is depth(s.x + ox, s.y + oy), so these four inputs run 310, 295,
    // 307, 298 — the painter sort must reorder them to 295, 298, 307, 310.
    const cells = [cellAt(10, 0), cellAt(-5, 0), cellAt(3, 4), cellAt(0, -2)];
    const cellSet = new Set(cells);
    const out: IsoCellDepth[] = [];

    drawIsoShipCells(mockCtx(), t, s, cells, "#ff0000", () => false, out);

    // No loss and no duplication: the emitted set is exactly the input set.
    expect(out.length).toBe(cells.length);
    for (const entry of out) {
      expect(cellSet.has(entry.m)).toBe(true);
    }
    expect(new Set(out.map((e) => e.m)).size).toBe(cells.length);
    // Back-to-front, self-derived via the SAME formula the function uses.
    let prev = -Infinity;
    for (const entry of out) {
      const d = t.projection.depth(s.x + entry.m.ox, s.y + entry.m.oy);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it("the out buffer is reused across calls and resets on shrink (no stale entries)", () => {
    const t = makeTransform(800, 600, 3, 0, 0, ISO_PROJECTION);
    const s = { x: 100, y: 200, facing: 0 };
    // First call: 4 cells, deliberate out-of-order depths (as above).
    const big = [cellAt(10, 0), cellAt(-5, 0), cellAt(3, 4), cellAt(0, -2)];
    const out: IsoCellDepth[] = [];
    drawIsoShipCells(mockCtx(), t, s, big, "#ff0000", () => false, out);
    // Capture the warmed wrapper references at every slot.
    const firstRefs = out.map((x) => x);

    // Second call: a SMALLER cell set, same out/transform/ship. The two cells
    // are pre-sorted ascending by depth so the in-place sort does not swap
    // slots — keeping out[i] === firstRefs[i] across the live range.
    const small = [cellAt(-3, 0), cellAt(4, 2)];
    drawIsoShipCells(mockCtx(), t, s, small, "#ff0000", () => false, out);

    // The length reset dropped the stale tail.
    expect(out.length).toBe(small.length);
    // Wrapper objects are reused (same references), not reallocated.
    for (let i = 0; i < small.length; i += 1) {
      expect(out[i]).toBe(firstRefs[i]);
    }
    // out.length genuinely bounds the live set: the old third slot is no longer
    // reachable through the buffer (it was truncated), even though the detached
    // wrapper object firstRefs[2] still exists in isolation.
    expect(out[out.length]).toBeUndefined();
    // Back-to-front over the new cells.
    let prev = -Infinity;
    for (const entry of out) {
      const d = t.projection.depth(s.x + entry.m.ox, s.y + entry.m.oy);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe("drawIsoShipCells chamfer clip (body-only outline bevel)", () => {
  // Vitest's node environment has no DOM Path2D, and drawIsoShipCells builds one
  // from the outline. A minimal stub class with the three methods the clip path
  // construction calls. Installed via Object.defineProperty (its `value` slot is
  // untyped, so no `as` is needed) and removed reflectively afterwards. Scoped to
  // this describe so the geometry tests above stay Path2D-free.
  beforeEach(() => {
    Object.defineProperty(globalThis, "Path2D", {
      configurable: true,
      writable: true,
      value: class {
        moveTo(): void {}
        lineTo(): void {}
        closePath(): void {}
      },
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "Path2D");
  });

  /** A square outline loop in ship-local world units. Non-empty is all the clip
   *  gate checks (`outline !== undefined && outline.length > 0`). */
  const SQUARE_OUTLINE: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> = [
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  ];

  it("applies the body-only chamfer clip (save/clip/restore) when an outline is present", () => {
    const t = makeTransform(800, 600, 3, 0, 0, ISO_PROJECTION);
    const s = { x: 100, y: 200, facing: 0 };
    const { ctx, save, clip, restore } = spyCtx();
    const out: IsoCellDepth[] = [];
    // One alive cell at scale 3 (cellPx = 3 ≤ 12, so no glyph Path2D is built);
    // the per-cell save/clip/restore block still runs, clipping the side walls
    // to the bevelled silhouette with the evenodd fill rule.
    drawIsoShipCells(ctx, t, s, [cellAt(0, 0)], "#ff0000", () => false, out, SQUARE_OUTLINE);
    expect(save).toHaveBeenCalled();
    expect(clip).toHaveBeenCalledWith(expect.anything(), "evenodd");
    expect(restore).toHaveBeenCalled();
  });

  it("does not clip when no outline is given (outline undefined)", () => {
    const t = makeTransform(800, 600, 3, 0, 0, ISO_PROJECTION);
    const s = { x: 100, y: 200, facing: 0 };
    const { ctx, save, clip, restore } = spyCtx();
    const out: IsoCellDepth[] = [];
    drawIsoShipCells(ctx, t, s, [cellAt(0, 0)], "#ff0000", () => false, out, undefined);
    // No clip path is built, so the per-cell save/clip/restore block is skipped.
    expect(clip).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });
});
