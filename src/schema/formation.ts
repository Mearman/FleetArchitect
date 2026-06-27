import { z } from "zod";

import { EntityId } from "./primitives";
import { FleetShip } from "./fleet";
import { Doctrine } from "./ai";

/**
 * A composable, nestable grouping of ships — the structural unit of a fleet.
 *
 * A fleet is a single root formation whose children are ships (the atomic leaf
 * — a lone ship needs no wrapping asset), nested sub-formations, or references
 * to a reusable {@link FormationTemplate}. Each formation carries a layout
 * (how its children sit in its local, facing-aligned frame) and an optional
 * doctrine (conditional orders that apply to every descendant). Placement is
 * recursive: the root is anchored at the side's deployment edge and each child
 * is offset in its parent's local frame, so a formation composes the way real
 * squadrons sit inside divisions inside a fleet.
 *
 * Recursive types. `Formation` and `FormationNode` are mutually recursive
 * (a formation's children may be formations). Both are bound with `z.lazy` and
 * a `z.ZodType<T>` annotation — the documented Zod 4 recursion contract, not a
 * type assertion. The lazy getter also defers the `FleetShip` reference past
 * module initialisation, which is what keeps the `fleet.ts ↔ formation.ts`
 * import cycle safe: by the time either schema is first parsed, both modules
 * have finished evaluating.
 */

/**
 * A named arrangement generator for a formation's direct children in its local
 * frame. Patterns are sugar over explicit slot offsets: the resolver expands a
 * pattern into a per-child offset by a parametric formula over child index, and
 * the UI may "bake" a pattern into explicit slots for drag-tuning. `column` is
 * also available as a layout kind so an authored formation can opt back into
 * the legacy column explicitly.
 */
export const PatternKind = z.enum([
  "column",
  "line",
  "wedge",
  "ring",
  "screen",
  "echelon",
]);
export type PatternKind = z.infer<typeof PatternKind>;

/** A child's offset in its parent formation's local frame (metres). `forward`
 *  is along the formation's facing; `lateral` is perpendicular (left positive). */
export const Offset2 = z.object({
  forward: z.number(),
  lateral: z.number(),
});
export type Offset2 = z.infer<typeof Offset2>;

/**
 * How a formation's direct children are arranged in its local frame. Absent
 * (omitted) is equivalent to `column` — the legacy byte-identical deployment
 * path — so a fleet lifted from the legacy flat `ships[]` form resolves exactly
 * as before. `pattern` generates a per-child offset from a named pattern plus
 * spacing; an explicit `slot` on a child node overrides the generated offset
 * (and is what the UI "bakes" a pattern into for drag-tuning). Per-child slots
 * live on {@link FormationNode} rather than a parent map so ship leaves — which
 * have no stable per-instance id — can still be placed individually.
 */
export const FormationLayout = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("column") }),
  z.object({
    kind: z.literal("pattern"),
    pattern: PatternKind,
    spacing: z.number(),
    facingAligned: z.boolean(),
  }),
]);
export type FormationLayout = z.infer<typeof FormationLayout>;

export type FormationNode =
  | { kind: "ship"; ship: FleetShip; slot?: Offset2 }
  | { kind: "formation"; formation: Formation; slot?: Offset2 }
  | { kind: "template"; templateId: string; slot?: Offset2 };

/** A child of a formation: a ship leaf, a nested formation, or a template
 *  reference (expanded to an inline subtree before resolve). `slot` is the
 *  child's offset in its parent's local frame (metres); it overrides any offset
 *  the parent's pattern layout would generate, and is ignored under the column
 *  layout. Recursive (a formation child may itself contain formations). */
export const FormationNode: z.ZodType<FormationNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ship"), ship: FleetShip, slot: Offset2.optional() }),
    z.object({ kind: z.literal("formation"), formation: Formation, slot: Offset2.optional() }),
    z.object({ kind: z.literal("template"), templateId: EntityId, slot: Offset2.optional() }),
  ]),
);

/**
 * A formation node: its identity, optional role label (used as a reference
 * target by doctrine), optional facing override, layout, doctrine, and
 * children. Recursive (children may be formations). A `role` is the
 * human-facing handle doctrine conditions and postures address ("carrier",
 * "vanguard"); it is optional and need not be unique, though the first
 * matching formation in instanceId order resolves a reference.
 */
export type Formation = {
  id: string;
  role?: string;
  facing?: number;
  layout?: FormationLayout;
  doctrine: Doctrine;
  children: FormationNode[];
};

