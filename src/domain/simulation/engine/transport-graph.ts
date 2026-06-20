/**
 * Cell-graph builders for the transport-field primitive.
 *
 * The transport field is agnostic to how its `TransportFace[]` was built; these
 * helpers construct the common case — a rectangular region of the 1 m
 * ship-local grid — so the three substance modules share one graph factory
 * rather than each rolling their own. A face between two interior cells is
 * `open` iff both cells are walkable and the edge between them is open
 * (passed in as a predicate); the perimeter carries `boundary: true` faces
 * for the radiator / vent / exhaust fluxes to act on.
 */

import type { TransportFace } from "@/domain/simulation/engine/transport-field";
import { TRANSPORT_GEOMETRY } from "@/domain/simulation/engine/transport-field";
import { pipeKey } from "@/domain/simulation/engine/propellant";
import type { VentMask } from "@/domain/simulation/engine/lifesupport";

/** Result of building a rectangular transport graph: the flat face list,
 *  a pre-built per-cell face index, the boundary cell indices, and the
 *  open interior face pair set for propellant pipe routing. */
export interface RectangularTransportGraph {
  faces: TransportFace[];
  /** Pre-built per-cell face index: `facesFrom[cell]` lists every face whose
   *  `from` equals `cell`. Built once at graph construction, passed into
   *  `TransportField.facesFrom` so `stepTransportField` need not rebuild it
   *  on every substance call. */
  facesFrom: readonly TransportFace[][];
  boundaryCells: number[];
  /** Pre-built boundary cell Set for O(1) membership tests. Built once so
   *  the per-tick resource step avoids rebuilding `new Set(boundaryCells)`. */
  boundaryCellSet: ReadonlySet<number>;
  /** Pre-built set of open interior face pair keys (numeric, via `pipeKey`),
   *  used by the propellant substance to identify pipe segments. Built once
   *  so the per-tick resource step avoids rebuilding it from faces. */
  openInteriorPipes: ReadonlySet<number>;
  /** Per-cell vent mask: deck cells exposed to vacuum by a hull breach (an
   *  open edge or open door now leading to a dead or absent neighbour cell),
   *  mapped to the net outward vent normal. Empty for an intact, sealed hull;
   *  rebuilt with the graph on every topology change (a cell death opens new
   *  breaches). The atmosphere substance reads it to vent gas — and recoil the
   *  hull — through the breach, and the resource step reads it to expose crew
   *  in a breached cell to vacuum. */
  ventMask: VentMask;
}

/**
 * Build a transport graph for a `cols × rows` rectangular region of the 1 m
 * grid. Every cell is treated as a transport node (index = row * cols + col);
 * horizontal and vertical adjacency produce interior faces. `passable`
 * decides whether a given interior edge is open (open edge / open door) or
 * closed (wall / closed door). Perimeter faces are marked `boundary: true`
 * with no neighbour, so substance boundary fluxes (radiators, vents,
 * exhausts) can act on them.
 *
 * `boundarySide` selects which perimeter sides carry boundary faces; by
 * default all four do. Substances that only vent through a specific face
 * (e.g. a radiator panel on one hull side) pass a narrower predicate.
 */
export function buildRectangularGraph(
  cols: number,
  rows: number,
  passable: (a: number, b: number) => boolean,
  boundarySide: (cell: number, side: "n" | "e" | "s" | "w") => boolean =
    () => true,
): RectangularTransportGraph {
  const faces: TransportFace[] = [];
  const boundarySet = new Set<number>();

  const idx = (c: number, r: number): number => r * cols + c;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const here = idx(c, r);

      // East neighbour (interior face) or east boundary.
      if (c + 1 < cols) {
        const there = idx(c + 1, r);
        const open = passable(here, there);
        faces.push({
          from: here,
          to: there,
          nx: 1,
          ny: 0,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open,
          boundary: false,
        });
        faces.push({
          from: there,
          to: here,
          nx: -1,
          ny: 0,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open,
          boundary: false,
        });
      } else if (boundarySide(here, "e")) {
        faces.push({
          from: here,
          to: undefined,
          nx: 1,
          ny: 0,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open: false,
          boundary: true,
        });
        boundarySet.add(here);
      }

      // North neighbour (interior face) or north boundary.
      if (r + 1 < rows) {
        const there = idx(c, r + 1);
        const open = passable(here, there);
        faces.push({
          from: here,
          to: there,
          nx: 0,
          ny: 1,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open,
          boundary: false,
        });
        faces.push({
          from: there,
          to: here,
          nx: 0,
          ny: -1,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open,
          boundary: false,
        });
      } else if (boundarySide(here, "n")) {
        faces.push({
          from: here,
          to: undefined,
          nx: 0,
          ny: 1,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open: false,
          boundary: true,
        });
        boundarySet.add(here);
      }

      // West boundary face.
      if (c === 0 && boundarySide(here, "w")) {
        faces.push({
          from: here,
          to: undefined,
          nx: -1,
          ny: 0,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open: false,
          boundary: true,
        });
        boundarySet.add(here);
      }

      // South boundary face.
      if (r === 0 && boundarySide(here, "s")) {
        faces.push({
          from: here,
          to: undefined,
          nx: 0,
          ny: -1,
          area: TRANSPORT_GEOMETRY.faceAreaM2,
          open: false,
          boundary: true,
        });
        boundarySet.add(here);
      }
    }
  }

  // Deterministic order: ascending cell index.
  const boundaryCells = [...boundarySet].sort((a, b) => a - b);

  // Pre-build per-cell face index once so stepTransportField need not
  // rebuild it on every substance call (called 3 times per ship per tick).
  const n = cols * rows;
  const facesFrom: TransportFace[][] = Array.from({ length: n }, () => []);
  for (const face of faces) {
    const list = facesFrom[face.from];
    if (list !== undefined) list.push(face);
  }

  // Pre-build open interior pipe set for propellant routing (numeric keys).
  const openInteriorPipes = new Set<number>();
  for (const face of faces) {
    if (face.to === undefined || !face.open) continue;
    openInteriorPipes.add(pipeKey(face.from, face.to));
  }

  // Pre-build boundary cell set for O(1) radiator lookups.
  const boundaryCellSet = new Set(boundaryCells);

  // The generic rectangular builder has no per-cell module/edge state, so it
  // cannot derive hull breaches; it returns an empty vent mask. The live
  // sparse builder in `resource-step.ts` computes the real vent mask from the
  // ship's alive-cell topology and edge states.
  const ventMask: VentMask = new Map();

  return { faces, facesFrom, boundaryCells, boundaryCellSet, openInteriorPipes, ventMask };
}
