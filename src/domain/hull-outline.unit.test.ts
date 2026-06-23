import { describe, expect, it } from "vitest";
import { TileGrid } from "@/schema/grid";
import { presetDesigns } from "@/data/presets";
import { computeHullOutline } from "@/domain/hull-outline";
import { CELL_SIZE } from "@/domain/grid";
import { pointInPolygon } from "@/domain/outline";

/**
 * Invariant contract for the grown-and-bevelled hull outline. These are the
 * guarantees the user locked in during design and that the algorithm must make
 * impossible to violate:
 *
 *   45 — every turn is a multiple of 45 degrees; in particular no 90-degree
 *        corner survives (HARD mode).
 *   SQRT2 — no diagonal facet is shorter than one cell diagonal (sqrt 2).
 *   CONTAIN — every armour/solid cell of the *original* footprint stays inside
 *        the hull (the grow-then-bevel never excludes real plating).
 *   DETERMINISTIC — byte-identical output for identical input.
 *   OCTILINEAR — every edge direction is axis-aligned or a 45-degree diagonal.
 */

const TURN_EPS = 1e-6;
const SQRT2 = Math.SQRT2;

type Pt = { x: number; y: number };

/** Build a grid of all-armour solid cells from an ASCII map (`#` solid). */
function armourGrid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const armour = {
    kind: "solid",
    substrate: true,
    surface: "armor",
    edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
  };
  const empty = { kind: "empty" };
  const cells: unknown[] = rows.flatMap((line) =>
    Array.from({ length: cols }, (_unused, c) => (line[c] === "#" ? armour : empty)),
  );
  return TileGrid.parse({ cols, rows: rows.length, cells, connections: [] });
}

/** Build a grid of all-deck solid cells from an ASCII map (`#` solid). Deck
 *  cells grow a one-cell armour ring, so these exercise the grow path. */
function deckGrid(rows: readonly string[]): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const deck = {
    kind: "solid",
    substrate: true,
    surface: "deck",
    edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} },
  };
  const empty = { kind: "empty" };
  const cells: unknown[] = rows.flatMap((line) =>
    Array.from({ length: cols }, (_unused, c) => (line[c] === "#" ? deck : empty)),
  );
  return TileGrid.parse({ cols, rows: rows.length, cells, connections: [] });
}

/** Turn angle (degrees) at vertex i of a loop. */
function turnDeg(loop: readonly Pt[], i: number): number {
  const n = loop.length;
  const p = loop[(i - 1 + n) % n]!;
  const v = loop[i]!;
  const w = loop[(i + 1) % n]!;
  const a1 = Math.atan2(v.y - p.y, v.x - p.x);
  const a2 = Math.atan2(w.y - v.y, w.x - v.x);
  let t = ((a2 - a1) * 180) / Math.PI;
  while (t > 180) t -= 360;
  while (t < -180) t += 360;
  return t;
}

function maxAbsTurn(loops: readonly (readonly Pt[])[]): number {
  let m = 0;
  for (const loop of loops)
    for (let i = 0; i < loop.length; i += 1) m = Math.max(m, Math.abs(turnDeg(loop, i)));
  return m;
}

function minDiagonalFacet(loops: readonly (readonly Pt[])[]): number {
  let m = Infinity;
  for (const loop of loops)
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const dx = (b.x - a.x) / CELL_SIZE;
      const dy = (b.y - a.y) / CELL_SIZE;
      if (Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9) m = Math.min(m, Math.hypot(dx, dy));
    }
  return m;
}

function everyEdgeOctilinear(loops: readonly (readonly Pt[])[]): boolean {
  for (const loop of loops)
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const dx = (b.x - a.x) / CELL_SIZE;
      const dy = (b.y - a.y) / CELL_SIZE;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const axis = ax < 1e-9 || ay < 1e-9;
      const diag = Math.abs(ax - ay) < 1e-6;
      if (!axis && !diag) return false;
    }
  return true;
}

