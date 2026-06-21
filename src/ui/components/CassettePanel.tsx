import type { CSSProperties, ReactNode } from "react";
import { cassettePanel, cornerBL, cornerTR, panelLabel } from "./panel.css";

interface CassettePanelProps {
  children: ReactNode;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Cassette-futurism panel chrome: dark fill, 1 px chrome border, amber
 * corner brackets on all four corners, and an optional mono uppercase label.
 */
export function CassettePanel({ children, label, className, style: styleProp }: CassettePanelProps) {
  const classes = [cassettePanel, className].filter(Boolean).join(" ");
  return (
    <div className={classes} style={styleProp}>
      <div className={cornerBL} aria-hidden="true" />
      <div className={cornerTR} aria-hidden="true" />
      {label !== undefined && <div className={panelLabel}>{label}</div>}
      {children}
    </div>
  );
}
