/**
 * UI-side formation layout: generate per-child slot offsets from a pattern, and
 * resolve a formation tree to preview world positions for the spatial drag-canvas.
 *
 * The engine does NOT yet consume the `pattern` layout (it deploys the legacy
 * column via `resolveFleetToCombatShips`). These helpers exist so the fleet
 * builder can show a what-you-see-is-what-battles preview of the AUTHORED layout
 * — pattern offsets, explicit slots, and nested formation frames — and so a
 * player can "bake" a pattern into explicit slots for drag-tuning. When the
 * engine later consumes patterns, the formula here should match the engine's
 * resolver; for now it is the canonical preview.
 *
 * Pure and deterministic: every function is a pure function of its inputs, so
 * the preview is stable across renders and identical for the same tree.
 */

import type {
  Formation,
  FormationLayout,
  FormationNode,
  Offset2,
  PatternKind,
} from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import type { FleetShip } from "@/schema/fleet";

/** Origin offset — no displacement. */
const ZERO: Offset2 = { forward: 0, lateral: 0 };

/**
 * The per-child offset a pattern generates for child `index` of `count`, in the
 * parent formation's facing-aligned local frame (`forward` along facing,
 * `lateral` perpendicular, left positive). `spacing` is in metres.
 *
 * Each pattern is a parametric formula over child index — the same definition
 * the schema documents. The formulas are chosen so a small group reads as the
 * named shape at a glance on the preview canvas:
 *
 *  - `column`  — a lateral line (ships abreast across the facing axis).
 *  - `line`    — a forward line (ships in trail behind the point).
 *  - `wedge`   — an apex-forward diagonal (each child steps forward and out).
 *  - `ring`    — a circle around the reference (spacing is the radius).
 *  - `screen`  — a forward line thrown ahead of the body (a picket).
 *  - `echelon` — a staggered diagonal stair-step.
 *
 * A group of one resolves to the origin (no displacement), so a lone child sits
 * on its parent's position regardless of pattern.
 */
export function patternOffset(
  kind: PatternKind,
  spacing: number,
  index: number,
  count: number,
): Offset2 {
  if (count <= 1) return ZERO;
  const centre = (count - 1) / 2;
  const i = index - centre;
  switch (kind) {
    case "column":
      return { forward: 0, lateral: i * spacing };
    case "line":
      return { forward: i * spacing, lateral: 0 };
    case "wedge":
      // Apex forward: each child steps forward and out by the same amount.
      return { forward: (index < centre ? 0 : (index - centre) * spacing), lateral: i * spacing };
    case "ring": {
      // spacing is the radius; children distributed evenly around the circle.
      const angle = (index / count) * Math.PI * 2;
      return { forward: Math.cos(angle) * spacing, lateral: Math.sin(angle) * spacing };
    }
    case "screen":
      // A picket line thrown a fixed distance ahead of the body.
      return { forward: spacing, lateral: i * spacing * 1.5 };
    case "echelon":
      // Staggered diagonal: forward and lateral both step with index.
      return { forward: index * spacing, lateral: i * spacing * 0.5 };
    default:
      // Exhaustiveness: an unknown pattern falls back to no displacement rather
      // than placing a child somewhere arbitrary.
      return ZERO;
  }
}

/**
 * The layout a formation resolves to, with `undefined` treated as `column` (the
 * legacy byte-identical deployment path — the schema's documented default).
 */
function effectiveLayout(layout: FormationLayout | undefined): FormationLayout {
  return layout ?? { kind: "column" };
}

/**
 * The offset for one child of a formation: the child's explicit `slot` if it
 * carries one (it overrides any pattern), otherwise the pattern-generated
 * offset. A `column` parent always yields a lateral line (no pattern).
 */
export function childOffset(
  node: FormationNode,
  layout: FormationLayout | undefined,
  index: number,
  count: number,
): Offset2 {
  if (node.slot !== undefined) return node.slot;
  const eff = effectiveLayout(layout);
  if (eff.kind === "column") return patternOffset("column", 0, index, count);
  return patternOffset(eff.pattern, eff.spacing, index, count);
}

/**
 * Rotate a facing-aligned local offset (forward, lateral) into the parent frame
 * by the parent's facing (radians). Returns a world-relative (x, y) delta. The
 * local frame's `forward` axis aligns with the facing direction; positive
 * `lateral` is 90 degrees left of facing. With facing `f`, a local (forward F,
 * lateral L) maps to world (F·cos f − L·sin f, F·sin f + L·cos f) — but because
 * screen y grows downward and the legacy column runs along y, we keep this as a
 * pure rotation and let the caller decide the screen mapping.
 */
export function rotateOffset(offset: Offset2, facing: number): Offset2 {
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return {
    forward: offset.forward * cos - offset.lateral * sin,
    lateral: offset.forward * sin + offset.lateral * cos,
  };
}

/** A previewed leaf: the ship, its formation identity for colouring, its
 *  resolved position relative to the root formation's origin (metres), and the
 *  leaf's authored path (for drag-to-commit-slot). `path` is undefined for leaves
 *  inside an inlined template reference — those positions are shown for preview
 *  but are not directly authorable (edit the template instead).
 *
 *  The parent transform (`parentFacing`, `parentX`, `parentY`) is the formation
 *  frame the leaf's slot is expressed in; the canvas inverts it to convert a
 *  world-space cursor delta into the parent's local slot on drag. */
