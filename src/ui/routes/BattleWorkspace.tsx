import { ActionIcon, Drawer } from "@mantine/core";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import * as styles from "./BattleWorkspace.css";

interface BattleWorkspaceProps {
  /** Left dock content (setup form). */
  setupContent: ReactNode;
  /** Right dock content (layer toggles + module status). */
  controlsContent: ReactNode;
  /** Whether the setup dock/drawer is expanded. */
  setupOpen: boolean;
  /** Whether the controls dock/drawer is expanded. */
  controlsOpen: boolean;
  /** Toggle the setup dock/drawer. */
  onSetupToggle: () => void;
  /** Toggle the controls dock/drawer. */
  onControlsToggle: () => void;
  /**
   * Whether to show the mobile action bar + drawers instead of inline docks.
   * Driven by `useIsMobile()` in the Route.
   */
  isMobile: boolean;
  /**
   * Whether a battle is running. The controls dock and mobile controls bar are
   * only meaningful once frames exist; the controls are hidden until then.
   */
  hasFrames: boolean;
  /** Centre column: canvas stage + playback bar. */
  children: ReactNode;
}

/**
 * Three-zone battle workspace layout.
 *
 * Desktop: collapsible left dock (setup) | canvas centre | collapsible right
 * dock (controls). Each dock collapses to a thin labelled rail rather than
 * vanishing entirely, so the canvas reflows smoothly and the battle stays
 * visible at all times.
 *
 * Mobile: canvas fills the width. When a battle is running, a compact bar
 * below the canvas shows SETUP and CONTROLS buttons, each opening a
 * bottom-sheet Drawer. Before a battle, the setup is shown as a Drawer that
 * opens automatically (driven by setupOpen defaulting to true in the Route).
 */
export function BattleWorkspace({
  setupContent,
  controlsContent,
  setupOpen,
  controlsOpen,
  onSetupToggle,
  onControlsToggle,
  isMobile,
  hasFrames,
  children,
}: BattleWorkspaceProps) {
  return (
    <>
      <div className={styles.workspace}>
        {/* ── Left dock (setup) — desktop only ─────────────────────────────── */}
        {!isMobile && (
          setupOpen ? (
            <div className={styles.dock}>
              <div className={styles.dockHeader}>
                <span className={styles.dockTitle}>Battle Setup</span>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  aria-label="Collapse setup"
                  onClick={onSetupToggle}
                >
                  <IconChevronLeft size={14} />
                </ActionIcon>
              </div>
              <div className={styles.dockBody}>
                {setupContent}
              </div>
            </div>
          ) : (
            <div
              className={styles.dockRail}
              role="button"
              aria-label="Expand setup"
              tabIndex={0}
              onClick={onSetupToggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSetupToggle();
              }}
            >
              <IconChevronRight size={12} color="var(--fa-color-amber)" />
              <span className={styles.railLabel}>Setup</span>
            </div>
          )
        )}

        {/* ── Centre: canvas + playback ─────────────────────────────────────── */}
        <div className={styles.centre}>
          {children}

          {/* Mobile action bar — visible during battle, hidden on desktop */}
          {isMobile && hasFrames && (
            <div className={styles.mobileDockBar}>
              <ActionIcon
                size="sm"
                variant={setupOpen ? "light" : "subtle"}
                aria-label={setupOpen ? "Close setup" : "Open setup"}
                onClick={onSetupToggle}
              >
                <IconChevronLeft size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant={controlsOpen ? "light" : "subtle"}
                aria-label={controlsOpen ? "Close controls" : "Open controls"}
                onClick={onControlsToggle}
              >
                <IconChevronRight size={14} />
              </ActionIcon>
            </div>
          )}
        </div>

        {/* ── Right dock (controls) — desktop, only when battle running ─────── */}
        {!isMobile && hasFrames && (
          controlsOpen ? (
            <div className={styles.dock}>
              <div className={styles.dockHeader}>
                <span className={styles.dockTitle}>Controls</span>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  aria-label="Collapse controls"
                  onClick={onControlsToggle}
                >
                  <IconChevronRight size={14} />
                </ActionIcon>
              </div>
              <div className={styles.dockBody}>
                {controlsContent}
              </div>
            </div>
          ) : (
            <div
              className={styles.dockRail}
              role="button"
              aria-label="Expand controls"
              tabIndex={0}
              onClick={onControlsToggle}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onControlsToggle();
              }}
            >
              <IconChevronLeft size={12} color="var(--fa-color-amber)" />
              <span className={styles.railLabel}>Controls</span>
            </div>
          )
        )}
      </div>

      {/* ── Mobile bottom-sheet Drawers ───────────────────────────────────── */}
      {isMobile && (
        <>
          <Drawer
            opened={setupOpen}
            onClose={onSetupToggle}
            position="bottom"
            title="Battle Setup"
            size="80%"
          >
            {setupContent}
          </Drawer>

          {hasFrames && (
            <Drawer
              opened={controlsOpen}
              onClose={onControlsToggle}
              position="bottom"
              title="Controls"
              size="70%"
            >
              {controlsContent}
            </Drawer>
          )}
        </>
      )}
    </>
  );
}
