/**
 * The deployment-preview canvas. Renders the resolved formation geometry
 * ({@link previewLeaves}) as coloured glyphs over a graticule, fitted to the
 * viewport. Dragging a glyph commits an explicit slot on its leaf (detaching it
 * from any pattern); pattern buttons regenerate the focused formation's slots.
 *
 * The engine does NOT yet consume the `pattern` layout (it deploys the legacy
 * column), so this canvas previews the AUTHORED geometry — what the player laid
 * out — not the battle's tick-0 column. It is the canonical preview; when the
 * engine later consumes patterns, the formula here should match the resolver.
 * Leaves inside an inlined template (path undefined) render faded and are not
 * draggable (edit the template to move them).
 */

import { ActionIcon, Tooltip } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Formation, FormationLayout, FormationNode, PatternKind } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import type { Path } from "@/domain/formation-tree-state";
import { previewLeaves, rotateOffset, type PreviewLeaf } from "@/domain/formation-layout";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { hardwareKeySmall } from "@/ui/theme/controls.css";
import {
  canvasBody,
  canvasEmpty,
  canvasHint,
  canvasSvg,
  canvasViewport,
  glyph,
  legendChip,
  legendRow,
  legendSwatch,
} from "./SpatialCanvas.css";

/** Viewport padding (px) around the leaf bounds. */
const PADDING_PX = 16;
/** The largest a single ship glyph may grow (px radius) when fitting. */
const MAX_GLYPH_R = 9;
/** The smallest ship glyph (px radius) so a large fleet still shows dots. */
const MIN_GLYPH_R = 2.5;

/** A small cyclic palette for formations (theme hues + tints). */
const FORMATION_COLOURS = [
  "#ff4a3a",
  "#9be000",
  "#b06bff",
  "#ff7a00",
  "#ffd24a",
  "#3aa6ff",
  "#ff6b9a",
  "#46e8c0",
];

