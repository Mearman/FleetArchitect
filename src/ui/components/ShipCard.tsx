import { UnstyledButton } from "@mantine/core";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { catalog } from "@/data/catalog";
import { deriveClassification } from "@/domain/grid";
import { analyseShipDesign } from "@/domain/stats";
import type { ShipDesign } from "@/schema/ship";
import { formatJoules } from "@/ui/format";
import { FACTION_PALETTE } from "@/ui/routes/battleConstants";
import { ShipThumbnail } from "./ShipThumbnail";
import {
  shipCard,
  shipCardAction,
  shipCardBadge,
  shipCardMeta,
  shipCardName,
  shipCardStat,
  shipCardStats,
  shipCardWrap,
} from "./shipCard.css";

interface ShipCardProps {
  design: ShipDesign;
  /** Lit/active state when the card is selected. */
  selected?: boolean;
  /** Click handler; when present the whole tile is a button. */
  onSelect?: (design: ShipDesign) => void;
  /** Optional control rendered in the top-right corner (e.g. a delete button). */
  action?: ReactNode;
  /** Denser layout with a smaller thumbnail for inline browsers. */
  compact?: boolean;
}

/** Thumbnail edge in CSS pixels for the two density modes. */
const THUMB_SIZE = 88;
const THUMB_SIZE_COMPACT = 64;

/** Neutral accent for designs whose faction has no palette entry. */
const DEFAULT_ACCENT = "#9aa0a6";

/**
 * A recessed skeuomorphic tile previewing a ship design: its baked thumbnail,
 * name, class badge, points cost, and a couple of key stats. The whole tile is a
 * button when `onSelect` is given; `selected` lights its active state. A faction
 * accent tints the border. An optional `action` slot sits top-right.
 */
export function ShipCard({ design, selected, onSelect, action, compact }: ShipCardProps) {
  const analysis = useMemo(() => analyseShipDesign(design, catalog()), [design]);
  const classification = useMemo(() => deriveClassification(design.grid), [design]);

  const palette = FACTION_PALETTE[design.faction];
  const accent = palette === undefined ? DEFAULT_ACCENT : palette.accent;
  const thumbSize = compact === true ? THUMB_SIZE_COMPACT : THUMB_SIZE;

  const body = (
    <>
      <ShipThumbnail design={design} size={thumbSize} accent={accent} />
      <div className={shipCardMeta}>
        <span className={shipCardName}>{design.name}</span>
        <span className={shipCardBadge}>{classification}</span>
        <div className={shipCardStats}>
          <span className={shipCardStat}>{analysis.stats.cost} pts</span>
          <span className={shipCardStat}>{formatJoules(analysis.stats.structure)}</span>
          <span className={shipCardStat}>{analysis.stats.weapons.length} wpn</span>
        </div>
      </div>
    </>
  );

  // The card is a button when selectable; the action is a *sibling* in the
  // wrapper (never nested inside the button — that is invalid HTML).
  const card =
    onSelect === undefined ? (
      <div
        className={shipCard}
        style={{ borderColor: accent }}
        data-selected={selected === true ? "true" : undefined}
      >
        {body}
      </div>
    ) : (
      <UnstyledButton
        type="button"
        className={shipCard}
        style={{ borderColor: accent }}
        data-selected={selected === true ? "true" : undefined}
        onClick={() => onSelect(design)}
        aria-pressed={selected}
      >
        {body}
      </UnstyledButton>
    );

  return (
    <div className={shipCardWrap}>
      {card}
      {action !== undefined && <div className={shipCardAction}>{action}</div>}
    </div>
  );
}
