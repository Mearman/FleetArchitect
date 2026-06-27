/**
 * Pure, path-based immutable updates for a formation tree. The fleet builder
 * holds the root {@link Formation} as its working state and edits it through
 * these helpers, which address any node by its chain of child indices from the
 * root (a `Path`). Ship leaves have no stable per-instance id (the schema notes
 * this), so addressing by position is the natural handle.
 *
 * A `Path` addresses a NODE inside the root's children: `[]` is the root
 * formation itself; `[2]` is the root's third child; `[2, 0]` is the first
 * child of that third child (if it is a nested formation). Every helper returns
 * a new tree — the inputs are never mutated — so React state updates are pure
 * and the historical revision path is unchanged.
 */

import type { Formation, FormationNode } from "@/schema/formation";

/** A path of child indices from the root down to a node. `[]` is the root. */
export type Path = readonly number[];

/** Thrown when a path does not resolve (an index is out of range, or a non-
 *  formation child is descended into). The UI guards paths before calling, so a
 *  throw here is a programmer error, not a user-facing condition. */
export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

/** Type guard: is `node` a nested formation child (carries `.formation`)? */
export function isFormationNode(
  node: FormationNode,
): node is Extract<FormationNode, { kind: "formation" }> {
  return node.kind === "formation";
}

/** Type guard: does `value` carry the root formation's `children` array? (The
 *  only tree value with a top-level `children` is the root Formation; a
 *  formation NODE wraps its formation under `.formation`.) */
function isFormation(value: FormationNode | Formation): value is Formation {
  return "children" in value;
}

/** Read the tree value at `path` — the root formation when `path` is empty,
 *  otherwise the node at the path. Throws {@link PathError} if it does not
 *  resolve. */
export function nodeAtPath(root: Formation, path: Path): FormationNode | Formation {
  // Descend without a reassigning loop variable (TS control-flow narrowing loses
  // the union across loop iterations); track the current formation and child
  // node as separate explicitly-typed locals.
  let formation: Formation = root;
  let node: FormationNode | undefined;
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i];
    if (step === undefined) {
      throw new PathError(`path contained an undefined step at ${i}`);
    }
    const child = formation.children[step];
    if (child === undefined) {
      throw new PathError(`path index ${step} out of range at ${path.slice(0, i + 1).join(">")}`);
    }
    node = child;
    if (!isFormationNode(node)) {
      // A ship/template leaf cannot be descended into; if there are more steps,
      // the path is invalid.
      if (i < path.length - 1) {
        throw new PathError(`path descended into a non-formation node: ${path.join(">")}`);
      }
      break;
    }
    formation = node.formation;
  }
  return node ?? formation;
}

/**
 * Update the formation at `path` (the root when `path` is empty; otherwise a
 * nested formation child node) by applying `fn` to it. Returns a new tree. The
 * foundational primitive the other helpers build on.
 */
export function updateFormation(
  root: Formation,
  path: Path,
  fn: (formation: Formation) => Formation,
): Formation {
  if (path.length === 0) return fn(root);

  const head = path[0];
  if (head === undefined) {
    throw new PathError("updateFormation received an empty path step");
  }
  const rest: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const step = path[i];
    if (step === undefined) {
      throw new PathError(`updateFormation path contained an undefined step at ${i}`);
    }
    rest.push(step);
  }

  const child = root.children[head];
  if (child === undefined) {
    throw new PathError(`path index ${head} out of range at root`);
  }
  if (!isFormationNode(child)) {
    throw new PathError(`path descended into a non-formation node at ${head}`);
  }
  const nextChild: FormationNode = {
    ...child,
    formation: updateFormation(child.formation, rest, fn),
  };
  const children = root.children.slice();
  children[head] = nextChild;
  return { ...root, children };
}

/** Replace the node at `path` (must be non-empty — a node, not the root) with
 *  the result of `fn`. Returns a new tree. */
export function updateNode(
  root: Formation,
  path: Path,
  fn: (node: FormationNode) => FormationNode,
): Formation {
  if (path.length === 0) {
    throw new PathError("updateNode requires a non-empty path (use updateFormation for the root)");
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === undefined) {
    throw new PathError("updateNode received an empty path");
  }
  return updateFormation(root, parentPath, (parent) => {
    const child = parent.children[index];
    if (child === undefined) {
      throw new PathError(`node index ${index} out of range`);
    }
    const children = parent.children.slice();
    children[index] = fn(child);
    return { ...parent, children };
  });
}

/** Append `node` to the children of the formation at `parentPath` (root when
 *  empty). Returns a new tree. */
