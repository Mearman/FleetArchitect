/**
 * The recursive formation-tree roster. Renders the root formation's children as
 * a nested list of {@link ShipLeafCard}s, {@link FormationNodeCard}s, and
 * template-reference cards. Path-based immutable updates (from
 * formation-tree-state) flow through {@link TreeOps}; the view binds each card's
 * callbacks to the pure helpers so React state stays functional.
 *
 * The root is rendered as a {@link RootFormationCard} (slimmed — no layout/move)
 * so a flat fleet resolves byte-identically to the legacy column.
 */

import { ActionIcon } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { Formation, FormationNode } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import type { ShipDesign } from "@/schema/ship";
import type { Path } from "@/domain/formation-tree-state";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import { ShipLeafCard } from "./ShipLeafCard";
import { FormationNodeCard, RootFormationCard } from "./FormationNodeCard";
import {
  missingBadge,
  templateRefCard,
  templateRefName,
  treeNode,
  treeChildren,
} from "./FormationTree.css";

/** Resolves a design id to its design + cost + classification, or marks it
 *  missing (a leaf whose design was deleted). */
export type ShipLookup = (designId: string) =>
  | { design: ShipDesign; cost: number; classification: string; missing: false }
  | { design: undefined; cost: 0; classification: "missing"; missing: true };

/** Resolves a template id to its stored record, or undefined when missing. */
export type TemplateLookup = (templateId: string) => FormationTemplate | undefined;

/** The operations the route exposes to the tree, bound to its working state. */
export interface TreeOps {
  updateFormation: (path: Path, fn: (f: Formation) => Formation) => void;
  updateNode: (path: Path, fn: (n: FormationNode) => FormationNode) => void;
  appendChild: (parentPath: Path, node: FormationNode) => void;
  removeNode: (path: Path) => void;
  moveWithin: (parentPath: Path, from: number, to: number) => void;
}

interface FormationTreeViewProps {
  root: Formation;
  shipLookup: ShipLookup;
  templateLookup: TemplateLookup;
  accent: string;
  overBudget: boolean;
  focusPath: Path;
  ops: TreeOps;
  onAddSubFormation: (parentPath: Path) => void;
  onSaveAsTemplate: (path: Path) => void;
  onFocus: (path: Path) => void;
}

/** A template-reference node card: resolved name (or id + missing badge) and
 *  move/remove controls. Template refs sit in the same child list as ships and
 *  sub-formations, so they move with their siblings. */
function TemplateRefCard({
  node,
  template,
  isFirst,
  isLast,
  ops,
  path,
}: {
  node: Extract<FormationNode, { kind: "template" }>;
  template: FormationTemplate | undefined;
  isFirst: boolean;
  isLast: boolean;
  ops: TreeOps;
  path: Path;
}) {
  const lastIndex = path.length - 1;
  const lastIndexVal = lastIndex >= 0 ? path[lastIndex] : undefined;
  if (lastIndexVal === undefined) return null;
  const index: number = lastIndexVal;
  const parentPath = path.slice(0, lastIndex);
  return (
    <div className={templateRefCard}>
      <span className={templateRefName}>{template?.name ?? node.templateId}</span>
      {template === undefined && <span className={missingBadge}>missing</span>}
      <span style={{ marginLeft: "auto", display: "flex", gap: "0.15rem" }}>
        <ActionIcon
          size="xs"
          variant="subtle"
          className={hardwareKeySmall}
          aria-label="Move template up"
          disabled={isFirst}
          onClick={() => ops.moveWithin(parentPath, index, index - 1)}
        >
          <IconChevronUp size={12} />
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="subtle"
          className={hardwareKeySmall}
          aria-label="Move template down"
          disabled={isLast}
          onClick={() => ops.moveWithin(parentPath, index, index + 1)}
        >
          <IconChevronDown size={12} />
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="subtle"
          color="red"
          aria-label="Remove template reference"
          onClick={() => ops.removeNode(path)}
        >
          <IconTrash size={12} />
        </ActionIcon>
      </span>
    </div>
  );
}

/** Render the children of a formation as a list of cards. Each child is
 *  addressed by `parentPath + [index]`; the recursive step renders a formation
 *  node's own children inside an indented rail. */
function FormationList({
  children,
  parentPath,
  view,
}: {
  children: readonly FormationNode[];
  parentPath: Path;
  view: FormationTreeViewProps;
}) {
  const { shipLookup, templateLookup, accent, overBudget, focusPath, ops, onAddSubFormation, onSaveAsTemplate, onFocus } = view;
  return (
    <>
      {children.map((node, index) => {
        const path: Path = [...parentPath, index];
        const isFirst = index === 0;
        const isLast = index === children.length - 1;

        if (node.kind === "ship") {
          const lookup = shipLookup(node.ship.designId);
          if (lookup.missing) return null;
          return (
            <div className={treeNode} key={`s-${index}`}>
              <ShipLeafCard
                design={lookup.design}
                doctrine={node.ship.doctrine ?? { base: {}, rules: [] }}
                classification={lookup.classification}
                accent={accent}
                cost={lookup.cost}
                overBudget={overBudget}
                isFirst={isFirst}
                isLast={isLast}
                onUpdateDoctrine={(next) =>
                  ops.updateNode(path, (n) =>
                    n.kind === "ship" ? { ...n, ship: { ...n.ship, doctrine: next } } : n,
                  )
                }
                onRemove={() => ops.removeNode(path)}
                onMoveUp={() => ops.moveWithin(parentPath, index, index - 1)}
                onMoveDown={() => ops.moveWithin(parentPath, index, index + 1)}
              />
            </div>
          );
        }

        if (node.kind === "template") {
          return (
            <div className={treeNode} key={`t-${index}`}>
              <TemplateRefCard
                node={node}
                template={templateLookup(node.templateId)}
                isFirst={isFirst}
                isLast={isLast}
                ops={ops}
                path={path}
              />
            </div>
          );
        }

        // Formation node: header card + recursive children rail.
        const formation = node.formation;
        return (
          <div className={treeNode} key={`f-${index}`}>
            <FormationNodeCard
              formation={formation}
              path={path}
              isFirst={isFirst}
              isLast={isLast}
              isFocused={samePath(focusPath, path)}
              childCount={formation.children.length}
              onUpdateFormation={(fn) => ops.updateFormation(path, fn)}
              onRemove={() => ops.removeNode(path)}
              onMoveUp={() => ops.moveWithin(parentPath, index, index - 1)}
              onMoveDown={() => ops.moveWithin(parentPath, index, index + 1)}
              onFocus={() => onFocus(path)}
              onAddSubFormation={() => onAddSubFormation(path)}
              onSaveAsTemplate={() => onSaveAsTemplate(path)}
            />
            <div className={treeChildren}>
              <FormationList children={formation.children} parentPath={path} view={view} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Structural equality on two paths. */
function samePath(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The tree view: a root card over the recursive child list. */
export function FormationTreeView(view: FormationTreeViewProps): ReactNode {
  const { root, focusPath, ops, onFocus } = view;
  return (
    <div className={treeNode}>
      <RootFormationCard
        formation={root}
        isFocused={samePath(focusPath, [])}
        childCount={root.children.length}
        onUpdateFormation={(fn) => ops.updateFormation([], fn)}
        onFocus={() => onFocus([])}
      />
      <div className={treeChildren}>
        <FormationList children={root.children} parentPath={[]} view={view} />
      </div>
    </div>
  );
}
