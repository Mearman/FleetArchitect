/**
 * Inline every `template` formation node in a fleet's tree, deep-cloning the
 * referenced {@link FormationTemplate}'s formation subtree in its place. Pure
 * and deterministic: the result is a function only of `(fleet, templates)`, so
 * two runs over the same inputs produce the same expanded tree.
 *
 * Why this is a separate pre-resolve pass. A `template` node is a *reference*
 * (by id) to a reusable subtree owned elsewhere; the engine and the resolver
 * work on a concrete tree of ship leaves and formations, so the reference must
 * be replaced by its referent before either sees it. Doing it here — at the
 * schema layer, before resolve — keeps the resolver single-shaped (it never
 * encounters a template node) and keeps the template id out of the battle
 * cache key entirely (only the resolved, inlined tree reaches the key).
 *
 * Deterministic id minting. A template may be referenced more than once in a
 * fleet (two squadrons built off the same formation asset). If both instances
 * kept the template's authored formation ids, the two subtrees' ids would
 * collide — every formation id in a fleet must be unique (the doctrine pass
 * resolves role references against it). So each inlined copy has its formation
 * ids rewritten into a deterministic, path-rooted namespace: the template's
 * subtree formation at tree-path `root>div#3>squad#1` gets every one of its
 * formation ids prefixed `root>div#3>squad#1#`, making every id unique and
 * stable across runs (the path is a pure function of the tree). The `#`
 * delimiter is chosen so a prefixed id reads as `<owner-path>#<original-id>`
 * and never collides with an authored id (which cannot contain `>` or `#`).
 *
 * Recursion and cycle safety. A template's formation may itself contain
 * template nodes (composition). Expansion recurses, carrying the accumulated
 * namespace prefix and a visited set of template ids on the current expansion
 * stack. A cycle (template A references template B which references A) is an
 * authoring error and throws loudly — never silently deploys a partial fleet.
 * A missing templateId (not in the map) likewise throws.
 *
 * Byte-identical fast path. A fleet whose tree contains no template nodes is
 * returned structurally unchanged (the same reference), so resolve, sharing,
 * and every other consumer see no difference and the cache key is untouched.
 */

import type { Fleet } from "./fleet";
import type { Formation, FormationNode } from "./formation";
import type { FormationTemplate } from "./formation-template";

/**
 * Rewrite every formation id in a (cloned) subtree so each is unique within
 * the host fleet, prefixing with the deterministic namespace `prefix`. The
 * prefix already encodes the full tree path to this template instance, so the
 * prefixed ids are stable across runs and unique across instances. Mutates the
 * cloned subtree in place (the caller passed a fresh `structuredClone`); never
 * touches the template asset itself.
 */
function namespaceSubtreeIds(formation: Formation, prefix: string): void {
  formation.id = `${prefix}#${formation.id}`;
  for (const child of formation.children) {
    if (child.kind === "formation") {
      namespaceSubtreeIds(child.formation, prefix);
    }
    // kind === "ship" | "template": a ship leaf has no formation id; a nested
    // template node is expanded by the outer recursion, which builds its own
    // (deeper) prefix and re-namespaces its own subtree there.
  }
}

/**
 * Does `node`'s subtree contain any `template` node? A cheap pre-scan so the
 * top-level {@link expandTemplates} fast path can return the input fleet
 * unchanged when there is nothing to expand (byte-identical for a template-free
 * fleet).
 */
function containsTemplate(node: FormationNode): boolean {
  if (node.kind === "template") return true;
  if (node.kind === "formation") {
    for (const child of node.formation.children) {
      if (containsTemplate(child)) return true;
    }
  }
  return false;
}

/**
 * Expand the template nodes among one formation's direct children, returning
 * the (possibly rewritten) children array. `pathPrefix` is the deterministic
 * tree-path namespace accumulated from the root down to THIS formation
 * (e.g. `root>div#3`); each expanded template instance contributes its own
 * deeper prefix (`pathPrefix + ">" + originalTemplateId + "#" + childIndex`)
 * so its subtree's rewritten ids are unique. `visited` is the set of template
 * ids on the current expansion stack — a repeat means a cycle.
 */
