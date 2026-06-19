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

/** Result of building a rectangular transport graph: the flat face list and
 *  the indices of cells that touch the outer hull (the boundary cells). */
export interface RectangularTransportGraph {
  faces: TransportFace[];
  boundaryCells: number[];
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
  return { faces, boundaryCells };
}
