import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderCell } from "@/ui/cellLayout";
import { rasteriseShipSprite } from "./shipSprite";

/**
 * Regression guard for the 2-D sprite chamfer clip. The cached ship sprite bakes
 * its alive cells once into an offscreen canvas and clips them to the bevelled
 * hull outline (the same `computeHullOutline` data the designer and the iso
 * renderer use) so armour corners carry the 45-degree facets. Two past
 * regressions this locks down:
 *
 *  1. the clip was dropped or applied with the wrong fill rule, so the baked
 *     sprite stopped matching the live (iso / designer) silhouettes.
 *  2. the outline was swapped for the tight collision outline, clipping against
 *     the wrong path.
 *
 * Vitest runs in the node environment (no `document`, no real canvas), so the
 * sprite's DOM-backed `createSurface` is injected as a factory returning a spy
 * context, and the global `Path2D` the clip / glyph / wall paths construct is
 * stubbed minimally. We then assert `ctx.clip` is invoked with `"evenodd"` when
 * an outline is supplied and never invoked when one is not.
 */

/** Permissive narrowing guard from a plain-object stub to the full
 *  CanvasRenderingContext2D interface — the repo bans `as`, so (as in
 *  isoShipCells.unit.test.ts) a stub is narrowed by checking it is an object. */
function isCtx(value: unknown): value is CanvasRenderingContext2D {
  return typeof value === "object" && value !== null;
}

/** Same permissive-object trick for the canvas element the sprite carries
 *  through to its return value. The sprite never reads canvas methods when the
 *  surface is injected (only `surface.ctx` is drawn to), so an empty object is a
 *  faithful stand-in. */
function isCanvas(value: unknown): value is HTMLCanvasElement {
  return typeof value === "object" && value !== null;
}

/** Named handles to the chamfer-clip spy methods alongside the typed ctx, so a
 *  test asserts on local `Mock` consts rather than reading `ctx.clip` as a
 *  detached method reference (rejected by `@typescript-eslint/unbound-method`). */
interface CtxSpies {
  ctx: CanvasRenderingContext2D;
  save: ReturnType<typeof vi.fn>;
  clip: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
}

/** A CanvasRenderingContext2D test double covering the sprite's full call
 *  surface, with `clip`/`save`/`restore` as vi.fn spies for the chamfer
 *  assertions. */
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
    fillRect: noop,
    stroke: noop,
    transform: noop,
    translate: noop,
    scale: noop,
    save,
    restore,
    clip,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    lineCap: "butt",
    globalAlpha: 1,
  };
  if (!isCtx(stub)) throw new Error("stub is not a CanvasRenderingContext2D");
  return { ctx: stub, save, clip, restore };
}

/** A Surface stand-in: a carried-through canvas plus the spy context the test
 *  asserts against. Matches the module-private Surface shape structurally. */
function spySurface(ctx: CanvasRenderingContext2D): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas: unknown = {};
  if (!isCanvas(canvas)) throw new Error("stub is not an HTMLCanvasElement");
  return { canvas, ctx };
}

/** A live armour cell at the given ship-local offset — armour is a valid
 *  CellKind with a MODULE_COLOUR entry, so the bake loop draws it. */
function aliveCell(ox: number, oy: number): RenderCell {
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

/** A square outline loop in ship-local world units. The clip gate only checks
 *  `outline !== undefined && outline.length > 0`. */
const SQUARE_OUTLINE: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>> = [
  [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
];

describe("rasteriseShipSprite chamfer clip (outline bevel)", () => {
  // Stub the global Path2D the sprite constructs for the clip path, the wall/
  // door paths, and the cached glyph paths. glyphPath2D builds with
  // `new Path2D(pathData)` (an SVG path string); the implicit constructor
  // accepts and ignores any args, so no explicit constructor is needed.
  // moveTo/lineTo/closePath cover the clip and bulkhead construction. Installed
  // via Object.defineProperty (its `value` slot is untyped, so no `as`) and
  // removed reflectively afterwards.
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

  it("clips the baked cells to the outline with the evenodd fill rule", () => {
    const { ctx, clip } = spyCtx();
    const sprite = rasteriseShipSprite(
      [aliveCell(0, 0)],
      "#000000",
      "key",
      SQUARE_OUTLINE,
      () => spySurface(ctx),
    );
    expect(sprite).toBeDefined();
    // The single outline clip (applied before the cell bake loop) uses evenodd
    // so multiple loops and holes resolve correctly. Asserting the fill rule
    // catches a regression to the default nonzero clip.
    expect(clip).toHaveBeenCalledWith(expect.anything(), "evenodd");
  });

  it("does not clip when no outline is given", () => {
    const { ctx, clip } = spyCtx();
    const sprite = rasteriseShipSprite(
      [aliveCell(0, 0)],
      "#000000",
      "key",
      undefined,
      () => spySurface(ctx),
    );
    expect(sprite).toBeDefined();
    expect(clip).not.toHaveBeenCalled();
  });
});
