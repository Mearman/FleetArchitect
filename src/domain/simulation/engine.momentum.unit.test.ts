import { describe, expect, it } from "vitest";
import { comTangentialVelocity } from "@/domain/simulation/engine";

/**
 * Break-apart momentum conservation.
 *
 * When a spinning, translating rigid body splits along its structure, each
 * fragment must fly off carrying exactly the momentum it already had as part
 * of the whole — no momentum is created or destroyed by the break. The engine
 * implements this by keeping every fragment's angular velocity ω verbatim and
 * setting its linear (centre-of-mass) velocity to
 *
 *     v_fragment = v_parent + ω × (fragmentCoM − parentCoM)
 *
 * via `comTangentialVelocity`, with the CoM offset rotated by the body facing
 * into world axes (engine.ts:makeChunkShip / applyMomentumSplitToSurvivor).
 *
 * This test reconstructs a small rigid body as a set of point-mass cells,
 * splits it into fragments using that exact formula, and asserts that BOTH the
 * total linear momentum (Σ mᵢ·vᵢ) and the total angular momentum about the
 * original centre of mass (Σ mᵢ·(rᵢ × vᵢ)) are identical before and after the
 * split — the definition of a momentum-conserving break.
 */

interface Cell {
  mass: number;
  /** Ship-local position. */
  lx: number;
  ly: number;
}

/** Mass-weighted centre of mass of a cell set, in local coordinates. */
function centreOfMass(cells: readonly Cell[]): { x: number; y: number } {
  let m = 0;
  let mx = 0;
  let my = 0;
  for (const c of cells) {
    m += c.mass;
    mx += c.mass * c.lx;
    my += c.mass * c.ly;
  }
  return { x: mx / m, y: my / m };
}

/** Rotate a local vector by the body facing into world axes. */
function toWorld(facing: number, lx: number, ly: number): { x: number; y: number } {
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  return { x: lx * c - ly * s, y: lx * s + ly * c };
}

/**
 * World velocity of a single cell belonging to a rigid body whose centre of
 * mass moves at (vx, vy) and which spins at ω about that centre of mass:
 * v_cell = v_cm + ω × (r_cell − r_cm), the cross product taken in world axes.
 */
function cellWorldVelocity(
  facing: number,
  omega: number,
  bodyVelX: number,
  bodyVelY: number,
  bodyComLx: number,
  bodyComLy: number,
  cell: Cell,
): { vx: number; vy: number } {
  const r = toWorld(facing, cell.lx - bodyComLx, cell.ly - bodyComLy);
  return { vx: bodyVelX + -omega * r.y, vy: bodyVelY + omega * r.x };
}

/** Total linear momentum and angular momentum (about a world reference point)
 *  of a set of cells given each cell's world velocity. */
function momenta(
  facing: number,
  refLx: number,
  refLy: number,
  cells: readonly Cell[],
  velocityOf: (cell: Cell) => { vx: number; vy: number },
): { px: number; py: number; angular: number } {
  let px = 0;
  let py = 0;
  let angular = 0;
  const ref = toWorld(facing, refLx, refLy);
  for (const c of cells) {
    const v = velocityOf(c);
    px += c.mass * v.vx;
    py += c.mass * v.vy;
    // Position of the cell in world axes, relative to the reference CoM.
    const r = toWorld(facing, c.lx, c.ly);
    const rx = r.x - ref.x;
    const ry = r.y - ref.y;
    angular += c.mass * (rx * v.vy - ry * v.vx);
  }
  return { px, py, angular };
}

describe("engine.momentum break-apart conservation", () => {
  it("conserves total linear and angular momentum across a spinning split", () => {
    // A 2x2 body of four unequal point masses, deliberately off-origin so the
    // parent CoM is not at (0,0). Body is translating AND spinning at a
    // non-trivial facing so the rotation into world axes is exercised.
    const cells: Cell[] = [
      { mass: 4, lx: -10, ly: -10 },
      { mass: 1, lx: 10, ly: -10 },
      { mass: 3, lx: -10, ly: 10 },
      { mass: 2, lx: 10, ly: 10 },
    ];
    const facing = 0.7;
    const omega = 0.25;
    const bodyVelX = 1.5;
    const bodyVelY = -0.8;

    const parentCom = centreOfMass(cells);

    // Before: every cell's world velocity as part of the single rigid body.
    const before = momenta(facing, parentCom.x, parentCom.y, cells, (c) =>
      cellWorldVelocity(facing, omega, bodyVelX, bodyVelY, parentCom.x, parentCom.y, c),
    );

    // Split into two arbitrary fragments (left column / right column).
    const fragA = cells.filter((c) => c.lx < 0);
    const fragB = cells.filter((c) => c.lx > 0);

    // Each fragment keeps ω and gets its CoM-tangential linear velocity from the
    // engine's own formula, measured from the parent CoM.
    const comA = centreOfMass(fragA);
    const comB = centreOfMass(fragB);
    const velA = comTangentialVelocity(
      facing,
      omega,
      bodyVelX,
      bodyVelY,
      comA.x - parentCom.x,
      comA.y - parentCom.y,
    );
    const velB = comTangentialVelocity(
      facing,
      omega,
      bodyVelX,
      bodyVelY,
      comB.x - parentCom.x,
      comB.y - parentCom.y,
    );

    // After: each cell's world velocity as part of its fragment, which spins at
    // ω about its own CoM and translates at the fragment CoM velocity.
    const cellVelAfter = (c: Cell): { vx: number; vy: number } => {
      if (c.lx < 0) {
        return cellWorldVelocity(facing, omega, velA.vx, velA.vy, comA.x, comA.y, c);
      }
      return cellWorldVelocity(facing, omega, velB.vx, velB.vy, comB.x, comB.y, c);
    };
    const after = momenta(facing, parentCom.x, parentCom.y, cells, cellVelAfter);

    // Momentum is conserved to floating-point precision.
    expect(after.px).toBeCloseTo(before.px, 10);
    expect(after.py).toBeCloseTo(before.py, 10);
    expect(after.angular).toBeCloseTo(before.angular, 10);

    // Sanity: the body really was spinning (non-zero angular momentum), so the
    // test isn't trivially passing on a non-rotating body.
    expect(Math.abs(before.angular)).toBeGreaterThan(0);
  });

  it("a non-spinning split gives every fragment the parent velocity unchanged", () => {
    // With ω = 0 there is no tangential term: each fragment simply inherits the
    // parent's linear velocity, regardless of where its CoM sits.
    const v = comTangentialVelocity(1.2, 0, 3, -4, 25, -17);
    expect(v.vx).toBe(3);
    expect(v.vy).toBe(-4);
  });
});
