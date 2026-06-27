import type { BattleFrame } from "@/schema/battle";
import { FONT_MONO } from "@/ui/theme/tokens";
import type { DescriptorMap } from "@/ui/cellLayout";

import type { Transform } from "./battleCamera";

/**
 * Formation grouping for the battle canvas (Phase E replay cosmetics).
 *
 * Ships deployed in a formation share a deterministic colour derived from their
 * formation id, so a viewer can read the fleet's sub-structure at a glance — a
 * vanguard cluster reads as one hue, a carrier screen as another — while the
 * side-allegiance ring (drawn separately, in the side colour) keeps
 * attacker/defender legible. Each formation's centroid is marked with a subtle
 * ring and, when the leaf formation authored a role label, that label.
 *
 * This layer is render-only: it reads formation identity from the per-battle
 * ship descriptors (carried once on the {@link BattleResult}, never on a frame)
 * and draws into the canvas. It touches no battle data and no cache key. A ship
 * whose descriptor carries no `formationId` is skipped entirely, so a pre-formation
 * battle renders byte-identically to before.
 */

/**
 * Curated formation palette — eight muted-neon hues chosen to sit alongside the
 * phosphor-amber / neon-cyan side colours without clashing, and to stay
 * mutually distinct under the dark backdrop. A formation picks one entry
 * deterministically from a hash of its id, so the same formation identity always
 * renders the same colour across battles, across renderer instances, and across
 * frames (the colour is stable for the whole battle).
 */
const FORMATION_PALETTE_SIZE = 8;

function formationPaletteColour(index: number): string {
  // `index` is reduced modulo FORMATION_PALETTE_SIZE by the caller, so every
  // case below is reachable; the default satisfies exhaustiveness for the
  // unbounded `number` and fails loudly rather than silently if the invariant
  // ever breaks.
  switch (index) {
    case 0:
      return "#5fb8ff";
    case 1:
      return "#ff6a5a";
    case 2:
      return "#5aff8c";
    case 3:
      return "#ffae42";
    case 4:
      return "#c06bff";
    case 5:
      return "#ff6bd6";
    case 6:
      return "#5ad7c8";
    case 7:
      return "#d6d65a";
    default:
      throw new Error(`formation palette index out of range: ${index}`);
  }
}

/** FNV-style string hash reduced onto the palette range. Deterministic across
 *  runs and platforms (Math.imul is 32-bit multiply; the rest is integer math). */
function formationPaletteIndex(formationId: string): number {
  let h = 0;
  for (let i = 0; i < formationId.length; i += 1) {
    h = (Math.imul(h, 31) + formationId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % FORMATION_PALETTE_SIZE;
}

/**
 * The deterministic display colour for one formation id. Pure — the same id
 * always yields the same colour — so callers can re-derive it freely; the
 * per-battle memo ({@link buildFormationColourByInstance}) exists only to keep
 * the hot per-ship-per-frame path off the hash.
 */
export function formationColour(formationId: string): string {
  return formationPaletteColour(formationPaletteIndex(formationId));
}

/**
 * Build the instance-id → formation-colour map for one battle. Computed once
 * per battle (descriptors are emitted once and never mutate), so the draw loop
 * looks the colour up by instance id rather than re-hashing per ship per frame.
 * Entries exist only for ships whose descriptor carries a `formationId`.
 */
export function buildFormationColourByInstance(descriptors: DescriptorMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const [instanceId, descriptor] of descriptors) {
    if (descriptor.formationId !== undefined) {
      map.set(instanceId, formationColour(descriptor.formationId));
    }
  }
  return map;
}

/** Screen-space radius of the formation centroid ring, independent of zoom so
 *  the marker stays legible whether the camera is zoomed in or auto-fit. */
const CENTROID_RING_RADIUS_PX = 9;
/** Vertical offset (screen px) of the role label above the centroid ring. */
const CENTROID_LABEL_OFFSET_PX = 12;

/** The minimal slice of a per-tick ship row the centroid grouping reads. Kept
 *  structural so the pure grouping helper is testable without building a full
 *  {@link ShipSnapshot}/{@link BattleFrame}, and so any frame-shaped value the
 *  renderer already holds satisfies it. */
interface FormationShipRow {
  instanceId: string;
  x: number;
  y: number;
  alive: boolean;
}

/** One formation's resolved centroid for a frame. */
export interface FormationCentroid {
  formationId: string;
  /** Mean world position of the formation's alive ships this frame. */
  x: number;
  y: number;
  /** The leaf formation's authored role label, when it has one. */
  role: string | undefined;
}

/**
 * Group a frame's ships by formation and resolve each formation's centroid
 * (mean world position of its alive ships) plus its role label. Pure — no
 * canvas, no side effects — so the grouping is unit-testable directly. Ships
 * whose descriptor carries no formation id, and dead ships, are skipped, so a
 * pre-formation battle yields an empty list (no centroids to draw).
 */
export function formationCentroids(
  ships: ReadonlyArray<FormationShipRow>,
  descriptors: DescriptorMap,
): FormationCentroid[] {
  // Accumulate per-formation world-position sums in insertion order; a Map
  // keyed by formation id gives O(alive ships) grouping with no sort.
  const sums = new Map<
    string,
    { xSum: number; ySum: number; count: number; role: string | undefined }
  >();
  for (const ship of ships) {
    if (!ship.alive) continue;
    const descriptor = descriptors.get(ship.instanceId);
    if (descriptor === undefined || descriptor.formationId === undefined) continue;
    const formationId = descriptor.formationId;
    const acc = sums.get(formationId);
    if (acc === undefined) {
      sums.set(formationId, {
        xSum: ship.x,
        ySum: ship.y,
        count: 1,
        role: descriptor.role,
      });
    } else {
      acc.xSum += ship.x;
      acc.ySum += ship.y;
      acc.count += 1;
    }
  }

  const out: FormationCentroid[] = [];
  for (const [formationId, acc] of sums) {
    out.push({
      formationId,
      x: acc.xSum / acc.count,
      y: acc.ySum / acc.count,
      role: acc.role,
    });
  }
  return out;
}

/**
 * Draw a subtle ring (and, when the formation has a role label, that label) at
 * each formation's live centroid. Called once per frame from the main draw
 * callback, over the ship layer at low alpha so the grouping reads without
 * obscuring hulls. The grouping is computed by the pure {@link formationCentroids}
 * helper; this function only projects and paints.
 */
export function drawFormationCentroids(
  ctx: CanvasRenderingContext2D,
  transform: Transform,
  frame: BattleFrame,
  descriptors: DescriptorMap,
): void {
  const centroids = formationCentroids(frame.ships, descriptors);
  if (centroids.length === 0) return;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${10}px ${FONT_MONO}`;
  for (const centroid of centroids) {
    const screen = transform.project(centroid.x, centroid.y);
    const colour = formationColour(centroid.formationId);

    // Centroid ring: a thin, low-alpha outline circle in the formation colour.
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, CENTROID_RING_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();

    // Role label: drawn only when the leaf formation authored one, so an
    // unlabelled formation shows just the ring.
    if (centroid.role !== undefined) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = colour;
      ctx.fillText(centroid.role, screen.x, screen.y - CENTROID_LABEL_OFFSET_PX);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