function expandChildren(
  children: readonly FormationNode[],
  templates: ReadonlyMap<string, FormationTemplate>,
  pathPrefix: string,
  visited: ReadonlySet<string>,
): FormationNode[] {
  const out: FormationNode[] = [];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    if (child.kind !== "template") {
      // Pass non-template children through. A nested formation's own template
      // children are expanded by the recursive `expandFormation` call below.
      if (child.kind === "formation") {
        out.push({
          ...child,
          formation: expandFormation(child.formation, templates, pathPrefix, visited),
        });
      } else {
        out.push(child);
      }
      continue;
    }

    const templateId = child.templateId;
    if (visited.has(templateId)) {
      throw new Error(
        `formation template cycle detected: "${templateId}" references itself (directly or transitively). A cycle is an authoring error; fix the template graph.`,
      );
    }
    const template = templates.get(templateId);
    if (template === undefined) {
      throw new Error(
        `formation template not found: "${templateId}". A fleet referencing an unknown template cannot be resolved; the template is missing from the catalogue.`,
      );
    }

    // Deep-clone the template's formation so the inlined instance shares no
    // object identity with the asset (or with a sibling instance). The clone
    // is then id-rewritten and its own template children recursively expanded.
    const cloned = structuredClone(template.formation);
    // Deterministic, path-rooted namespace for THIS instance: the parent path
    // plus the template's own id plus the child index. Stable across runs
    // (the path and index are pure functions of the tree) and unique across
    // instances (each child index gets its own prefix).
    const instancePrefix = `${pathPrefix}>${templateId}#${i}`;
    namespaceSubtreeIds(cloned, instancePrefix);

    // The cloned subtree may itself contain template nodes (composition).
    // Recurse with an extended visited set so a cycle inside the asset is
    // caught. The namespace prefix for the recursion is the cloned formation's
    // OWN (now-namespaced) id: namespaceSubtreeIds rewrote it to
    // `<instancePrefix>#<originalId>`, so any nested template's instance
    // namespace descends from that concrete id — keeping the chain of prefixes
    // a true path of (post-rewrite) formation ids and producing a readable,
    // unique id at every depth.
    const expandedFormation = expandFormation(
      cloned,
      templates,
      cloned.id,
      new Set([...visited, templateId]),
    );
    out.push({
      ...child,
      kind: "formation",
      formation: expandedFormation,
    });
  }
  return out;
}

/**
 * Recursively expand the template nodes in `formation`'s children. `pathPrefix`
 * is the deterministic namespace for THIS formation — its own (already-
 * namespaced, if it came from a template) id. Returns a new Formation whose
 * children have templates inlined; the formation's own id is carried through
 * unchanged (it was namespaced by the caller if it came from a template).
 */
function expandFormation(
  formation: Formation,
  templates: ReadonlyMap<string, FormationTemplate>,
  pathPrefix: string,
  visited: ReadonlySet<string>,
): Formation {
  // Fast path: no template node anywhere in this subtree — return unchanged.
  let hasTemplate = false;
  for (const child of formation.children) {
    if (containsTemplate(child)) {
      hasTemplate = true;
      break;
    }
  }
  if (!hasTemplate) return formation;

  return {
    ...formation,
    children: expandChildren(formation.children, templates, pathPrefix, visited),
  };
}

/**
 * Inline every `template` node in `fleet`'s formation tree, replacing each with
 * a deep-cloned, id-namespaced copy of its referent's formation. See the module
 * doc for the id-minting scheme, cycle handling, and the byte-identical fast
 * path for a template-free fleet.
 *
 * Pure: no side effects, no mutation of the inputs. The returned fleet shares
 * unchanged subtrees with the input where no template was expanded (the fast
 * path returns the same Formation reference).
 */
export function expandTemplates(
  fleet: Fleet,
  templates: ReadonlyMap<string, FormationTemplate>,
): Fleet {
  const root = fleet.formation;
  if (!containsTemplate({ kind: "formation", formation: root })) {
    return fleet;
  }
  return {
    ...fleet,
    formation: expandFormation(root, templates, root.id, new Set()),
  };
}