export interface PreviewLeaf {
  /** Stable path key (the chain of child indices from root to this leaf). */
  pathKey: string;
  ship: FleetShip;
  /** Id of the formation this leaf is a direct child of — used for colour. */
  formationId: string;
  /** The leaf's resolved position relative to the root origin (metres). */
  x: number;
  y: number;
  /** The leaf's authored path (chain of child indices from the root), or
   *  undefined when the leaf sits inside an inlined template reference (not
   *  directly draggable — edit the template to move it). */
  path: readonly number[] | undefined;
  /** The parent formation's facing (radians) at this leaf — the frame the slot
   *  is expressed in. */
  parentFacing: number;
  /** The parent formation's world position (metres) the leaf's slot is relative
   *  to. */
  parentX: number;
  parentY: number;
}

/**
 * Resolve a formation tree to its preview leaves: every ship leaf WITH its
 * resolved position relative to the root origin, its formation identity, and its
 * authored path. Walks the tree in pre-order DFS, accumulating each child's
 * offset (rotated by its parent's facing) into a running world position.
 *
 * `template` nodes are inlined from `templates` for display (advisory — a
 * missing template is skipped). Leaves inside an inlined template carry
 * `path: undefined` because their positions are governed by the template, not
 * the fleet tree; the canvas renders them but does not allow drag-tuning (the
 * player edits the template to move them).
 *
 * The root formation is placed at the origin; its children are laid out by its
 * own layout. This is the same composition the engine will eventually resolve,
 * rendered head of the deployment so the player can see the authored geometry.
 */
export function previewLeaves(
  formation: Formation,
  templates: ReadonlyMap<string, FormationTemplate>,
): PreviewLeaf[] {
  const out: PreviewLeaf[] = [];
  const walk = (
    children: readonly FormationNode[],
    layout: FormationLayout | undefined,
    parentFacing: number,
    parentX: number,
    parentY: number,
    formationId: string,
    pathPrefix: string,
    pathPrefixPath: readonly number[] | undefined,
    visited: ReadonlySet<string>,
  ): void => {
    // Build the effective children, inlining `template` nodes from the table.
    // A template's formation descends with `pathPrefixPath = undefined` so its
    // leaves are shown but not draggable; a cycle or missing template is skipped.
    type Effective = { node: FormationNode; inline: Formation | undefined };
    const effective: Effective[] = [];
    for (const child of children) {
      if (child.kind !== "template") {
        effective.push({ node: child, inline: undefined });
        continue;
      }
      if (visited.has(child.templateId)) continue; // cycle — stop descending.
      const template = templates.get(child.templateId);
      if (template === undefined) continue; // missing — shown as a badge elsewhere.
      effective.push({ node: child, inline: template.formation });
    }
    const count = effective.length;
    effective.forEach((entry, index) => {
      const child = entry.node;
      const offset = childOffset(child, layout, index, count);
      const rotated = rotateOffset(offset, parentFacing);
      // Local frame: forward → world x, lateral → world y (matches the legacy
      // column running along y when facing is 0).
      const x = parentX + rotated.forward;
      const y = parentY + rotated.lateral;
      const pathKey = `${pathPrefix}>${index}`;
      const childPath =
        pathPrefixPath === undefined ? undefined : [...pathPrefixPath, index];
      if (child.kind === "ship") {
        out.push({
          pathKey,
          ship: child.ship,
          formationId,
          x,
          y,
          path: childPath,
          parentFacing,
          parentX,
          parentY,
        });
        return;
      }
      if (child.kind === "formation") {
        const facing = child.formation.facing ?? parentFacing;
        walk(
          child.formation.children,
          child.formation.layout,
          facing,
          x,
          y,
          child.formation.id,
          pathKey,
          childPath,
          visited,
        );
        return;
      }
      // kind === "template": descend into the inlined formation. The template's
      // descendants are NOT authorable, so pathPrefixPath becomes undefined.
      if (entry.inline !== undefined) {
        const nextVisited = new Set(visited);
        nextVisited.add(child.templateId);
        const facing = entry.inline.facing ?? parentFacing;
        walk(
          entry.inline.children,
          entry.inline.layout,
          facing,
          x,
          y,
          entry.inline.id,
          pathKey,
          undefined,
          nextVisited,
        );
      }
    });
  };
  walk(
    formation.children,
    formation.layout,
    formation.facing ?? 0,
    0,
    0,
    formation.id,
    formation.id,
    [],
    new Set(),
  );
  return out;
}

/**
 * Apply a pattern to a formation's children by baking each child's pattern-
 * generated offset into an explicit `slot` on the child node. Returns a new
 * children array with slots set; a child that already has an explicit slot is
 * left untouched (the player authored it deliberately). This is the "bake"
 * operation the pattern buttons trigger so the player can then drag-tune.
 */
export function bakePattern(
  children: readonly FormationNode[],
  layout: FormationLayout,
): FormationNode[] {
  if (layout.kind !== "pattern") return [...children];
  const count = children.length;
  return children.map((child, index) => {
    if (child.slot !== undefined) return child;
    return { ...child, slot: patternOffset(layout.pattern, layout.spacing, index, count) };
  });
}

/**
 * Apply a pattern to a formation's children, REPLACING every existing explicit
 * slot with the pattern-generated offset. Used when the player picks a pattern
 * button on the canvas: the new pattern's offsets overwrite any prior manual
 * tuning for that formation's direct children.
 */
export function applyPattern(
  children: readonly FormationNode[],
  layout: FormationLayout,
): FormationNode[] {
  if (layout.kind !== "pattern") return [...children];
  const count = children.length;
  return children.map((child, index) => ({
    ...child,
    slot: patternOffset(layout.pattern, layout.spacing, index, count),
  }));
}