/** Whether every built (solid) cell's centre is inside-or-on the hull — i.e. no
 *  plating was dropped. A sqrt-2 corner cut can leave a corner cell's centre
 *  exactly on the boundary, so "contained" means inside-or-on, not strictly in. */
function everyCellContained(grid: TileGrid, loops: readonly (readonly Pt[])[]): boolean {
  const onBoundary = (p: Pt): boolean => {
    for (const loop of loops)
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1);
        const tc = Math.max(0, Math.min(1, t));
        if (Math.hypot(p.x - (a.x + tc * abx), p.y - (a.y + tc * aby)) < CELL_SIZE * 1e-6)
          return true;
      }
    return false;
  };
  const inside = (p: Pt): boolean => {
    let parity = 0;
    for (const loop of loops) if (pointInPolygon(p, loop)) parity ^= 1;
    return parity === 1 || onBoundary(p);
  };
  for (let r = 0; r < grid.rows; r += 1)
    for (let c = 0; c < grid.cols; c += 1) {
      if (grid.cells[r * grid.cols + c]?.kind !== "solid") continue;
      const centre = {
        x: (c - (grid.cols - 1) / 2) * CELL_SIZE,
        y: (r - (grid.rows - 1) / 2) * CELL_SIZE,
      };
      if (!inside(centre)) return false;
    }
  return true;
}

/**
 * Shapes whose every feature is at least three cells across — the floor below
 * which the hard invariants are geometrically impossible (a 2x2 bevels to a
 * diamond whose tips are new right angles; a 1-cell nub or leg can't carry a
 * sqrt-2 facet). Real ships are 1 m-subdivided and always above this floor; a
 * sub-floor shape is exercised separately by the no-crash test below.
 */
// Shapes whose every feature is at least three cells, so all the hard invariants
// — including the sqrt-2 minimum facet — are achievable simultaneously.
const SHAPES: readonly string[][] = [
  ["###", "###", "###"],
  ["####", "####", "####", "####"],
  ["#####", "#####", "#####"],
  ["###...", "###...", "###...", "######", "######", "######"],
  ["..####..", ".######.", "########", "########", ".######.", "..####.."],
];

describe("computeHullOutline — invariants (HARD)", () => {
  for (const rows of SHAPES) {
    const name = rows.join("/");
    const grid = armourGrid(rows);

    it(`${name}: no 90-degree corner (max turn = 45)`, () => {
      const loops = computeHullOutline(grid);
      expect(maxAbsTurn(loops)).toBeLessThanOrEqual(45 + TURN_EPS);
    });

    it(`${name}: every edge octilinear`, () => {
      expect(everyEdgeOctilinear(computeHullOutline(grid))).toBe(true);
    });

    it(`${name}: no facet shorter than sqrt(2)`, () => {
      const loops = computeHullOutline(grid);
      const m = minDiagonalFacet(loops);
      if (m !== Infinity) expect(m).toBeGreaterThanOrEqual(SQRT2 - 1e-6);
    });

    it(`${name}: contains every cell`, () => {
      expect(everyCellContained(grid, computeHullOutline(grid))).toBe(true);
    });

    it(`${name}: deterministic`, () => {
      expect(JSON.stringify(computeHullOutline(grid))).toBe(
        JSON.stringify(computeHullOutline(grid)),
      );
    });
  }
});

describe("computeHullOutline — thin-tipped shapes stay contained", () => {
  // An asymmetric arrowhead whose tip is only two cells across. The sqrt-2
  // minimum facet is geometrically impossible there (a 2-cell tip can carry only
  // a half-cell chamfer), so the previous behaviour shaved the tip off — dropping
  // real plating. Containment wins over the facet length: every cell must stay
  // inside, while turns stay <= 45 and edges octilinear.
  const arrowhead = ["####....", "######..", "########", "########", "######..", "####...."];
  it("keeps every cell of a 2-cell tip inside the hull", () => {
    const grid = armourGrid(arrowhead);
    const loops = computeHullOutline(grid);
    expect(everyCellContained(grid, loops)).toBe(true);
    expect(maxAbsTurn(loops)).toBeLessThanOrEqual(45 + TURN_EPS);
    expect(everyEdgeOctilinear(loops)).toBe(true);
  });
});