export const Formation: z.ZodType<Formation> = z.lazy(() =>
  z.object({
    id: EntityId,
    role: z.string().optional(),
    facing: z.number().optional(),
    /** Absent === column (legacy byte-identical deployment). */
    layout: FormationLayout.optional(),
    /** Conditional orders for this formation and its descendants. Defaulted so
     *  an absent doctrine parses to "no rules, empty base". */
    doctrine: Doctrine.default({ base: {}, rules: [] }),
    children: z.array(FormationNode),
  }),
);

/**
 * A flat root formation: one whose direct children are ship leaves laid out as
 * the legacy deployment column (no `layout`). This is the shape a lifted legacy
 * fleet resolves to, the shape the fleet builder authors, and the byte-identical
 * column path through the resolver. `id: "root"` is the conventional label for a
 * fleet's top formation (formation ids drive nothing until the doctrine pass).
 */
export function flatFormation(ships: readonly FleetShip[]): Formation {
  return {
    id: "root",
    doctrine: { base: {}, rules: [] },
    children: ships.map((ship) => ({ kind: "ship", ship })),
  };
}

/**
 * Collect every ship leaf of a formation tree in pre-order DFS. The resolver
 * lays these out as the deployment column in this order, so for a flat root
 * formation the result is exactly the legacy `Fleet.ships` array order. The
 * fleet builder also uses it to populate its flat roster from a loaded fleet.
 * `template` nodes are not expanded here — they are inlined into the tree before
 * resolve (see `expandTemplates`), so an unexpanded template node is skipped.
 */
export function flattenShipLeaves(formation: Formation): FleetShip[] {
  const out: FleetShip[] = [];
  const walk = (node: FormationNode): void => {
    if (node.kind === "ship") {
      out.push(node.ship);
    } else if (node.kind === "formation") {
      for (const child of node.formation.children) walk(child);
    }
    // kind === "template": expanded before resolve; nothing to collect here.
  };
  for (const child of formation.children) walk(child);
  return out;
}

/**
 * A ship leaf paired with its formation context: the id of the formation it is
 * a DIRECT child of, the chain of ancestor formation ids from the root down to
 * (and including) that formation, and that formation's authored role (if any).
 * The resolver stamps these onto each resolved {@link CombatShip} so the engine
 * can build per-formation aggregates and resolve role references — the identity
 * the formation-aware runtime reads.
 */
export interface FormationLeaf {
  ship: FleetShip;
  /** Id of the formation this leaf is a direct child of. */
  formationId: string;
  /** Ancestor formation ids from the root down to (and including) the leaf's
   *  parent formation. */
  formationChain: string[];
  /** The leaf's parent formation's authored role, if any. */
  role?: string;
}

/**
 * Walk a formation tree in pre-order DFS, yielding each ship leaf WITH its
 * formation context: {@link formationId} is the id of the formation the leaf is
 * a DIRECT child of; {@link formationChain} is the ancestor formation ids from
 * the root down to that formation (inclusive); {@link role} is that formation's
 * authored role. For a flat root (root formation with ship-leaf children) every
 * leaf gets `formationId === root.id`, `formationChain === [root.id]`, and the
 * root's role.
 *
 * Order matters: the walk is pre-order DFS in child order, so for a flat root
 * of ship leaves the leaf sequence is EXACTLY the {@link flattenShipLeaves}
 * sequence — the resolver's column and every instanceId stay byte-identical to
 * the legacy path. `template` nodes are not expanded here (they are inlined
 * before resolve by `expandTemplates`); an unexpanded template node is skipped,
 * matching `flattenShipLeaves`.
 *
 * Sibling to {@link flattenShipLeaves}: the sharing codec and the battle-URL
 * sync continue to use the lighter `flattenShipLeaves` (they need only the
 * ships), while the resolver migrates to this richer walker to pick up
 * formation identity.
 */
export function collectFormationLeaves(formation: Formation): FormationLeaf[] {
  const out: FormationLeaf[] = [];
  const walk = (
    node: FormationNode,
    chain: readonly string[],
    role: string | undefined,
  ): void => {
    if (node.kind === "ship") {
      // The leaf's parent formation is the last id in `chain`; the chain runs
      // root → … → parent (inclusive); `role` is the parent formation's role.
      const formationId = chain[chain.length - 1];
      if (formationId === undefined) return;
      out.push({
        ship: node.ship,
        formationId,
        formationChain: [...chain],
        role,
      });
    } else if (node.kind === "formation") {
      // Descend: extend the chain with this formation's id and rebind the role
      // to this formation's role for ITS direct ship-leaf children.
      const nextChain = [...chain, node.formation.id];
      for (const child of node.formation.children) {
        walk(child, nextChain, node.formation.role);
      }
    }
    // kind === "template": expanded before resolve; nothing to collect here.
  };
  const rootChain = [formation.id];
  for (const child of formation.children) {
    walk(child, rootChain, formation.role);
  }
  return out;
}
