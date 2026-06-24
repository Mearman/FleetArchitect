/**
 * Test-only helpers for reading the binary (typed-array) cell state produced by
 * the snapshot. Production code reads cells via {@link renderCells} which
 * reconstructs named fields; tests that just want a sum of HP, an alive count,
 * or a single cell's HP read the typed arrays directly through these small
 * helpers to avoid repeating the array-walk boilerplate per test file.
 */

/** Sum every cell's substrate HP in the typed-array cell state. */
export function sumCellHp(cells: { cellHp: Float64Array<ArrayBuffer> } | undefined): number {
  if (cells === undefined) return 0;
  let sum = 0;
  const hp = cells.cellHp;
  for (let i = 0; i < hp.length; i += 1) {
    sum += hp[i] ?? 0;
  }
  return sum;
}

/** The number of cells flagged alive (non-zero) in the typed-array state. */
export function countAlive(cells: { cellAlive: Uint8Array<ArrayBuffer> } | undefined): number {
  if (cells === undefined) return 0;
  let count = 0;
  const alive = cells.cellAlive;
  for (let i = 0; i < alive.length; i += 1) {
    if (alive[i] !== 0) count += 1;
  }
  return count;
}

/** True when at least one cell is flagged dead (zero) in the typed-array state. */
export function hasDeadCell(cells: { cellAlive: Uint8Array<ArrayBuffer> } | undefined): boolean {
  if (cells === undefined) return false;
  const alive = cells.cellAlive;
  for (let i = 0; i < alive.length; i += 1) {
    if (alive[i] === 0) return true;
  }
  return false;
}

/** The HP of the cell at index `idx`, or undefined when out of range. */
export function cellHpAt(cells: { cellHp: Float64Array<ArrayBuffer> } | undefined, idx: number): number | undefined {
  if (cells === undefined) return undefined;
  return cells.cellHp[idx];
}

/** The alive flag of the cell at index `idx`, or undefined when out of range. */
export function cellAliveAt(cells: { cellAlive: Uint8Array<ArrayBuffer> } | undefined, idx: number): boolean | undefined {
  if (cells === undefined) return undefined;
  const v = cells.cellAlive[idx];
  return v === undefined ? undefined : v !== 0;
}
