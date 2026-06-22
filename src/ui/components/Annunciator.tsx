import { UnstyledButton } from "@mantine/core";
import { forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  annunciator,
  annunciatorAmber,
  annunciatorCyan,
  annunciatorGreen,
  annunciatorLamp,
  annunciatorMagenta,
} from "@/ui/theme/controls.css";

/** Illumination colour of an annunciator. */
export type AnnunciatorTint = "amber" | "green" | "cyan" | "magenta";

const TINT_CLASS: Record<AnnunciatorTint, string> = {
  amber: annunciatorAmber,
  green: annunciatorGreen,
  cyan: annunciatorCyan,
  magenta: annunciatorMagenta,
};

function classesFor(tint: AnnunciatorTint, extra: string | undefined): string {
  return [annunciator, TINT_CLASS[tint], extra].filter(Boolean).join(" ");
}

interface AnnunciatorButtonProps {
  children?: ReactNode;
  /** Leading icon, rendered before the legend. */
  icon?: ReactNode;
  /** Lamp colour when lit. Defaults to amber. */
  tint?: AnnunciatorTint;
  /**
   * Latched (toggle) state. When provided, the lamp stays lit while true and the
   * button reports its pressed state via aria-pressed. Omit for a momentary
   * button, which lights only while held.
   */
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Annunciator legend-lamp button. Momentary by default (lit while pressed);
 * pass `active` to make it a latching toggle that stays lit while on.
 */
export const AnnunciatorButton = forwardRef<HTMLButtonElement, AnnunciatorButtonProps>(
  function AnnunciatorButton(
    { children, icon, tint = "amber", active, onClick, disabled, className, style, ...rest },
    ref,
  ) {
    return (
      <UnstyledButton
        ref={ref}
        component="button"
        type="button"
        className={classesFor(tint, className)}
        style={style}
        disabled={disabled}
        onClick={onClick}
        data-active={active === true ? "true" : undefined}
        aria-pressed={active}
        aria-label={rest["aria-label"]}
      >
        {icon}
        {children}
      </UnstyledButton>
    );
  },
);

interface AnnunciatorLampProps {
  children?: ReactNode;
  icon?: ReactNode;
  tint?: AnnunciatorTint;
  /** Whether the lamp is illuminated. */
  lit?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Non-interactive annunciator indicator lamp — the same lens as the button, with
 * no press affordance, driven purely by `lit`.
 */
export function AnnunciatorLamp({
  children,
  icon,
  tint = "amber",
  lit = false,
  className,
  style,
}: AnnunciatorLampProps) {
  return (
    <span
      className={classesFor(tint, [annunciatorLamp, className].filter(Boolean).join(" "))}
      style={style}
      data-active={lit ? "true" : undefined}
    >
      {icon}
      {children}
    </span>
  );
}
