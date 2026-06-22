import type { ReactNode } from "react";
import { CassettePanel } from "@/ui/components/CassettePanel";
import * as styles from "./BattleWorkspace.css";

interface BattleWorkspaceProps {
  /** Left wing content (setup form). */
  setupContent: ReactNode;
  /** Right wing content (layer toggles + module status). */
  controlsContent: ReactNode;
  /**
   * Whether a battle is running. The controls wing is only meaningful once
   * frames exist, so it is hidden until then.
   */
  hasFrames: boolean;
  /** Centre column: canvas stage + playback bar. */
  children: ReactNode;
}

/**
 * Three-zone battle console layout. The screen sits in the centre, flanked by
 * two fixed cassette-panel wings bolted to the console — setup on the left,
 * controls on the right (once a battle is running). The wings are always
 * present: no collapse, rails, drawers, or slide animation.
 *
 * On narrow screens the row reflows to a column (via CSS `order` the screen
 * stays on top) and the wings stack beneath the screen; the page scrolls.
 */
export function BattleWorkspace({
  setupContent,
  controlsContent,
  hasFrames,
  children,
}: BattleWorkspaceProps) {
  return (
    <div className={styles.workspace}>
      <CassettePanel label="Battle Setup" className={styles.wing}>
        <div className={styles.wingBody}>{setupContent}</div>
      </CassettePanel>

      <div className={styles.centre}>{children}</div>

      {hasFrames && (
        <CassettePanel label="Controls" className={styles.wing}>
          <div className={styles.wingBody}>{controlsContent}</div>
        </CassettePanel>
      )}
    </div>
  );
}