/** Stable per-id colour via a hash, so the same formation keeps its colour. */
function formationColour(formationId: string): string {
  let hash = 0;
  for (let i = 0; i < formationId.length; i += 1) {
    hash = (hash * 31 + formationId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % FORMATION_COLOURS.length;
  return FORMATION_COLOURS[idx] ?? FORMATION_COLOURS[0]!;
}

/** The pattern shapes offered as quick buttons on the canvas. */
const CANVAS_PATTERNS: PatternKind[] = ["column", "line", "wedge", "ring", "screen", "echelon"];

interface SpatialCanvasProps {
  root: Formation;
  templates: ReadonlyMap<string, FormationTemplate>;
  /** Currently focused formation path (patterns apply here). */
  focusPath: Path;
  /** Commit a slot on a leaf (drag). */
  onUpdateNode: (path: Path, fn: (n: FormationNode) => FormationNode) => void;
  /** Apply a pattern layout to a formation, baking slots. */
  onApplyPattern: (path: Path, layout: FormationLayout) => void;
  /** The focused formation's role label, for the pattern-button tooltip. */
  focusLabel: string;
}

export function SpatialCanvas({
  root,
  templates,
  focusPath,
  onUpdateNode,
  onApplyPattern,
  focusLabel,
}: SpatialCanvasProps) {
  const leaves = useMemo(() => previewLeaves(root, templates), [root, templates]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ leaf: PreviewLeaf; pointerId: number } | null>(null);
  const { width, height } = useViewportSize(viewportRef);

  const formationOrder = useMemo(() => {
    const seen: string[] = [];
    for (const leaf of leaves) {
      if (!seen.includes(leaf.formationId)) seen.push(leaf.formationId);
    }
    return seen;
  }, [leaves]);

  const fit = useMemo(() => fitLeaves(leaves, width, height), [leaves, width, height]);

  /** World metres → screen px. */
  const worldToScreen = useCallback(
    (x: number, y: number): { sx: number; sy: number } => ({
      sx: (x - fit.cx) * fit.scale + width / 2,
      // Flip y: world +y is "left" in the legacy column; screen +y is down.
      sy: -(y - fit.cy) * fit.scale + height / 2,
    }),
    [fit, width, height],
  );

  /** Screen px (client coords) → world metres. */
  const screenToWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const left = rect?.left ?? 0;
      const top = rect?.top ?? 0;
      const px = clientX - left;
      const py = clientY - top;
      return {
        x: (px - width / 2) / fit.scale + fit.cx,
        y: -(py - height / 2) / fit.scale + fit.cy,
      };
    },
    [fit, width, height],
  );

  /** Commit a slot for a dragged leaf, converting the cursor's world point into
   *  the leaf's parent-local frame (inverting the parent facing). */
  const commitSlot = useCallback(
    (leaf: PreviewLeaf, worldX: number, worldY: number) => {
      if (leaf.path === undefined) return;
      const dx = worldX - leaf.parentX;
      const dy = worldY - leaf.parentY;
      const local = rotateOffset({ forward: dx, lateral: dy }, -leaf.parentFacing);
      onUpdateNode(leaf.path, (n) =>
        n.kind === "ship" ? { ...n, slot: { forward: local.forward, lateral: local.lateral } } : n,
      );
    },
    [onUpdateNode],
  );

  function onPointerDown(leaf: PreviewLeaf, e: React.PointerEvent<SVGCircleElement>) {
    if (leaf.path === undefined) return;
    e.preventDefault();
    // Capture on the SVG layer so move/up keep firing even if the cursor leaves
    // the glyph. Released in endDrag on the same element.
    svgRef.current?.setPointerCapture(e.pointerId);
    setDragging({ leaf, pointerId: e.pointerId });
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragging === null) return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    commitSlot(dragging.leaf, x, y);
  }
  function endDrag() {
    if (dragging === null) return;
    svgRef.current?.releasePointerCapture(dragging.pointerId);
    setDragging(null);
  }

  const glyphR = clamp(width / 60, MIN_GLYPH_R, MAX_GLYPH_R);
  const empty = leaves.length === 0;

  return (
    <div className={canvasBody}>
      <div className={canvasViewport} ref={viewportRef}>
        {empty ? (
          <div className={canvasEmpty}>No ships to preview.</div>
        ) : (
          <svg
            ref={svgRef}
            className={canvasSvg}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <Graticule width={width} height={height} />
            {leaves.map((leaf) => {
              const { sx, sy } = worldToScreen(leaf.x, leaf.y);
              const colour = formationColour(leaf.formationId);
              const draggable = leaf.path !== undefined;
              return (
                <circle
                  key={leaf.pathKey}
                  className={draggable ? glyph : undefined}
                  cx={sx}
                  cy={sy}
                  r={glyphR}
                  fill={colour}
                  stroke="#0a0c10"
                  strokeWidth={0.8}
                  opacity={draggable ? 1 : 0.5}
                  style={{ cursor: draggable ? "grab" : "default" }}
                  onPointerDown={draggable ? (e) => onPointerDown(leaf, e) : undefined}
                />
              );
            })}
          </svg>
        )}
      </div>

      <div className={legendRow}>
        {formationOrder.map((fid) => (
          <span className={legendChip} key={fid}>
            <span className={legendSwatch} style={{ background: formationColour(fid) }} />
            {fid}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
        <span className={canvasHint}>Pattern → {focusLabel}:</span>
        {CANVAS_PATTERNS.map((p) => (
          <Tooltip key={p} label={`Arrange ${focusLabel} as a ${p}`} withArrow position="bottom" openDelay={200}>
            <AnnunciatorButton
              tint="amber"
              onClick={() =>
                onApplyPattern(focusPath, {
                  kind: "pattern",
                  pattern: p,
                  spacing: 120,
                  facingAligned: true,
                })
              }
            >
              {p}
            </AnnunciatorButton>
          </Tooltip>
        ))}
        <ActionIcon
          size="xs"
          variant="subtle"
          className={hardwareKeySmall}
          aria-label="Increase pattern spacing"
          onClick={() => bumpSpacing(focusPath, root, onApplyPattern, 20)}
        >
          <IconChevronUp size={12} />
        </ActionIcon>
        <ActionIcon
          size="xs"
          variant="subtle"
          className={hardwareKeySmall}
          aria-label="Decrease pattern spacing"
          onClick={() => bumpSpacing(focusPath, root, onApplyPattern, -20)}
        >
          <IconChevronDown size={12} />
        </ActionIcon>
      </div>
      <div className={canvasHint}>
        Drag a ship to set its slot (detaches it from the pattern). Template contents render faded.
      </div>
    </div>
  );
}

/** Bump the focused formation's pattern spacing, re-applying offsets. */
function bumpSpacing(
  focusPath: Path,
  root: Formation,
  onApplyPattern: (path: Path, layout: FormationLayout) => void,
  delta: number,
) {
  const formation = formationAtPath(root, focusPath);
  if (formation === undefined) return;
  const layout = formation.layout;
  if (layout === undefined || layout.kind !== "pattern") return;
  const spacing = Math.max(0, layout.spacing + delta);
  onApplyPattern(focusPath, { ...layout, spacing });
}

/** Read the formation at a path (root when empty), or undefined. */
function formationAtPath(root: Formation, path: Path): Formation | undefined {
  if (path.length === 0) return root;
  let current: Formation = root;
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i];
    if (step === undefined) return undefined;
    const child = current.children[step];
    if (child === undefined || child.kind !== "formation") return undefined;
    current = child.formation;
  }
  return current;
}