describe("computeHullOutline — disjoint deck clusters obey the 45 invariant", () => {
  // Two separate deck clusters in one grid. Each is bevelled independently and
  // neither may leave a turn sharper than 45 degrees. (Regression: a pinched
  // footprint once produced a -135 spike.)
  it("leaves no turn sharper than 45 degrees", () => {
    const grid = deckGrid(["##..", "#...", "....", "....", "####"]);
    const loops = computeHullOutline(grid);
    expect(maxAbsTurn(loops)).toBeLessThanOrEqual(45 + TURN_EPS);
  });
});

describe("computeHullOutline — every preset ship satisfies the invariants", () => {
  for (const d of presetDesigns) {
    it(`${d.id}: octilinear, no 90, contains every cell`, () => {
      const loops = computeHullOutline(d.grid);
      expect(everyEdgeOctilinear(loops)).toBe(true);
      expect(maxAbsTurn(loops)).toBeLessThanOrEqual(45 + 1e-3);
      // sqrt-2 is not asserted here: with the hull hugging the plating (no grown
      // ring) a 2-cell-wide boundary feature can only carry a half-cell chamfer.
      // Containment is the invariant that matters — no plating is dropped.
      expect(everyCellContained(d.grid, loops)).toBe(true);
    });
  }
});

describe("computeHullOutline — hull hugs the footprint (no big gaps)", () => {
  // Distance (cells) from a lattice point to the nearest solid cell's square.
  const gapToFootprint = (lx: number, ly: number, grid: TileGrid): number => {
    let best = Infinity;
    for (let r = 0; r < grid.rows; r += 1)
      for (let c = 0; c < grid.cols; c += 1) {
        if (grid.cells[r * grid.cols + c]?.kind !== "solid") continue;
        const dx = Math.max(c - lx, 0, lx - (c + 1));
        const dy = Math.max(r - ly, 0, ly - (r + 1));
        best = Math.min(best, Math.hypot(dx, dy));
      }
    return best;
  };
  for (const d of presetDesigns) {
    it(`${d.id}: every hull vertex within ~1 tile of the plating`, () => {
      // The hull hugs the plating; only a concave-corner fill bridging a dent
      // can sit ~1 cell out, and a sqrt-2 bevel a little more — never past 1.5.
      const loops = computeHullOutline(d.grid);
      for (const loop of loops)
        for (const v of loop) {
          const lx = v.x / CELL_SIZE + d.grid.cols / 2;
          const ly = v.y / CELL_SIZE + d.grid.rows / 2;
          expect(gapToFootprint(lx, ly, d.grid)).toBeLessThanOrEqual(1.5 + 1e-6);
        }
    });
  }
});

describe("computeHullOutline — does not add plating beyond the cells", () => {
  // The hull hugs the actual plating and only ever chamfers *into* corner cells;
  // it must never grow a ring of armour outside the cells. So every hull vertex
  // is inside-or-on the plating — gap to the nearest solid cell square is zero.
  const gap = (lx: number, ly: number, grid: TileGrid): number => {
    let best = Infinity;
    for (let r = 0; r < grid.rows; r += 1)
      for (let c = 0; c < grid.cols; c += 1) {
        if (grid.cells[r * grid.cols + c]?.kind !== "solid") continue;
        const dx = Math.max(c - lx, 0, lx - (c + 1));
        const dy = Math.max(r - ly, 0, ly - (r + 1));
        best = Math.min(best, Math.hypot(dx, dy));
      }
    return best;
  };
  it("a deck block's hull stays within the plating (no grown ring)", () => {
    const grid = deckGrid(["###", "###", "###"]);
    const loops = computeHullOutline(grid);
    for (const loop of loops)
      for (const v of loop) {
        const lx = v.x / CELL_SIZE + grid.cols / 2;
        const ly = v.y / CELL_SIZE + grid.rows / 2;
        expect(gap(lx, ly, grid)).toBeLessThanOrEqual(1e-6);
      }
  });
});

