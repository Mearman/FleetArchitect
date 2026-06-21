import { useEffect } from "react";
import { bootRoot } from "./CrtOverlay.css";

/**
 * Whole-machine boot sequence — runs the CRT power-on animation (a scaleY snap
 * with a brightness ramp) on #root once at startup, gated on
 * html[data-fx="full"] in CSS. The persistent screen effects (scanlines,
 * vignette, chromatic aberration) live on the individual displays via
 * CrtScreen, not across the whole app. Renders nothing itself.
 */
export function CrtOverlay() {
  useEffect(() => {
    const root = document.getElementById("root");
    if (root === null) return;
    root.classList.add(bootRoot);
    return () => {
      root.classList.remove(bootRoot);
    };
  }, []);

  return null;
}