/** Clamp a value into [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** World metres → viewport px fit: scale and centroid that centre the leaf
 *  bounds with padding. Returns scale 1 / centroid 0 for an empty leaf set. */
function fitLeaves(
  leaves: readonly PreviewLeaf[],
  width: number,
  height: number,
): { scale: number; cx: number; cy: number } {
  if (leaves.length === 0) return { scale: 1, cx: 0, cy: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const leaf of leaves) {
    minX = Math.min(minX, leaf.x);
    maxX = Math.max(maxX, leaf.x);
    minY = Math.min(minY, leaf.y);
    maxY = Math.max(maxY, leaf.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const availX = Math.max(width - PADDING_PX * 2, 1);
  const availY = Math.max(height - PADDING_PX * 2, 1);
  const scale = Math.min(availX / spanX, availY / spanY);
  return { scale, cx, cy };
}

/** A faint graticule + centre cross marking the root origin. */
function Graticule({ width, height }: { width: number; height: number }) {
  const step = 40;
  const lines: React.ReactNode[] = [];
  for (let x = ((width / 2) % step); x < width; x += step) {
    lines.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={height} stroke="#1a1f26" strokeWidth={0.5} />);
  }
  for (let y = ((height / 2) % step); y < height; y += step) {
    lines.push(<line key={`hy${y}`} x1={0} y1={y} x2={width} y2={y} stroke="#1a1f26" strokeWidth={0.5} />);
  }
  return (
    <g>
      {lines}
      <line x1={width / 2 - 6} y1={height / 2} x2={width / 2 + 6} y2={height / 2} stroke="#2a3038" strokeWidth={1} />
      <line x1={width / 2} y1={height / 2 - 6} x2={width / 2} y2={height / 2 + 6} stroke="#2a3038" strokeWidth={1} />
    </g>
  );
}

/** Track the viewport's pixel size via a ResizeObserver (effect, not render). */
function useViewportSize(
  viewportRef: React.RefObject<HTMLDivElement | null>,
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 600, height: 200 });
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.round(rect.width) || 600, height: Math.round(rect.height) || 200 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewportRef]);
  return size;
}