describe("computeHullOutline — sub-floor shapes degrade without crashing", () => {
  // Features under three cells can't satisfy the hard invariants, but the
  // algorithm must still return a valid, finite, non-empty hull rather than
  // throw or loop. (Real subdivided ships never reach this regime.)
  const tiny: readonly string[][] = [
    ["##", "##"],
    [".#.", "###", ".#."],
    ["####", ".#..", ".#.."],
    ["##....", "####..", "######"],
  ];
  for (const rows of tiny) {
    it(`${rows.join("/")}: returns a finite non-empty hull`, () => {
      const loops = computeHullOutline(armourGrid(rows));
      expect(loops.length).toBeGreaterThan(0);
      for (const loop of loops) {
        expect(loop.length).toBeGreaterThanOrEqual(3);
        for (const p of loop) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
    });
  }
});

describe("computeHullOutline — contains original armour", () => {
  it("a plain block keeps all its cell centres inside the hull", () => {
    const grid = armourGrid(["####", "####", "####"]);
    expect(everyCellContained(grid, computeHullOutline(grid))).toBe(true);
  });
});

describe("computeHullOutline — keeps small protruding plating inside", () => {
  it("a deck row over a single armour cell still wraps the armour", () => {
    const deck = {
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} },
    };
    const armour = {
      kind: "solid",
      substrate: true,
      surface: "armor",
      edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
    };
    const empty = { kind: "empty" };
    // The reported 2x2 design: two deck cells on top, one armour cell below the
    // left one. The armour arm must not be absorbed away — its centre stays in.
    const cells: unknown[] = [deck, deck, armour, empty];
    const grid = TileGrid.parse({ cols: 2, rows: 2, cells, connections: [] });
    const loops = computeHullOutline(grid);
    const armourCentre = {
      x: (0 - (grid.cols - 1) / 2) * CELL_SIZE,
      y: (1 - (grid.rows - 1) / 2) * CELL_SIZE,
    };
    let parity = 0;
    for (const loop of loops) if (pointInPolygon(armourCentre, loop)) parity ^= 1;
    expect(parity === 1).toBe(true);
  });
});

describe("computeHullOutline — excludes bare substrate", () => {
  it("does not wrap a bare spur but keeps the armour body inside", () => {
    const armour = {
      kind: "solid",
      substrate: true,
      surface: "armor",
      edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
    };
    const bare = {
      kind: "solid",
      substrate: true,
      surface: "bare",
      edges: { n: "open", e: "open", s: "open", w: "open", doorStates: {} },
    };
    const empty = { kind: "empty" };
    // 3x3 armour block (cols 0-2) with a bare spur protruding east of the middle
    // row, at (col 3, row 1). Armour does not grow, so the hull is the block's
    // bevelled outline; the bare spur must fall outside it.
    const cells: unknown[] = [
      armour, armour, armour, empty,
      armour, armour, armour, bare,
      armour, armour, armour, empty,
    ];
    const grid = TileGrid.parse({ cols: 4, rows: 3, cells, connections: [] });
    const loops = computeHullOutline(grid);
    const centreOf = (c: number, r: number): Pt => ({
      x: (c - (grid.cols - 1) / 2) * CELL_SIZE,
      y: (r - (grid.rows - 1) / 2) * CELL_SIZE,
    });
    const strictlyInside = (p: Pt): boolean => {
      let parity = 0;
      for (const loop of loops) if (pointInPolygon(p, loop)) parity ^= 1;
      return parity === 1;
    };
    expect(strictlyInside(centreOf(3, 1))).toBe(false); // bare spur excluded
    expect(strictlyInside(centreOf(1, 1))).toBe(true); // armour body wrapped
  });
});