export function appendChild(
  root: Formation,
  parentPath: Path,
  node: FormationNode,
): Formation {
  return updateFormation(root, parentPath, (parent) => ({
    ...parent,
    children: [...parent.children, node],
  }));
}

/** Remove the node at `path` (must be non-empty) from its parent's children.
 *  Returns a new tree. */
export function removeNode(root: Formation, path: Path): Formation {
  if (path.length === 0) {
    throw new PathError("removeNode requires a non-empty path");
  }
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === undefined) {
    throw new PathError("removeNode received an empty path");
  }
  return updateFormation(root, parentPath, (parent) => ({
    ...parent,
    children: parent.children.filter((_, i) => i !== index),
  }));
}

/** Move the child at `from` to `to` within the formation at `parentPath`. The
 *  destination is clamped to the valid range after removal. Returns a new tree. */
export function moveWithin(
  root: Formation,
  parentPath: Path,
  from: number,
  to: number,
): Formation {
  return updateFormation(root, parentPath, (parent) => {
    const children = parent.children.slice();
    const node = children[from];
    if (node === undefined) {
      throw new PathError(`moveWithin from-index ${from} out of range`);
    }
    children.splice(from, 1);
    const clamped = Math.max(0, Math.min(to, children.length));
    children.splice(clamped, 0, node);
    return { ...parent, children };
  });
}

/**
 * Move the node at `fromPath` into the formation at `toParentPath`, appending
 * it as the LAST child of that formation. Enables "nest into this sub-formation".
 * Refuses to move a node into itself or one of its own descendants (that would
 * create a cycle) — throws {@link PathError}. Returns a new tree. The UI then
 * uses {@link moveWithin} to position the moved child within its new parent.
 */
export function reparent(
  root: Formation,
  fromPath: Path,
  toParentPath: Path,
): Formation {
  if (fromPath.length === 0) {
    throw new PathError("cannot reparent the root");
  }
  // Cycle guard: the destination must not be the moved node itself or a
  // descendant of it. `toParentPath` is inside `fromPath` when it shares every
  // element of fromPath (it is the moved node, or descends from it).
  if (toParentPath.length >= fromPath.length) {
    const isDescendant = fromPath.every((step, i) => toParentPath[i] === step);
    if (isDescendant) {
      throw new PathError("cannot move a node into itself or one of its descendants");
    }
  }

  // Read the node before any mutation (paths are valid against the original).
  // A non-empty path addresses a FormationNode; the root formation is rejected
  // by the narrowing guard below (defensive — impossible given fromPath check).
  const movedLookup = nodeAtPath(root, fromPath);
  if (isFormation(movedLookup)) {
    throw new PathError("reparent source resolved to the root formation");
  }
  const movedNode: FormationNode = movedLookup;

  // Two-step: remove from the original parent, then append to the new parent.
  // The removal can shift a destination path that ran through a LATER sibling
  // of the source under a shared ancestor; {@link shiftPath} recomputes it.
  const removed = removeNode(root, fromPath);
  const destPath = shiftPath(toParentPath, fromPath);
  return appendChild(removed, destPath, movedNode);
}

/**
 * Recompute a destination path after the node at `removedPath` was deleted.
 * Any path element that addressed a LATER sibling under the same ancestor as
 * the removed node shifts down by one. When the destination does not run
 * through the removed node's parent, it is unchanged.
 */
function shiftPath(target: Path, removedPath: Path): Path {
  if (removedPath.length === 0) return target;
  // The common ancestor length: the longest prefix shared by target and
  // removedPath up to (but not including) removedPath's last element.
  const removedParentLen = removedPath.length - 1;
  const sharedLen = Math.min(target.length, removedParentLen);
  let shared = 0;
  for (let i = 0; i < sharedLen; i += 1) {
    const a = target[i];
    const b = removedPath[i];
    if (a === undefined || b === undefined) break;
    if (a === b) shared += 1;
    else break;
  }
  // Only if target descends through the removed node's parent do later indices
  // shift.
  if (shared !== removedParentLen) return target;
  const removedIndex = removedPath[removedPath.length - 1];
  if (removedIndex === undefined) return target;
  const out = target.slice();
  // The element at position `removedParentLen` in target is an index into the
  // removed node's parent's children. If it was strictly greater than the
  // removed index, it shifts down by one (an earlier sibling was removed).
  const atBranch = out[removedParentLen];
  if (atBranch !== undefined && atBranch > removedIndex) {
    out[removedParentLen] = atBranch - 1;
  }
  return out;
}
